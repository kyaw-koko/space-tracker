"""
SPHEREx Multi-Mission Catalog Cross-Match Module.
Queries Gaia DR3 and AllWISE via astroquery within the requested FOV.
Transforms celestial coordinates into normalized pixel coordinates (x, y)
on the reference North-Up TAN WCS grid and computes proper motion vectors.
"""

import concurrent.futures
import json
import logging
import os
import pickle
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.utils.data import conf
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa
from astroquery.vizier import Vizier

# Configure remote network timeout to prevent hanging connections
conf.remote_timeout = 60

# Point Vizier to reliable US Harvard mirror to avoid Strasbourg 404s
Vizier.VIZIER_SERVER = "vizier.cfa.harvard.edu"

logger = logging.getLogger("spherex.catalog_overlay")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# In-Memory Cache for multi-mission catalog queries to avoid redundant network hits
RAW_CATALOG_CACHE: Dict[str, Dict[str, Any]] = {}
CATALOG_CACHE_MAX_ENTRIES = 50


def query_gaia_dr3(
    target_coord: SkyCoord,
    radius: u.Quantity,
    max_rows: int = 150,
) -> List[Dict[str, Any]]:
    """
    Query Gaia DR3 sources within cone radius.
    First tries IRSA 'gaia_dr3_source', falls back to Vizier 'I/355/gaiadr3'.
    Distinguishes missing proper motion / parallax / magnitudes from zero.
    """
    results: List[Dict[str, Any]] = []

    # 1. Try IRSA
    try:
        table = Irsa.query_region(target_coord, catalog="gaia_dr3_source", radius=radius)
        if table is not None and len(table) > 0:
            for row in table[:max_rows]:
                ra = float(row["ra"])
                dec = float(row["dec"])
                pmra = float(row["pmra"]) if ("pmra" in row.colnames and np.isfinite(row["pmra"])) else None
                pmdec = float(row["pmdec"]) if ("pmdec" in row.colnames and np.isfinite(row["pmdec"])) else None
                pm_tot = float(np.sqrt(pmra**2 + pmdec**2)) if (pmra is not None and pmdec is not None) else None
                g_mag = float(row["phot_g_mean_mag"]) if ("phot_g_mean_mag" in row.colnames and np.isfinite(row["phot_g_mean_mag"])) else None
                bp_mag = float(row["phot_bp_mean_mag"]) if ("phot_bp_mean_mag" in row.colnames and np.isfinite(row["phot_bp_mean_mag"])) else None
                rp_mag = float(row["phot_rp_mean_mag"]) if ("phot_rp_mean_mag" in row.colnames and np.isfinite(row["phot_rp_mean_mag"])) else None
                parallax = float(row["parallax"]) if ("parallax" in row.colnames and np.isfinite(row["parallax"])) else None
                desig = str(row["designation"]).strip() if "designation" in row.colnames else f"Gaia DR3 {row.get('source_id', '')}"

                results.append({
                    "catalog": "Gaia DR3",
                    "designation": desig,
                    "ra": ra,
                    "dec": dec,
                    "pmra_mas_yr": pmra,
                    "pmdec_mas_yr": pmdec,
                    "pm_total_mas_yr": pm_tot,
                    "pm_source": "catalog_predicted",
                    "mag_g": g_mag,
                    "mag_bp": bp_mag,
                    "mag_rp": rp_mag,
                    "parallax_mas": parallax,
                })
            logger.info(f"Retrieved {len(results)} Gaia DR3 sources via IRSA.")
            return results
    except Exception as exc:
        logger.warning(f"IRSA Gaia DR3 query encountered issue: {exc}. Trying ESA Gaia TAP fallback...")

    # 2. Fallback to ESA Gaia TAP
    try:
        from astroquery.gaia import Gaia
        Gaia.ROW_LIMIT = max_rows
        job = Gaia.cone_search_async(target_coord, radius=radius)
        g_table = job.get_results()
        if g_table is not None and len(g_table) > 0:
            for row in g_table[:max_rows]:
                ra = float(row["ra"])
                dec = float(row["dec"])
                pmra = float(row["pmra"]) if ("pmra" in row.colnames and np.isfinite(row["pmra"])) else None
                pmdec = float(row["pmdec"]) if ("pmdec" in row.colnames and np.isfinite(row["pmdec"])) else None
                pm_tot = float(np.sqrt(pmra**2 + pmdec**2)) if (pmra is not None and pmdec is not None) else None
                g_mag = float(row["phot_g_mean_mag"]) if ("phot_g_mean_mag" in row.colnames and np.isfinite(row["phot_g_mean_mag"])) else None
                bp_mag = float(row["phot_bp_mean_mag"]) if ("phot_bp_mean_mag" in row.colnames and np.isfinite(row["phot_bp_mean_mag"])) else None
                rp_mag = float(row["phot_rp_mean_mag"]) if ("phot_rp_mean_mag" in row.colnames and np.isfinite(row["phot_rp_mean_mag"])) else None
                parallax = float(row["parallax"]) if ("parallax" in row.colnames and np.isfinite(row["parallax"])) else None
                desig = f"Gaia DR3 {row.get('source_id', '')}"
                results.append({
                    "catalog": "Gaia DR3",
                    "designation": desig,
                    "ra": ra,
                    "dec": dec,
                    "pmra_mas_yr": pmra,
                    "pmdec_mas_yr": pmdec,
                    "pm_total_mas_yr": pm_tot,
                    "pm_source": "catalog_predicted",
                    "mag_g": g_mag,
                    "mag_bp": bp_mag,
                    "mag_rp": rp_mag,
                    "parallax_mas": parallax,
                })
            logger.info(f"Retrieved {len(results)} Gaia DR3 sources via ESA Gaia TAP.")
            return results
    except Exception as gaia_err:
        logger.warning(f"ESA Gaia TAP fallback issue: {gaia_err}. Trying Harvard VizieR fallback...")

    # 3. Fallback to Harvard Vizier
    try:
        v = Vizier(columns=["Source", "RA_ICRS", "DE_ICRS", "pmRA", "pmDE", "Gmag", "BPmag", "RPmag", "Plx"], row_limit=max_rows)
        v_res = v.query_region(target_coord, radius=radius, catalog="I/355/gaiadr3")
        if v_res and len(v_res) > 0:
            vt = v_res[0]
            for row in vt:
                ra = float(row["RA_ICRS"])
                dec = float(row["DE_ICRS"])
                pmra = float(row["pmRA"]) if ("pmRA" in row.colnames and np.isfinite(row["pmRA"])) else None
                pmdec = float(row["pmDE"]) if ("pmDE" in row.colnames and np.isfinite(row["pmDE"])) else None
                pm_tot = float(np.sqrt(pmra**2 + pmdec**2)) if (pmra is not None and pmdec is not None) else None
                g_mag = float(row["Gmag"]) if ("Gmag" in row.colnames and np.isfinite(row["Gmag"])) else None
                bp_mag = float(row["BPmag"]) if ("BPmag" in row.colnames and np.isfinite(row["BPmag"])) else None
                rp_mag = float(row["RPmag"]) if ("RPmag" in row.colnames and np.isfinite(row["RPmag"])) else None
                plx = float(row["Plx"]) if ("Plx" in row.colnames and np.isfinite(row["Plx"])) else None

                results.append({
                    "catalog": "Gaia DR3",
                    "designation": f"Gaia DR3 {row['Source']}",
                    "ra": ra,
                    "dec": dec,
                    "pmra_mas_yr": pmra,
                    "pmdec_mas_yr": pmdec,
                    "pm_total_mas_yr": pm_tot,
                    "pm_source": "catalog_predicted",
                    "mag_g": g_mag,
                    "mag_bp": bp_mag,
                    "mag_rp": rp_mag,
                    "parallax_mas": plx,
                })
            logger.info(f"Retrieved {len(results)} Gaia DR3 sources via VizieR fallback.")
            return results
    except Exception as v_exc:
        logger.warning(f"Vizier Gaia DR3 fallback failed: {v_exc}")

    return results


