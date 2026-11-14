"""
SPHEREx IRSA Client & Parallel Cutout Fetcher Module.
Queries IPAC/IRSA TAP services for SPHEREx Multi-Extension FITS (MEF) cutouts,
downloads cutouts in parallel using ThreadPoolExecutor with retry logic,
subtracts ZODI background (HDU 4) from IMAGE (HDU 1), and extracts target
wavelength and bandwidth using alternate WCS key="W" (WCS-WAVE HDU 6).
"""

import concurrent.futures
import io
import logging
import random
import re
import ssl
import time
import warnings
from typing import Any, Dict, List, Optional, Tuple

import astropy.units as u
import certifi
import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.utils.data import conf
from astropy.wcs import FITSFixedWarning, WCS
from astroquery.ipac.irsa import Irsa
import pyvo

# Suppress benign WCS SIP warnings from SPHEREx Level 2 headers
logging.getLogger("astropy").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", category=FITSFixedWarning)
warnings.filterwarnings("ignore", message=".*Inconsistent SIP distortion.*")

# Configure remote timeout for astropy & requests
conf.remote_timeout = 120

logger = logging.getLogger("spherex.irsa_client")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Known SPHEREx detector bands
VALID_DETECTORS = {
    "D1": "SPHEREx-D1",
    "SPHEREX-D1": "SPHEREx-D1",
    "D2": "SPHEREx-D2",
    "SPHEREX-D2": "SPHEREx-D2",
    "D3": "SPHEREx-D3",
    "SPHEREX-D3": "SPHEREx-D3",
    "D4": "SPHEREx-D4",
    "SPHEREX-D4": "SPHEREx-D4",
    "D5": "SPHEREx-D5",
    "SPHEREX-D5": "SPHEREx-D5",
    "D6": "SPHEREx-D6",
    "SPHEREX-D6": "SPHEREx-D6",
    "ALL": "SPHEREx-All",
    "SPHEREX-ALL": "SPHEREx-All",
}

# Nominal detector wavelength coverage ranges (micrometers)
DETECTOR_WAVELENGTH_RANGES = {
    "SPHEREx-D1": (0.75, 1.09),
    "SPHEREx-D2": (1.10, 1.62),
    "SPHEREx-D3": (1.63, 2.41),
    "SPHEREx-D4": (2.42, 3.82),
    "SPHEREx-D5": (3.83, 4.41),
    "SPHEREx-D6": (4.42, 5.00),
}


def normalize_detector_name(detector: Optional[str]) -> Optional[str]:
    """Normalize input detector string to canonical 'SPHEREx-D1'...'SPHEREx-D6' format."""
    if not detector:
        return None
    cleaned = detector.strip().upper()
    return VALID_DETECTORS.get(cleaned, detector)


def validate_coordinates(ra_deg: float, dec_deg: float, fov_deg: float = 0.05) -> Tuple[float, float, float]:
    """
    Validate celestial coordinates and FOV.
    Raises ValueError with explanatory message if out of bounds.
    """
    if not (0.0 <= ra_deg <= 360.0):
        raise ValueError(f"RA must be between 0 and 360 degrees, got {ra_deg}")
    if not (-90.0 <= dec_deg <= 90.0):
        raise ValueError(f"Dec must be between -90 and 90 degrees, got {dec_deg}")
    if fov_deg <= 0:
        raise ValueError(f"FOV must be positive, got {fov_deg}")
    return float(ra_deg), float(dec_deg), float(fov_deg)


