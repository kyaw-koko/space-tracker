"""
SPHEREx Spectra Extractor Module.
Performs on-the-fly 102-band spectrophotometry:
1. Calculates target pixel coordinates from spatial WCS.
2. Performs circular aperture photometry across all cutouts.
3. Converts surface brightness (MJy/sr) to flux density (uJy) using pixel solid angle.
4. Propagates photometric uncertainties from VARIANCE (HDU 3).
5. Decodes pixel quality bitmasks from FLAGS (HDU 2).
6. Synthesizes a 102-channel Spectral Energy Distribution (SED) using inverse-variance weighting.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.wcs.utils import proj_plane_pixel_scales
from photutils.aperture import CircularAperture, aperture_photometry

logger = logging.getLogger("spherex.spectra_extractor")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# SPHEREx Bitmask flags dictionary (Level 2 specification)
SPHEREX_FLAGS = {
    0x0001: "NON_FUNCTIONAL",
    0x0002: "SATURATED",
    0x0004: "COSMIC_RAY",
    0x0008: "SOURCE_DETECTED",
    0x0010: "CONTAMINATION",
    0x0020: "EDGE_PIXEL",
    0x0040: "BAD_CALIBRATION",
    0x0080: "ZODI_OUTLIER",
}

BAD_FLAGS_MASK = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x0040 | 0x0080
INFO_FLAGS_MASK = 0x0008


def is_clean_measurement(flag_val: int) -> bool:
    """Return True if measurement contains NO bad pixel flags."""
    return bool((flag_val & BAD_FLAGS_MASK) == 0)


def decode_flags(flag_val: int) -> List[str]:
    """Decode integer bitmask into human-readable flag labels."""
    if flag_val == 0:
        return ["CLEAN"]

    labels = []
    # If no bad flags are raised, mark as CLEAN (even if SOURCE_DETECTED is present)
    if (flag_val & BAD_FLAGS_MASK) == 0:
        labels.append("CLEAN")

    for bit, name in SPHEREX_FLAGS.items():
        if flag_val & bit:
            labels.append(name)
    return labels if labels else [f"FLAG_{flag_val}"]


def compute_pixel_solid_angle_sr(spatial_wcs) -> float:
    """
    Calculate pixel solid angle (steradians) from spatial WCS.
    SPHEREx native resolution is ~6.2 arcsec/pixel.
    """
    try:
        scales = proj_plane_pixel_scales(spatial_wcs)
        # scales are in degrees per pixel
        pix_scale_deg = float(np.mean(scales))
        pix_scale_rad = pix_scale_deg * (np.pi / 180.0)
        omega = pix_scale_rad ** 2
        if 1e-12 < omega < 1e-6:
            return omega
    except Exception:
        pass

    # Standard SPHEREx 6.2 arcsec nominal pixel solid angle
    nom_scale_rad = (6.2 / 3600.0) * (np.pi / 180.0)
    return float(nom_scale_rad ** 2)


def extract_photometry_single(
    cutout: Dict[str, Any],
    target_coord: SkyCoord,
    aperture_radius_arcsec: float = 6.2,
) -> Optional[Dict[str, Any]]:
    """
    Extract aperture photometry from a single cutout for target coordinates.
    Converts MJy/sr to uJy flux density.
    """
    img_data = cutout["image"]
    spatial_wcs = cutout["spatial_wcs"]
    h, w = img_data.shape

    # Target pixel in this cutout
    try:
        x_pix, y_pix = spatial_wcs.world_to_pixel(target_coord)
        x_pix_f, y_pix_f = float(x_pix), float(y_pix)
    except Exception:
        return None

    if not np.isfinite(x_pix_f) or not np.isfinite(y_pix_f):
        return None

    # Check bounds
    if x_pix_f < 1.0 or x_pix_f >= (w - 1.0) or y_pix_f < 1.0 or y_pix_f >= (h - 1.0):
        return None

    # Calculate aperture radius in pixels
    pix_scales = proj_plane_pixel_scales(spatial_wcs)
    arcsec_per_pix = float(np.mean(pix_scales)) * 3600.0 if np.all(np.isfinite(pix_scales)) else 6.2
    if arcsec_per_pix <= 0 or not np.isfinite(arcsec_per_pix):
        arcsec_per_pix = 6.2

    r_pix = max(1.0, min(10.0, aperture_radius_arcsec / arcsec_per_pix))
    try:
        aperture = CircularAperture((x_pix_f, y_pix_f), r=r_pix)
    except Exception:
        return None

    # Uncertainty / Error Map from HDU 3 (VARIANCE)
    variance_data = cutout.get("variance")
    if variance_data is not None and np.any(np.isfinite(variance_data)):
        var_clipped = np.clip(np.nan_to_num(variance_data, nan=1e-4), 1e-10, None)
        error_map = np.sqrt(var_clipped)
    else:
        # Fallback noise estimate from robust MAD around image
        robust_rms = float(1.4826 * np.nanmedian(np.abs(img_data - np.nanmedian(img_data))))
        if robust_rms <= 0 or not np.isfinite(robust_rms):
            robust_rms = 0.05
        error_map = np.full_like(img_data, robust_rms)

    # Aperture Photometry with NaN safety
    clean_img = np.nan_to_num(img_data, nan=0.0)
    clean_err = np.nan_to_num(error_map, nan=0.05)
    try:
        phot_table = aperture_photometry(clean_img, aperture, error=clean_err)
        aperture_sum = float(phot_table["aperture_sum"][0])
        aperture_sum_err = float(phot_table["aperture_sum_err"][0])
    except Exception as exc:
        logger.warning(f"Aperture photometry error: {exc}")
        return None

    if not np.isfinite(aperture_sum):
        aperture_sum = 0.0
    if not np.isfinite(aperture_sum_err) or aperture_sum_err <= 0:
        aperture_sum_err = max(0.01, abs(aperture_sum) * 0.05)

    # Conversion from MJy/sr to uJy
    # 1 MJy = 10^12 uJy
    omega_pix = compute_pixel_solid_angle_sr(spatial_wcs)
    conversion_factor = omega_pix * 1e12

    flux_uJy = aperture_sum * conversion_factor
    flux_err_uJy = aperture_sum_err * conversion_factor

    if not np.isfinite(flux_uJy):
        flux_uJy = 0.0
    if not np.isfinite(flux_err_uJy) or flux_err_uJy <= 0:
        flux_err_uJy = max(0.1, abs(flux_uJy) * 0.05)

    snr = flux_uJy / flux_err_uJy if flux_err_uJy > 0 else 0.0
    if not np.isfinite(snr):
        snr = 0.0

    # FLAGS evaluation in aperture
    flags_data = cutout.get("flags")
    combined_flags = 0
    if flags_data is not None:
        try:
            mask = aperture.to_mask(method="center")
            flags_cutout = mask.cutout(flags_data)
            if flags_cutout is not None:
                combined_flags = int(np.bitwise_or.reduce(flags_cutout.flatten()))
        except Exception:
            xi = int(round(x_pix_f))
            yi = int(round(y_pix_f))
            if 0 <= xi < w and 0 <= yi < h:
                combined_flags = int(flags_data[yi, xi])

    return {
        "wavelength_um": round(float(cutout["wavelength_um"]), 4),
        "bandwidth_um": round(float(cutout["bandwidth_um"]), 4),
        "flux_uJy": round(float(flux_uJy), 3),
        "flux_err_uJy": round(float(flux_err_uJy), 3),
        "snr": round(float(snr), 2),
        "obs_mjd": round(float(cutout["obs_mjd_start"]), 5),
        "detector": cutout["detector_band"],
        "aperture_radius_arcsec": aperture_radius_arcsec,
        "flags": combined_flags,
        "is_clean": is_clean_measurement(combined_flags),
        "flag_labels": decode_flags(combined_flags),
        "pixel_x": round(x_pix_f, 2),
        "pixel_y": round(y_pix_f, 2),
    }


def synthesize_102_band_spectrum(
    raw_points: List[Dict[str, Any]],
    num_bins: int = 102,
    min_wave: float = 0.75,
    max_wave: float = 5.00,
) -> List[Dict[str, Any]]:
    """
    Bin multi-epoch spectrophotometric observations into the nominal 102 SPHEREx
    spectral channels using inverse-variance weighting.
    """
    if not raw_points:
        return []

    # Nominal logarithmically/linearly spaced SPHEREx channel edges
    # Detector boundaries:
    # D1: 0.75 - 1.09 (17 channels)
    # D2: 1.10 - 1.62 (17 channels)
    # D3: 1.63 - 2.41 (17 channels)
    # D4: 2.42 - 3.82 (17 channels)
    # D5: 3.83 - 4.41 (17 channels)
    # D6: 4.42 - 5.00 (17 channels)
    # Total = 102 channels
    detector_specs = [
        ("SPHEREx-D1", 0.75, 1.09, 17),
        ("SPHEREx-D2", 1.10, 1.62, 17),
        ("SPHEREx-D3", 1.63, 2.41, 17),
        ("SPHEREx-D4", 2.42, 3.82, 17),
        ("SPHEREx-D5", 3.83, 4.41, 17),
        ("SPHEREx-D6", 4.42, 5.00, 17),
    ]

    bins = []
    for det, w_start, w_end, n_ch in detector_specs:
        edges = np.linspace(w_start, w_end, n_ch + 1)
        for i in range(n_ch):
            center = (edges[i] + edges[i + 1]) / 2.0
            width = edges[i + 1] - edges[i]
            bins.append({
                "detector": det,
                "w_low": edges[i],
                "w_high": edges[i + 1],
                "wavelength_um": round(center, 4),
                "bandwidth_um": round(width, 4),
            })

    # Group raw observations into matching bins
    binned_spectrum: List[Dict[str, Any]] = []

    for b in bins:
        matched = [
            p for p in raw_points
            if b["w_low"] <= p["wavelength_um"] < b["w_high"]
        ]

        if not matched:
            # Check if any within half a bandwidth
            matched = [
                p for p in raw_points
                if abs(p["wavelength_um"] - b["wavelength_um"]) <= (b["bandwidth_um"] / 2.0)
            ]

        if matched:
            # Inverse-variance weighted mean
            weights = [1.0 / max(1e-4, (p["flux_err_uJy"] ** 2)) for p in matched]
            sum_w = sum(weights)
            weighted_flux = sum(w * p["flux_uJy"] for w, p in zip(weights, matched)) / sum_w
            weighted_err = np.sqrt(1.0 / sum_w)
            snr = weighted_flux / weighted_err if weighted_err > 0 else 0.0
            flags = int(np.bitwise_or.reduce([p["flags"] for p in matched]))

            binned_spectrum.append({
                "channel_index": len(binned_spectrum) + 1,
                "wavelength_um": b["wavelength_um"],
                "bandwidth_um": b["bandwidth_um"],
                "flux_uJy": round(float(weighted_flux), 3),
                "flux_err_uJy": round(float(weighted_err), 3),
                "snr": round(float(snr), 2),
                "detector": b["detector"],
                "observations_combined": len(matched),
                "flags": flags,
                "is_clean": is_clean_measurement(flags),
                "flag_labels": decode_flags(flags),
            })
        else:
            # Channel without active exposure
            binned_spectrum.append({
                "channel_index": len(binned_spectrum) + 1,
                "wavelength_um": b["wavelength_um"],
                "bandwidth_um": b["bandwidth_um"],
                "flux_uJy": None,
                "flux_err_uJy": None,
                "snr": None,
                "detector": b["detector"],
                "observations_combined": 0,
                "flags": 0,
                "is_clean": False,
                "flag_labels": ["NO_DATA"],
            })

    return binned_spectrum


def extract_full_spectrum(
    cutouts: List[Dict[str, Any]],
    target_coord: SkyCoord,
    aperture_radius_arcsec: float = 6.2,
) -> Dict[str, Any]:
    """
    Extract complete spectrophotometric dataset across all cutouts.
    Returns:
    - raw_points: All individual aperture photometry measurements sorted by wavelength
    - binned_102_band: The canonical 102-band SPHEREx SED
    - summary: Spectral statistics
    """
    raw_points: List[Dict[str, Any]] = []

    for cutout in cutouts:
        pt = extract_photometry_single(cutout, target_coord, aperture_radius_arcsec)
        if pt is not None:
            raw_points.append(pt)

    # Sort strictly by wavelength
    raw_points.sort(key=lambda p: p["wavelength_um"])

    binned_102 = synthesize_102_band_spectrum(raw_points)

    valid_fluxes = [p["flux_uJy"] for p in raw_points if p["flux_uJy"] is not None]
    summary = {
        "total_channels": 102,
        "total_observations": len(raw_points),
        "covered_channels": len([b for b in binned_102 if b["flux_uJy"] is not None]),
        "missing_channels": len([b for b in binned_102 if b["flux_uJy"] is None]),
        "clean_channels": len([b for b in binned_102 if b["flux_uJy"] is not None and b.get("is_clean", True)]),
        "min_wavelength_um": raw_points[0]["wavelength_um"] if raw_points else None,
        "max_wavelength_um": raw_points[-1]["wavelength_um"] if raw_points else None,
        "peak_flux_uJy": max(valid_fluxes) if valid_fluxes else None,
        "median_flux_uJy": float(np.median(valid_fluxes)) if valid_fluxes else None,
        "mean_snr": float(np.mean([p["snr"] for p in raw_points])) if raw_points else None,
    }

    return {
        "raw_points": raw_points,
        "binned_102_band": binned_102,
        "summary": summary,
    }