def query_allwise(
    target_coord: SkyCoord,
    radius: u.Quantity,
    max_rows: int = 150,
) -> List[Dict[str, Any]]:
    """
    Query AllWISE infrared source catalog within cone radius.
    First tries IRSA 'allwise_p3as_psd', falls back to Vizier 'II/328/allwise'.
    Distinguishes missing catalog values from zero.
    """
    results: List[Dict[str, Any]] = []

    # 1. Try IRSA
    try:
        table = Irsa.query_region(target_coord, catalog="allwise_p3as_psd", radius=radius)
        if table is not None and len(table) > 0:
            for row in table[:max_rows]:
                ra = float(row["ra"])
                dec = float(row["dec"])
                pmra = float(row["pmra"]) if ("pmra" in row.colnames and np.isfinite(row["pmra"])) else None
                pmdec = float(row["pmdec"]) if ("pmdec" in row.colnames and np.isfinite(row["pmdec"])) else None
                pm_tot = float(np.sqrt(pmra**2 + pmdec**2)) if (pmra is not None and pmdec is not None) else None
                w1 = float(row["w1mpro"]) if ("w1mpro" in row.colnames and np.isfinite(row["w1mpro"])) else None
                w2 = float(row["w2mpro"]) if ("w2mpro" in row.colnames and np.isfinite(row["w2mpro"])) else None
                w3 = float(row["w3mpro"]) if ("w3mpro" in row.colnames and np.isfinite(row["w3mpro"])) else None
                w4 = float(row["w4mpro"]) if ("w4mpro" in row.colnames and np.isfinite(row["w4mpro"])) else None
                desig = str(row["designation"]).strip() if "designation" in row.colnames else "WISE Source"

                results.append({
                    "catalog": "AllWISE",
                    "designation": desig,
                    "ra": ra,
                    "dec": dec,
                    "pmra_mas_yr": pmra,
                    "pmdec_mas_yr": pmdec,
                    "pm_total_mas_yr": pm_tot,
                    "pm_source": "catalog_predicted",
                    "w1_mag": w1,
                    "w2_mag": w2,
                    "w3_mag": w3,
                    "w4_mag": w4,
                })
            logger.info(f"Retrieved {len(results)} AllWISE sources via IRSA.")
            return results
    except Exception as exc:
        logger.warning(f"IRSA AllWISE query encountered issue: {exc}. Trying VizieR fallback...")

    # 2. Fallback to Vizier
    try:
        v = Vizier(columns=["AllWISE", "RAJ2000", "DEJ2000", "pmRA", "pmDE", "W1mag", "W2mag", "W3mag", "W4mag"], row_limit=max_rows)
        v_res = v.query_region(target_coord, radius=radius, catalog="II/328/allwise")
        if v_res and len(v_res) > 0:
            vt = v_res[0]
            for row in vt:
                ra = float(row["RAJ2000"])
                dec = float(row["DEJ2000"])
                pmra = float(row["pmRA"]) if ("pmRA" in row.colnames and np.isfinite(row["pmRA"])) else None
                pmdec = float(row["pmDE"]) if ("pmDE" in row.colnames and np.isfinite(row["pmDE"])) else None
                pm_tot = float(np.sqrt(pmra**2 + pmdec**2)) if (pmra is not None and pmdec is not None) else None
                w1 = float(row["W1mag"]) if ("W1mag" in row.colnames and np.isfinite(row["W1mag"])) else None
                w2 = float(row["W2mag"]) if ("W2mag" in row.colnames and np.isfinite(row["W2mag"])) else None
                w3 = float(row["W3mag"]) if ("W3mag" in row.colnames and np.isfinite(row["W3mag"])) else None
                w4 = float(row["W4mag"]) if ("W4mag" in row.colnames and np.isfinite(row["W4mag"])) else None

                results.append({
                    "catalog": "AllWISE",
                    "designation": f"WISE {row['AllWISE']}",
                    "ra": ra,
                    "dec": dec,
                    "pmra_mas_yr": pmra,
                    "pmdec_mas_yr": pmdec,
                    "pm_total_mas_yr": pm_tot,
                    "pm_source": "catalog_predicted",
                    "w1_mag": w1,
                    "w2_mag": w2,
                    "w3_mag": w3,
                    "w4_mag": w4,
                })
            logger.info(f"Retrieved {len(results)} AllWISE sources via VizieR fallback.")
            return results
    except Exception as v_exc:
        logger.warning(f"Vizier AllWISE fallback failed: {v_exc}")

    return results

    return results