def build_tap_query(
    ra_deg: float,
    dec_deg: float,
    fov_deg: float = 0.05,
    detector: Optional[str] = None,
    limit: Optional[int] = None,
    order_by: str = "ASC",
    mjd_min: Optional[float] = None,
    mjd_max: Optional[float] = None,
) -> str:
    """
    Construct ADQL query against `spherex.artifact` and `spherex.plane` on IRSA TAP.
    
    Generates dynamic IBE cutout URLs:
    https://irsa.ipac.caltech.edu/{a.uri}?center={ra},{dec}d&size={fov}
    """
    validate_coordinates(ra_deg, dec_deg, fov_deg)

    norm_detector = normalize_detector_name(detector)
    detector_clause = f"AND p.energy_bandpassname = '{norm_detector}'" if norm_detector else ""
    limit_clause = f"TOP {int(limit)}" if limit and limit > 0 else ""

    date_clauses = []
    if mjd_min is not None and np.isfinite(mjd_min):
        date_clauses.append(f"AND p.time_bounds_lower >= {float(mjd_min):.6f}")
    if mjd_max is not None and np.isfinite(mjd_max):
        date_clauses.append(f"AND p.time_bounds_upper <= {float(mjd_max):.6f}")
    date_clause_str = " ".join(date_clauses)

    order_dir = "DESC" if str(order_by).strip().upper() == "DESC" else "ASC"

    query = f"""
    SELECT {limit_clause}
        'https://irsa.ipac.caltech.edu/' || a.uri || '?center=' || CAST({ra_deg:.7f} AS VARCHAR) || ',' || CAST({dec_deg:.7f} AS VARCHAR) || 'd&size=' || CAST({fov_deg:.5f} AS VARCHAR) AS cutout_url,
        'https://irsa.ipac.caltech.edu/' || a.uri AS full_mef_url,
        p.time_bounds_lower AS obs_mjd_start,
        p.time_bounds_upper AS obs_mjd_end,
        p.energy_bandpassname AS detector_band,
        p.provenance_version AS version
    FROM spherex.artifact a
    JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra_deg:.7f}, {dec_deg:.7f}), p.poly)
    {detector_clause}
    {date_clause_str}
    ORDER BY p.time_bounds_lower {order_dir}
    """
    return query.strip()