def project_sources_to_wcs(
    sources: List[Dict[str, Any]],
    ref_wcs: WCS,
    shape_out: Tuple[int, int],
    pixel_scale_arcsec: float = 6.2,
    proper_motion_baseline_years: float = 10.0,
) -> List[Dict[str, Any]]:
    """
    Project catalog sources onto reference WCS grid.
    Computes:
    - Pixel coordinates (pixel_x, pixel_y)
    - Normalized canvas coordinates (norm_x, norm_y) [0.0, 1.0]
    - Canvas-relative proper motion vectors (delta_x_canvas, delta_y_canvas)
    """
    height, width = shape_out
    projected: List[Dict[str, Any]] = []

    for src in sources:
        coord = SkyCoord(ra=src["ra"] * u.deg, dec=src["dec"] * u.deg, frame="icrs")
        try:
            x_pix, y_pix = ref_wcs.world_to_pixel(coord)
            x_f = float(x_pix)
            y_f = float(y_pix)

            # Normalized canvas coordinates (0.0 to 1.0)
            # In HTML5 Canvas, (0, 0) is top-left and y goes downwards.
            # In FITS WCS, y=0 is bottom row and y increases upwards.
            norm_x = x_f / float(width)
            norm_y_fits = y_f / float(height)
            norm_y_canvas = 1.0 - norm_y_fits

            # Include sources within canvas plus a 10% outer margin
            if -0.1 <= norm_x <= 1.1 and -0.1 <= norm_y_fits <= 1.1:
                pmra = src.get("pmra_mas_yr")
                pmdec = src.get("pmdec_mas_yr")
                has_pm = bool(pmra is not None and pmdec is not None and np.isfinite(pmra) and np.isfinite(pmdec))

                if has_pm:
                    # Total arcsec motion over baseline
                    motion_ra_arcsec = (float(pmra) * proper_motion_baseline_years) / 1000.0
                    motion_dec_arcsec = (float(pmdec) * proper_motion_baseline_years) / 1000.0

                    # Convert to pixel displacement
                    # East is towards -x, North is towards +y (FITS)
                    delta_x_pix = -motion_ra_arcsec / pixel_scale_arcsec
                    delta_y_pix = motion_dec_arcsec / pixel_scale_arcsec

                    delta_norm_x = delta_x_pix / float(width)
                    delta_norm_y = -delta_y_pix / float(height)
                else:
                    delta_x_pix = 0.0
                    delta_y_pix = 0.0
                    delta_norm_x = 0.0
                    delta_norm_y = 0.0

                item = dict(src)
                item.update({
                    "pixel_x": round(x_f, 2),
                    "pixel_y": round(y_f, 2),
                    "norm_x": round(norm_x, 4),
                    "norm_y": round(norm_y_fits, 4),
                    "norm_y_canvas": round(norm_y_canvas, 4),
                    "delta_x_pix": round(delta_x_pix, 3),
                    "delta_y_pix": round(delta_y_pix, 3),
                    "delta_norm_x": round(delta_norm_x, 5),
                    "delta_norm_y": round(delta_norm_y, 5),
                    "pm_baseline_years": proper_motion_baseline_years,
                    "has_proper_motion": has_pm,
                    "pm_source": "catalog_predicted",
                })
                projected.append(item)

        except Exception as exc:
            logger.debug(f"Coordinate projection error for {src['designation']}: {exc}")

    return projected


def cross_match_catalogs(
    ra_deg: float,
    dec_deg: float,
    fov_deg: float,
    ref_wcs: WCS,
    shape_out: Tuple[int, int],
    pixel_scale_arcsec: float = 6.2,
) -> Dict[str, Any]:
    """
    Execute full multi-mission catalog query and cross-match for Gaia DR3 and AllWISE.
    Uses in-memory cache and safe JSON disk cache to prevent redundant remote queries and timeouts.
    """
    cache_key = f"{ra_deg:.4f}_{dec_deg:.4f}_{fov_deg:.4f}"
    cached_entry = RAW_CATALOG_CACHE.get(cache_key)

    # 1. Check in-memory cache (24-hour TTL)
    if cached_entry and (time.time() - cached_entry.get("timestamp", 0) < 86400):
        logger.info(f"Using in-memory cached catalog astrometry for {cache_key}")
        raw_gaia = cached_entry["gaia"]
        raw_allwise = cached_entry["allwise"]
    else:
        # 2. Check on-disk persistent cache (safe JSON format, falling back to pkl if exists)
        disk_cache_dir = Path(".cache_spherex")
        disk_cache_dir.mkdir(exist_ok=True)
        json_file = disk_cache_dir / f"cat_{cache_key}.json"
        pkl_file = disk_cache_dir / f"cat_{cache_key}.pkl"

        disk_entry = None
        if json_file.exists():
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if time.time() - data.get("timestamp", 0) < 86400:
                    disk_entry = data
                    logger.info(f"Loaded persistent JSON catalog cache for {cache_key}")
            except Exception as e:
                logger.warning(f"Failed reading JSON catalog cache for {cache_key}: {e}")
        elif pkl_file.exists():
            try:
                with open(pkl_file, "rb") as f:
                    data = pickle.load(f)
                if time.time() - data.get("timestamp", 0) < 86400:
                    disk_entry = data
                    logger.info(f"Loaded legacy pickle catalog cache for {cache_key}")
            except Exception as e:
                logger.warning(f"Failed reading legacy disk cache for {cache_key}: {e}")

        if disk_entry is not None:
            raw_gaia = disk_entry["gaia"]
            raw_allwise = disk_entry["allwise"]
            RAW_CATALOG_CACHE[cache_key] = disk_entry
        else:
            target_coord = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
            search_radius = (fov_deg * np.sqrt(2.0) / 2.0) * u.deg

            logger.info(f"Querying Gaia DR3 & AllWISE concurrently within radius {search_radius.to(u.arcmin):.2f}...")

            # Run Gaia and AllWISE in parallel threads to cut remote query latency by 50%
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                f_gaia = executor.submit(query_gaia_dr3, target_coord, search_radius)
                f_allwise = executor.submit(query_allwise, target_coord, search_radius)
                raw_gaia = f_gaia.result()
                raw_allwise = f_allwise.result()

            cache_data = {
                "timestamp": time.time(),
                "gaia": raw_gaia,
                "allwise": raw_allwise,
            }

            RAW_CATALOG_CACHE[cache_key] = cache_data
            try:
                with open(json_file, "w", encoding="utf-8") as f:
                    json.dump(cache_data, f, indent=2)
            except Exception as e:
                logger.warning(f"Failed writing JSON disk catalog cache: {e}")

    projected_gaia = project_sources_to_wcs(raw_gaia, ref_wcs, shape_out, pixel_scale_arcsec)
    projected_allwise = project_sources_to_wcs(raw_allwise, ref_wcs, shape_out, pixel_scale_arcsec)

    return {
        "center": {"ra": ra_deg, "dec": dec_deg},
        "fov_deg": fov_deg,
        "pixel_scale_arcsec": pixel_scale_arcsec,
        "grid_dimensions": {"width": shape_out[1], "height": shape_out[0]},
        "gaia_count": len(projected_gaia),
        "allwise_count": len(projected_allwise),
        "gaia_sources": projected_gaia,
        "allwise_sources": projected_allwise,
    }