def query_spherex_tap(
    ra_deg: float,
    dec_deg: float,
    fov_deg: float = 0.05,
    detector: Optional[str] = None,
    limit: Optional[int] = None,
    order_by: str = "ASC",
    mjd_min: Optional[float] = None,
    mjd_max: Optional[float] = None,
    sampling: str = "all",
) -> List[Dict[str, Any]]:
    """
    Execute IRSA TAP query and return list of metadata rows for matching cutouts.
    
    Sampling options:
    - 'all': returns up to limit rows in requested order.
    - 'baseline': samples observations distributed across the entire temporal baseline.
    - 'latest': retrieves latest observations by MJD, sorted chronologically.
    - 'earliest': retrieves earliest observations by MJD, sorted chronologically.
    """
    norm_detector = normalize_detector_name(detector)

    # Determine query ordering and TAP limit based on sampling mode
    if sampling == "latest":
        query_order = "DESC"
        tap_limit = limit
    elif sampling == "baseline" and limit and limit > 1:
        # Fetch larger pool to sample across full temporal baseline
        query_order = "ASC"
        tap_limit = max(int(limit) * 4, 100)
    else:
        query_order = order_by
        tap_limit = limit

    query = build_tap_query(
        ra_deg=ra_deg,
        dec_deg=dec_deg,
        fov_deg=fov_deg,
        detector=norm_detector,
        limit=tap_limit,
        order_by=query_order,
        mjd_min=mjd_min,
        mjd_max=mjd_max,
    )
    logger.info(f"Executing IRSA TAP query for RA={ra_deg:.5f}, Dec={dec_deg:.5f}, FOV={fov_deg:.4f}, detector={norm_detector}, sampling={sampling}")

    try:
        try:
            table_result = Irsa.query_tap(query).to_table()
        except Exception as tap_err:
            logger.info(f"Astroquery TAP fallback to PyVO: {tap_err}")
            service = pyvo.dal.TAPService("https://irsa.ipac.caltech.edu/TAP")
            table_result = service.search(query).to_table()
        rows: List[Dict[str, Any]] = []
        for row in table_result:
            rows.append({
                "cutout_url": str(row["cutout_url"]).strip(),
                "full_mef_url": str(row["full_mef_url"]).strip(),
                "obs_mjd_start": float(row["obs_mjd_start"]),
                "obs_mjd_end": float(row["obs_mjd_end"]),
                "detector_band": str(row["detector_band"]).strip(),
                "version": str(row["version"]).strip() if "version" in row.colnames else "DR1",
            })
        logger.info(f"IRSA TAP returned {len(rows)} cutouts.")

        if not rows:
            return []

        # If baseline sampling is requested, sample across the temporal baseline
        # Group into chronological epoch slices with candidate fallbacks (handles 503 resilience)
        if sampling == "baseline" and limit and len(rows) > limit:
            rows.sort(key=lambda r: r["obs_mjd_start"])
            buckets = np.array_split(np.arange(len(rows)), min(int(limit), len(rows)))
            sampled_rows = []
            for bucket in buckets:
                if len(bucket) == 0:
                    continue
                mid_i = bucket[len(bucket) // 2]
                primary_row = dict(rows[mid_i])
                backup_indices = [i for i in bucket if i != mid_i]
                if backup_indices:
                    pick = np.linspace(0, len(backup_indices) - 1, min(3, len(backup_indices)), dtype=int)
                    primary_row["fallback_candidates"] = [rows[backup_indices[p]] for p in pick]
                else:
                    primary_row["fallback_candidates"] = []
                sampled_rows.append(primary_row)
            rows = sampled_rows

        # Always preserve chronological ordering in returned observations
        rows.sort(key=lambda r: r["obs_mjd_start"])
        if limit and len(rows) > limit:
            rows = rows[:int(limit)]

        return rows
    except Exception as exc:
        logger.error(f"Error querying IRSA TAP: {exc}", exc_info=True)
        raise RuntimeError(f"Failed to query IRSA TAP: {exc}") from exc


_RESILIENT_SESSION: Optional[requests.Session] = None


def create_resilient_session() -> requests.Session:
    """
    Create a resilient requests.Session configured with Retry and HTTPAdapter
    to gracefully handle 503 / 429 / 500 / 502 / 504 server overload errors.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (SPHEREx-Sky-Explorer-Research/1.0; NASA/IPAC IRSA Pipeline)"
    })
    retry_strategy = Retry(
        total=5,
        backoff_factor=2.0,  # 2s, 4s, 8s, 16s, 32s backoff
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=10,
        pool_maxsize=10,
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def get_resilient_session() -> requests.Session:
    """Retrieve or initialize the thread-safe resilient HTTP session."""
    global _RESILIENT_SESSION
    if _RESILIENT_SESSION is None:
        _RESILIENT_SESSION = create_resilient_session()
    return _RESILIENT_SESSION


def download_fits_bytes(
    url: str,
    timeout: int = 90,
    max_retries: int = 5,
    session: Optional[requests.Session] = None,
) -> bytes:
    """
    Download FITS data into memory with 503 exponential backoff and certifi SSL context.
    """
    if session is None:
        session = get_resilient_session()

    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            # Small jitter delay to prevent concurrent burst limits at IRSA
            time.sleep(random.uniform(0.15, 0.45))
            response = session.get(url, timeout=timeout, verify=certifi.where())
            response.raise_for_status()
            if len(response.content) < 2880:
                raise ValueError(f"Downloaded content too small for FITS: {len(response.content)} bytes")
            return response.content
        except Exception as err:
            last_error = err
            wait_time = min(30.0, (2.0 ** attempt) + random.uniform(0.2, 0.8))
            logger.warning(
                f"Download attempt {attempt}/{max_retries} failed for {url}: {err}. "
                f"Retrying in {wait_time:.1f}s..."
            )
            time.sleep(wait_time)

    raise ConnectionError(f"Failed to download cutout from {url} after {max_retries} attempts: {last_error}")


def _parse_fits_cutout(
    raw_bytes: bytes,
    target_coord: SkyCoord,
    meta: Dict[str, Any],
    remove_zodi: bool = True,
) -> Dict[str, Any]:
    with fits.open(io.BytesIO(raw_bytes)) as hdul:
        if "IMAGE" not in hdul:
            raise ValueError(f"Missing 'IMAGE' HDU in cutout {meta.get('cutout_url')}")

        img_hdu = hdul["IMAGE"]
        img_data = img_hdu.data.astype(np.float32)
        header = img_hdu.header.copy()

        # Spatial WCS & target pixel coordinates
        spatial_wcs = WCS(header)
        x_pix, y_pix = spatial_wcs.world_to_pixel(target_coord)
        x_pix_f = float(x_pix)
        y_pix_f = float(y_pix)

        # HDU 4: ZODI background model subtraction
        zodi_subtracted = False
        zodi_mean = 0.0
        if remove_zodi and "ZODI" in hdul and hdul["ZODI"].data is not None:
            zodi_data = hdul["ZODI"].data.astype(np.float32)
            zodi_mean = float(np.nanmean(zodi_data))
            img_data = img_data - zodi_data
            zodi_subtracted = True

        # HDU 2: FLAGS 32-bit bitmask & bad-pixel masking (Flags 0x1 | 0x2)
        flags_data = None
        if "FLAGS" in hdul and hdul["FLAGS"].data is not None:
            flags_data = hdul["FLAGS"].data.astype(np.int32)
            bad_mask = (flags_data & 3) > 0
            img_data[bad_mask] = np.nan

        # HDU 3: VARIANCE noise map (MJy/sr)^2
        variance_data = None
        if "VARIANCE" in hdul and hdul["VARIANCE"].data is not None:
            variance_data = hdul["VARIANCE"].data.astype(np.float32)

        # HDU 6: WCS-WAVE spectral coordinate extraction
        wavelength_um = None
        bandwidth_um = None
        try:
            spectral_wcs = WCS(header=header, fobj=hdul, key="W")
            w_val, bw_val = spectral_wcs.pixel_to_world_values(x_pix_f, y_pix_f)
            if np.isfinite(w_val) and w_val > 0:
                wavelength_um = float(w_val)
                bandwidth_um = float(bw_val) if np.isfinite(bw_val) else 0.02
        except Exception as wcs_err:
            logger.debug(f"WCS key='W' lookup failed: {wcs_err}. Using nominal bandpass.")

        # Fallback to nominal detector range if WCS key='W' was not available
        detector_band = meta.get("detector_band", "SPHEREx-D1")
        if wavelength_um is None or not np.isfinite(wavelength_um):
            band_range = DETECTOR_WAVELENGTH_RANGES.get(detector_band, (1.0, 1.5))
            wavelength_um = float((band_range[0] + band_range[1]) / 2.0)
            bandwidth_um = float((band_range[1] - band_range[0]) / 17.0)

        return {
            "image": img_data,
            "flags": flags_data,
            "variance": variance_data,
            "header": header,
            "spatial_wcs": spatial_wcs,
            "target_pixel": (x_pix_f, y_pix_f),
            "wavelength_um": wavelength_um,
            "bandwidth_um": bandwidth_um,
            "obs_mjd_start": meta["obs_mjd_start"],
            "obs_mjd_end": meta["obs_mjd_end"],
            "detector_band": detector_band,
            "version": meta.get("version", "DR1"),
            "cutout_url": meta["cutout_url"],
            "zodi_subtracted": zodi_subtracted,
            "zodi_mean": zodi_mean,
        }


def process_single_cutout(
    cutout_meta: Dict[str, Any],
    target_coord: SkyCoord,
    remove_zodi: bool = True,
    timeout: int = 90,
    max_retries: int = 5,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch and parse a single Multi-Extension FITS (MEF) cutout with auto-fallback candidate exposures.
    
    1. Reads HDU 1 ('IMAGE') surface brightness (MJy/sr).
    2. Subtracts HDU 4 ('ZODI') if present and remove_zodi is True.
    3. Extracts HDU 2 ('FLAGS') bitmask and masks bad/saturated pixels.
    4. Evaluates exact target wavelength (um) and bandwidth (um) using WCS key='W'.
    5. Automatically falls back to nearby candidate exposures if primary URL returns 503/errors.
    """
    if session is None:
        session = get_resilient_session()

    candidates = [cutout_meta] + cutout_meta.get("fallback_candidates", [])

    for idx, cand in enumerate(candidates):
        url = cand["cutout_url"]
        try:
            raw_bytes = download_fits_bytes(url, timeout=timeout, max_retries=max_retries, session=session)
            parsed = _parse_fits_cutout(raw_bytes, target_coord, cand, remove_zodi=remove_zodi)
            if idx > 0:
                logger.info(f"Successfully retrieved fallback candidate #{idx} for {cand.get('detector_band')}")
            return parsed
        except Exception as exc:
            if idx < len(candidates) - 1:
                logger.warning(
                    f"Cutout candidate #{idx+1} ({url}) failed: {exc}. Trying next candidate in epoch..."
                )
            else:
                logger.error(f"All {len(candidates)} cutout candidate(s) failed for {url}: {exc}")
                return None

    return None


def fetch_cutouts_parallel(
    tap_rows: List[Dict[str, Any]],
    target_coord: SkyCoord,
    max_workers: int = 2,
    remove_zodi: bool = True,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch Multi-Extension FITS (MEF) cutouts concurrently using ThreadPoolExecutor.
    Uses max_workers=2 and resilient retry logic to avoid triggering IRSA 503 burst limits.
    
    Returns list of successfully processed cutout dictionaries sorted by obs_mjd_start.
    """
    if limit and limit > 0:
        tap_rows = tap_rows[:limit]

    logger.info(f"Fetching {len(tap_rows)} cutouts in parallel with {max_workers} workers...")
    session = get_resilient_session()

    results: List[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {
            executor.submit(
                process_single_cutout,
                row,
                target_coord,
                remove_zodi,
                90,
                5,
                session,
            ): row["cutout_url"]
            for row in tap_rows
        }

        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                cutout_dict = future.result()
                if cutout_dict is not None:
                    results.append(cutout_dict)
            except Exception as err:
                logger.warning(f"Worker exception for cutout {url}: {err}")

    # Sort results chronologically by MJD
    results.sort(key=lambda item: item["obs_mjd_start"])
    logger.info(f"Successfully processed {len(results)} of {len(tap_rows)} cutouts.")
    return results
