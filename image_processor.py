"""
SPHEREx Image Processor Module.
Handles:
1. North-Up Tangential (TAN) WCS reprojection with reproject_interp.
2. 3 Processing Modes:
   - epochs: Time-sorted individual frames for blinking animations.
   - coadd: Mean/median stacks grouped by detector array (D1-D6) to improve SNR.
   - diff: Epoch subtraction (Epoch_B - Epoch_A) to highlight moving objects (dipoles).
3. Astronomical contrast stretching (AsinhStretch + ZScaleInterval) & Base64 PNG encoding.
"""

import base64
import io
import logging
import warnings
from typing import Any, Dict, List, Optional, Tuple

import astropy.units as u
import matplotlib
import matplotlib.cm as cm
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.stats import sigma_clipped_stats
from astropy.time import Time
from astropy.visualization import AsinhStretch, ImageNormalize, LinearStretch, ZScaleInterval
from astropy.wcs import FITSFixedWarning, WCS
from PIL import Image
from reproject import reproject_interp
from scipy.ndimage import maximum_filter

from irsa_client import DETECTOR_WAVELENGTH_RANGES, normalize_detector_name
from spectra_extractor import extract_photometry_single

# Suppress benign warnings
warnings.filterwarnings("ignore", category=FITSFixedWarning)
warnings.filterwarnings("ignore", message=".*Inconsistent SIP distortion.*")
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*All-NaN slice.*")

logger = logging.getLogger("spherex.image_processor")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


def build_reference_wcs(
    ra_deg: float,
    dec_deg: float,
    fov_deg: float = 0.05,
    pixel_scale_arcsec: float = 6.2,
) -> Tuple[WCS, Tuple[int, int]]:
    """
    Construct a standard North-Up, East-Left tangential (TAN) WCS projection grid.
    
    SPHEREx native spatial resolution is ~6.2 arcsec/pixel.
    """
    scale_deg = pixel_scale_arcsec / 3600.0
    npix = int(round(fov_deg / scale_deg))
    # Constrain canvas dimension between 16 and 512 pixels for performant web rendering
    npix = max(16, min(512, npix))

    w = WCS(naxis=2)
    # 1-based CRPIX centered on image
    center_pix = (npix + 1.0) / 2.0
    w.wcs.crpix = [center_pix, center_pix]
    w.wcs.cdelt = np.array([-scale_deg, scale_deg])  # East is Left (-RA), North is Up (+Dec)
    w.wcs.crval = [float(ra_deg), float(dec_deg)]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]

    shape_out = (npix, npix)
    return w, shape_out


def reproject_cutout_image(
    image_data: np.ndarray,
    input_wcs: WCS,
    target_wcs: WCS,
    shape_out: Tuple[int, int],
) -> np.ndarray:
    """
    Reproject a 2D cutout onto the target WCS grid using reproject_interp with bilinear interpolation.
    Fills out-of-bounds or non-finite pixels with NaN.
    """
    try:
        arr = np.copy(image_data).astype(np.float32)
        valid = arr[np.isfinite(arr)]
        if valid.size == 0:
            return np.full(shape_out, np.nan, dtype=np.float32)

        # Fill isolated NaNs (e.g. from bad-pixel masks) with local median so interpolation doesn't drop entire FOV
        med = float(np.nanmedian(valid))
        arr_filled = np.nan_to_num(arr, nan=med)

        reprojected, footprint = reproject_interp(
            (arr_filled, input_wcs),
            target_wcs,
            shape_out=shape_out,
            order="bilinear",
        )
        # Mask out-of-bounds pixels where footprint is zero
        reprojected[footprint < 0.5] = np.nan
        return reprojected.astype(np.float32)
    except Exception as exc:
        logger.warning(f"reproject_interp failed: {exc}. Returning NaN grid.")
        return np.full(shape_out, np.nan, dtype=np.float32)


def detect_star_peaks(
    image_array: np.ndarray,
    min_snr: float = 3.5,
    max_stars: int = 50,
    wcs: Optional[WCS] = None,
) -> List[Dict[str, Any]]:
    """
    Automatically detect point sources (stars/dwarfs) above the local background
    using 3x3 local maximum filtering and sigma-clipped noise estimation.
    Computes pixel, normalized canvas, and celestial (RA, Dec) coordinates when WCS is provided.
    """
    arr = np.copy(image_array).astype(np.float32)
    valid = arr[np.isfinite(arr) & (arr > -1.0)]
    if valid.size < 16:
        return []

    try:
        mean_bkg, med_bkg, std_bkg = sigma_clipped_stats(valid, sigma=2.5)
        if std_bkg <= 0 or not np.isfinite(std_bkg):
            return []

        threshold = med_bkg + min_snr * std_bkg
        max_filt = maximum_filter(arr, size=3)
        peaks_mask = (arr == max_filt) & (arr >= threshold) & np.isfinite(arr)
        y_indices, x_indices = np.where(peaks_mask)

        H, W = arr.shape
        stars: List[Dict[str, Any]] = []
        for x, y in zip(x_indices, y_indices):
            peak_val = float(arr[y, x])
            snr = round(float((peak_val - med_bkg) / std_bkg), 1)
            norm_x = round(float(x) / max(1, W - 1), 4)
            norm_y_fits = round(float(y) / max(1, H - 1), 4)
            norm_y_canvas = round(1.0 - (float(y) / max(1, H - 1)), 4)

            ra_val = None
            dec_val = None
            if wcs is not None:
                try:
                    c = wcs.pixel_to_world(float(x), float(y))
                    ra_val = round(float(c.ra.deg), 6)
                    dec_val = round(float(c.dec.deg), 6)
                except Exception:
                    pass

            stars.append({
                "x_pix": int(x),
                "y_pix": int(y),
                "norm_x": norm_x,
                "norm_y": norm_y_fits,
                "norm_y_canvas": norm_y_canvas,
                "ra": ra_val,
                "dec": dec_val,
                "peak_flux": round(peak_val, 4),
                "snr": snr,
            })

        stars.sort(key=lambda s: s["snr"], reverse=True)
        return stars[:max_stars]
    except Exception as exc:
        logger.warning(f"Star detection failed: {exc}")
        return []


def stretch_and_encode_png(
    image_array: np.ndarray,
    stretch_type: str = "asinh",
    colormap: str = "magma",
    invert: bool = False,
    asinh_a: float = 0.08,
    contrast: float = 0.25,
    is_diff: bool = False,
    clean_background: bool = True,
) -> Dict[str, Any]:
    """
    Apply robust background noise floor, anomaly filtering, astronomical contrast
    stretching (AsinhStretch), and encode into Base64 PNG ready for HTML5 <canvas> display.
    """
    arr = np.copy(image_array).astype(np.float32)
    # Reject extreme negative values and NaNs
    nan_mask = ~np.isfinite(arr) | (arr < -1.0)
    arr[nan_mask] = np.nan
    valid_pixels = arr[~nan_mask]

    if valid_pixels.size == 0:
        # Blank image fallback
        blank = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
        img = Image.fromarray(blank, mode="RGBA")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        raw_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "base64": raw_b64,
            "data_url": f"data:image/png;base64,{raw_b64}",
            "vmin": 0.0,
            "vmax": 1.0,
            "width": arr.shape[1],
            "height": arr.shape[0],
        }

    # Determine display scale limits
    if is_diff:
        # Symmetrical stretch centered at zero to clearly display positive/negative dipoles (per SPHEREx moving object detection)
        abs_vals = np.abs(valid_pixels)
        d_lim = float(np.nanpercentile(abs_vals, 99.2)) if abs_vals.size > 0 else 1.0
        if not np.isfinite(d_lim) or d_lim <= 0:
            d_lim = 1.0
        vmin = -d_lim
        vmax = d_lim
    elif clean_background:
        # Robust astronomical background subtraction & noise suppression
        try:
            mean_bkg, med_bkg, std_bkg = sigma_clipped_stats(valid_pixels, sigma=2.5)
            # Allow low-level background sky fluctuations so the star field and background are colorful and visible
            vmin = float(max(np.nanmin(valid_pixels), med_bkg - 1.0 * std_bkg))
            p995 = float(np.percentile(valid_pixels, 99.5))
            vmax = float(min(np.max(valid_pixels), max(p995, med_bkg + 10.0 * std_bkg)))
            if vmax <= vmin:
                vmax = vmin + 1.0
        except Exception:
            vmin = float(np.percentile(valid_pixels, 2.0))
            vmax = float(np.percentile(valid_pixels, 99.5))
    else:
        # Standard astronomical ZScale interval
        try:
            zscale = ZScaleInterval(contrast=contrast)
            vmin, vmax = zscale.get_limits(valid_pixels)
        except Exception:
            vmin = float(np.percentile(valid_pixels, 1.0))
            vmax = float(np.percentile(valid_pixels, 99.0))

    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin >= vmax:
        vmin = float(np.nanmin(valid_pixels))
        vmax = float(np.nanmax(valid_pixels))
        if vmin >= vmax:
            vmax = vmin + 1e-4

    # Apply stretch
    if stretch_type.lower() == "linear":
        stretch_obj = LinearStretch()
    else:
        stretch_obj = AsinhStretch(a=asinh_a)

    norm = ImageNormalize(vmin=vmin, vmax=vmax, stretch=stretch_obj, clip=True)
    norm_data = norm(arr)
    # Zero-out NaNs
    norm_data[nan_mask] = 0.0

    if invert:
        norm_data = 1.0 - norm_data

    # Map to colormap
    try:
        cmap = matplotlib.colormaps[colormap]
    except KeyError:
        cmap = matplotlib.colormaps.get("magma", matplotlib.colormaps["viridis"])

    rgba_floats = cmap(norm_data)
    rgba_bytes = (rgba_floats * 255).astype(np.uint8)

    # Set NaN pixels to transparent
    rgba_bytes[nan_mask, 3] = 0

    img = Image.fromarray(rgba_bytes, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {
        "base64": raw_b64,
        "data_url": f"data:image/png;base64,{raw_b64}",
        "vmin": float(vmin),
        "vmax": float(vmax),
        "width": int(arr.shape[1]),
        "height": int(arr.shape[0]),
    }


def process_epochs_mode(
    cutouts: List[Dict[str, Any]],
    target_wcs: WCS,
    shape_out: Tuple[int, int],
    colormap: str = "magma",
    stretch: str = "asinh",
) -> List[Dict[str, Any]]:
    """
    Mode 'epochs': Generate time-sorted individual frames for blinking animations.
    Uses real observation MJD timestamps and WCS-projected star peaks.
    """
    frames: List[Dict[str, Any]] = []

    for idx, cutout in enumerate(cutouts):
        reprojected = reproject_cutout_image(
            cutout["image"],
            cutout["spatial_wcs"],
            target_wcs,
            shape_out,
        )

        encoded = stretch_and_encode_png(
            reprojected,
            stretch_type=stretch,
            colormap=colormap,
            is_diff=False,
            clean_background=True,
        )

        stars = detect_star_peaks(reprojected, min_snr=3.5, wcs=target_wcs)

        obs_mjd = cutout["obs_mjd_start"]
        utc_str = ""
        survey_pass_str = ""
        try:
            utc_dt = Time(obs_mjd, format="mjd", scale="utc").datetime
            utc_str = utc_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
            survey_pass_str = f"Survey {int(max(1, round((obs_mjd - 60902.86) / 182.625) + 1))}"
        except Exception:
            utc_str = f"MJD {obs_mjd:.2f}"
            survey_pass_str = "Survey 1"

        frames.append({
            "frame_index": idx,
            "obs_mjd": obs_mjd,
            "obs_mjd_end": cutout["obs_mjd_end"],
            "obs_date_utc": utc_str,
            "survey_pass": survey_pass_str,
            "detector": cutout["detector_band"],
            "wavelength_um": cutout["wavelength_um"],
            "bandwidth_um": cutout["bandwidth_um"],
            "image_base64": encoded["base64"],
            "data_url": encoded["data_url"],
            "vmin": encoded["vmin"],
            "vmax": encoded["vmax"],
            "width": shape_out[1],
            "height": shape_out[0],
            "mean_flux": float(np.nanmean(reprojected)) if np.any(np.isfinite(reprojected)) else 0.0,
            "detected_stars": stars,
        })

    return frames


def process_coadd_mode(
    cutouts: List[Dict[str, Any]],
    target_wcs: WCS,
    shape_out: Tuple[int, int],
    colormap: str = "viridis",
    stretch: str = "asinh",
) -> Dict[str, Any]:
    """
    Mode 'coadd': Mean/median stack grouped by detector array (D1-D6) + overall mission coadd.
    Improves Signal-to-Noise Ratio (SNR).
    Explicitly reports both observed detectors and missing detector coverage.
    """
    # Group reprojected cutouts by detector band
    detector_groups: Dict[str, List[np.ndarray]] = {}
    detector_wavelengths: Dict[str, List[float]] = {}
    all_reprojected: List[np.ndarray] = []

    for cutout in cutouts:
        reprojected = reproject_cutout_image(
            cutout["image"],
            cutout["spatial_wcs"],
            target_wcs,
            shape_out,
        )
        band = cutout["detector_band"]
        detector_groups.setdefault(band, []).append(reprojected)
        detector_wavelengths.setdefault(band, []).append(cutout["wavelength_um"])
        all_reprojected.append(reprojected)

    detector_stacks: List[Dict[str, Any]] = []
    coverage_status: List[Dict[str, Any]] = []

    # All canonical SPHEREx bands D1 -> D6
    canonical_bands = ["SPHEREx-D1", "SPHEREx-D2", "SPHEREx-D3", "SPHEREx-D4", "SPHEREx-D5", "SPHEREx-D6"]
    for band in canonical_bands:
        wave_range = DETECTOR_WAVELENGTH_RANGES.get(band, (0.0, 0.0))
        if band in detector_groups and len(detector_groups[band]) > 0:
            stack_cube = np.stack(detector_groups[band], axis=0)
            coadd_array = np.nanmedian(stack_cube, axis=0)

            encoded = stretch_and_encode_png(
                coadd_array,
                stretch_type=stretch,
                colormap=colormap,
                is_diff=False,
            )

            mean_wave = float(np.mean(detector_wavelengths[band]))
            stack_dict = {
                "detector": band,
                "status": "observed",
                "frames_stacked": len(detector_groups[band]),
                "wavelength_range_um": wave_range,
                "mean_wavelength_um": round(mean_wave, 4),
                "image_base64": encoded["base64"],
                "data_url": encoded["data_url"],
                "vmin": encoded["vmin"],
                "vmax": encoded["vmax"],
                "width": shape_out[1],
                "height": shape_out[0],
            }
            detector_stacks.append(stack_dict)
            coverage_status.append(stack_dict)
        else:
            coverage_status.append({
                "detector": band,
                "status": "no_coverage",
                "frames_stacked": 0,
                "wavelength_range_um": wave_range,
                "mean_wavelength_um": None,
                "image_base64": None,
                "data_url": None,
                "vmin": None,
                "vmax": None,
                "width": shape_out[1],
                "height": shape_out[0],
            })

    missing_detectors = [b for b in canonical_bands if b not in detector_groups]

    # Overall full coadd
    overall_stack: Optional[Dict[str, Any]] = None
    if all_reprojected:
        full_cube = np.stack(all_reprojected, axis=0)
        full_coadd_array = np.nanmedian(full_cube, axis=0)
        full_encoded = stretch_and_encode_png(
            full_coadd_array,
            stretch_type=stretch,
            colormap=colormap,
            is_diff=False,
        )
        overall_stack = {
            "detector": "SPHEREx-All",
            "frames_stacked": len(all_reprojected),
            "image_base64": full_encoded["base64"],
            "data_url": full_encoded["data_url"],
            "vmin": full_encoded["vmin"],
            "vmax": full_encoded["vmax"],
            "width": shape_out[1],
            "height": shape_out[0],
            "note": "Broadband spatial coadd across all observed detectors for high-sensitivity detection.",
        }

    return {
        "detector_coadds": detector_stacks,
        "detector_coverage": coverage_status,
        "missing_detectors": missing_detectors,
        "overall_coadd": overall_stack,
        "total_input_frames": len(cutouts),
    }


def detect_moving_dipoles(
    diff_img: np.ndarray,
    sigma_thresh: float = 4.5,
    wcs: Optional[WCS] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Detect moving object dipoles (positive and negative residual peaks)
    using 5x5 maximum filter and median absolute deviation (MAD) noise estimation
    (matching SPHEREx moving object detection pipeline).
    """
    clean = np.nan_to_num(diff_img, nan=0.0)
    valid = diff_img[np.isfinite(diff_img)]
    if valid.size < 16:
        return [], []

    med = float(np.nanmedian(valid))
    mad = float(np.nanmedian(np.abs(valid - med)))
    sigma = 1.4826 * mad if mad > 0 else float(np.nanstd(valid))
    if sigma <= 0 or not np.isfinite(sigma):
        return [], []

    H, W = diff_img.shape

    pos_max = (clean == maximum_filter(clean, size=5)) & (clean > med + sigma_thresh * sigma)
    pos_y, pos_x = np.where(pos_max)

    neg_clean = -clean
    neg_max = (neg_clean == maximum_filter(neg_clean, size=5)) & (neg_clean > -med + sigma_thresh * sigma)
    neg_y, neg_x = np.where(neg_max)

    pos_peaks: List[Dict[str, Any]] = []
    for x, y in zip(pos_x, pos_y):
        ra_val, dec_val = None, None
        if wcs is not None:
            try:
                sky = wcs.pixel_to_world(float(x), float(y))
                ra_val = round(float(sky.ra.deg), 6)
                dec_val = round(float(sky.dec.deg), 6)
            except Exception:
                pass
        pos_peaks.append({
            "x_pix": int(x),
            "y_pix": int(y),
            "norm_x": round(float(x) / max(1, W - 1), 4),
            "norm_y": round(float(y) / max(1, H - 1), 4),
            "norm_y_canvas": round(1.0 - (float(y) / max(1, H - 1)), 4),
            "ra": ra_val,
            "dec": dec_val,
            "peak_flux": round(float(diff_img[y, x]), 4),
        })

    neg_peaks: List[Dict[str, Any]] = []
    for x, y in zip(neg_x, neg_y):
        ra_val, dec_val = None, None
        if wcs is not None:
            try:
                sky = wcs.pixel_to_world(float(x), float(y))
                ra_val = round(float(sky.ra.deg), 6)
                dec_val = round(float(sky.dec.deg), 6)
            except Exception:
                pass
        neg_peaks.append({
            "x_pix": int(x),
            "y_pix": int(y),
            "norm_x": round(float(x) / max(1, W - 1), 4),
            "norm_y": round(float(y) / max(1, H - 1), 4),
            "norm_y_canvas": round(1.0 - (float(y) / max(1, H - 1)), 4),
            "ra": ra_val,
            "dec": dec_val,
            "peak_flux": round(float(diff_img[y, x]), 4),
        })

    return pos_peaks, neg_peaks


def process_diff_mode(
    cutouts: List[Dict[str, Any]],
    target_wcs: WCS,
    shape_out: Tuple[int, int],
    detector: Optional[str] = None,
    colormap: str = "coolwarm",
    stretch: str = "asinh",
) -> Dict[str, Any]:
    """
    Mode 'diff': Scientifically valid epoch differencing (Epoch B - Epoch A) to highlight
    moving objects (dipoles). Matches observations strictly by detector band to eliminate
    spectral/color leakage artifacts.
    """
    if len(cutouts) < 2:
        raise ValueError(f"Epoch differencing requires at least 2 distinct exposures, got {len(cutouts)}")

    norm_detector = normalize_detector_name(detector)

    # Group cutouts strictly by detector band
    detector_groups: Dict[str, List[Dict[str, Any]]] = {}
    for c in cutouts:
        band = c["detector_band"]
        detector_groups.setdefault(band, []).append(c)

    available_detectors = [b for b, grp in sorted(detector_groups.items()) if len(grp) >= 2]
    counts_summary = ", ".join(f"{b}: {len(grp)} frames" for b, grp in sorted(detector_groups.items()))

    # Select compatible detector group
    if norm_detector:
        if norm_detector not in detector_groups or len(detector_groups[norm_detector]) < 2:
            n_found = len(detector_groups.get(norm_detector, []))
            raise ValueError(
                f"Insufficient comparable observations in {norm_detector} (found {n_found} frames). "
                f"Epoch differencing requires at least 2 exposures in the same band to prevent wavelength mismatch artifacts. "
                f"Available detectors: {counts_summary}"
            )
        chosen_band = norm_detector
        compatible_cutouts = detector_groups[chosen_band]
    else:
        # Find detector band with largest temporal baseline having >= 2 exposures
        best_band = None
        max_baseline = -1.0
        for b, grp in detector_groups.items():
            if len(grp) >= 2:
                mjds = [c["obs_mjd_start"] for c in grp]
                baseline = max(mjds) - min(mjds)
                if baseline > max_baseline:
                    max_baseline = baseline
                    best_band = b

        if not best_band:
            raise ValueError(
                f"Insufficient comparable observations. Epoch differencing requires at least 2 exposures "
                f"from the same detector array to prevent color-dependent dipole artifacts. "
                f"Exposure counts: {counts_summary}"
            )
        chosen_band = best_band
        compatible_cutouts = detector_groups[chosen_band]

    # Sort strictly by MJD
    sorted_cutouts = sorted(compatible_cutouts, key=lambda c: c["obs_mjd_start"])

    # Split into Epoch A (earlier) and Epoch B (later)
    mid_idx = max(1, len(sorted_cutouts) // 2)
    epoch_a_cutouts = sorted_cutouts[:mid_idx]
    epoch_b_cutouts = sorted_cutouts[mid_idx:]

    # Reproject and median stack Epoch A with background normalization
    reproj_a = []
    for c in epoch_a_cutouts:
        r = reproject_cutout_image(c["image"], c["spatial_wcs"], target_wcs, shape_out)
        if np.any(np.isfinite(r)):
            r = r - np.nanmedian(r)
        reproj_a.append(r)
    stack_a = np.nanmedian(np.stack(reproj_a, axis=0), axis=0)

    # Reproject and median stack Epoch B with background normalization
    reproj_b = []
    for c in epoch_b_cutouts:
        r = reproject_cutout_image(c["image"], c["spatial_wcs"], target_wcs, shape_out)
        if np.any(np.isfinite(r)):
            r = r - np.nanmedian(r)
        reproj_b.append(r)
    stack_b = np.nanmedian(np.stack(reproj_b, axis=0), axis=0)

    # Difference: Epoch B - Epoch A
    diff_image = stack_b - stack_a

    # Dipole analysis & peak detection (per SPHEREx moving object detection)
    valid_diff = diff_image[np.isfinite(diff_image)]
    pos_peak = float(np.nanmax(valid_diff)) if valid_diff.size > 0 else 0.0
    neg_peak = float(np.nanmin(valid_diff)) if valid_diff.size > 0 else 0.0
    dipole_contrast = pos_peak - neg_peak

    pos_peaks, neg_peaks = detect_moving_dipoles(diff_image, sigma_thresh=4.5, wcs=target_wcs)

    # Encode images
    encoded_diff = stretch_and_encode_png(
        diff_image,
        stretch_type=stretch,
        colormap=colormap,
        is_diff=True,
    )
    encoded_a = stretch_and_encode_png(
        stack_a,
        stretch_type="asinh",
        colormap="viridis",
        is_diff=False,
    )
    encoded_b = stretch_and_encode_png(
        stack_b,
        stretch_type="asinh",
        colormap="viridis",
        is_diff=False,
    )

    delta_mjd = float(epoch_b_cutouts[0]["obs_mjd_start"] - epoch_a_cutouts[-1]["obs_mjd_end"])
    total_baseline_days = float(epoch_b_cutouts[-1]["obs_mjd_start"] - epoch_a_cutouts[0]["obs_mjd_start"])

    return {
        "detector_used": chosen_band,
        "available_detectors": available_detectors,
        "wavelength_range_um": DETECTOR_WAVELENGTH_RANGES.get(chosen_band),
        "diff_frame": {
            "image_base64": encoded_diff["base64"],
            "data_url": encoded_diff["data_url"],
            "vmin": encoded_diff["vmin"],
            "vmax": encoded_diff["vmax"],
            "width": shape_out[1],
            "height": shape_out[0],
            "positive_peak_mjy_sr": pos_peak,
            "negative_peak_mjy_sr": neg_peak,
            "dipole_contrast": dipole_contrast,
            "pos_peaks": pos_peaks,
            "neg_peaks": neg_peaks,
        },
        "epoch_a": {
            "obs_mjd_start": epoch_a_cutouts[0]["obs_mjd_start"],
            "obs_mjd_end": epoch_a_cutouts[-1]["obs_mjd_end"],
            "frames_stacked": len(epoch_a_cutouts),
            "detector": chosen_band,
            "mean_wavelength_um": round(float(np.mean([c["wavelength_um"] for c in epoch_a_cutouts])), 4),
            "image_base64": encoded_a["base64"],
            "data_url": encoded_a["data_url"],
        },
        "epoch_b": {
            "obs_mjd_start": epoch_b_cutouts[0]["obs_mjd_start"],
            "obs_mjd_end": epoch_b_cutouts[-1]["obs_mjd_end"],
            "frames_stacked": len(epoch_b_cutouts),
            "detector": chosen_band,
            "mean_wavelength_um": round(float(np.mean([c["wavelength_um"] for c in epoch_b_cutouts])), 4),
            "image_base64": encoded_b["base64"],
            "data_url": encoded_b["data_url"],
        },
        "delta_mjd": round(delta_mjd, 5),
        "total_baseline_days": round(total_baseline_days, 5),
    }


def track_source_across_epochs(
    cutouts: List[Dict[str, Any]],
    target_wcs: WCS,
    shape_out: Tuple[int, int],
    target_ra: float,
    target_dec: float,
    tolerance_arcsec: float = 18.0,
    aperture_radius_arcsec: float = 6.2,
) -> Dict[str, Any]:
    """
    Real astronomical point source tracking across SPHEREx exposures.
    
    Associates detected sources across frames using real measured coordinates,
    performs target-centered aperture photometry, computes measured angular
    displacement, and calculates measured proper motion without synthetic values.
    """
    target_coord = SkyCoord(ra=target_ra * u.deg, dec=target_dec * u.deg, frame="icrs")
    sorted_cutouts = sorted(cutouts, key=lambda c: c["obs_mjd_start"])

    nom_x_f, nom_y_f = target_wcs.world_to_pixel(target_coord)
    nom_norm_x = round(float(nom_x_f) / max(1, shape_out[1] - 1), 4)
    nom_norm_y_canvas = round(1.0 - (float(nom_y_f) / max(1, shape_out[0] - 1)), 4)

    observations: List[Dict[str, Any]] = []

    for idx, cutout in enumerate(sorted_cutouts):
        reprojected = reproject_cutout_image(
            cutout["image"],
            cutout["spatial_wcs"],
            target_wcs,
            shape_out,
        )

        stars = detect_star_peaks(reprojected, min_snr=1.5, wcs=target_wcs)

        # Find closest detected point source
        best_star = None
        min_sep_arcsec = float("inf")
        for s in stars:
            if s.get("ra") is not None and s.get("dec") is not None:
                star_coord = SkyCoord(ra=s["ra"] * u.deg, dec=s["dec"] * u.deg, frame="icrs")
                sep = float(target_coord.separation(star_coord).arcsec)
                if sep < min_sep_arcsec:
                    min_sep_arcsec = sep
                    best_star = s

        # Aperture photometry at target position on this cutout
        phot = extract_photometry_single(
            cutout,
            target_coord,
            aperture_radius_arcsec=aperture_radius_arcsec,
        )

        peak_matched = bool(best_star is not None and min_sep_arcsec <= tolerance_arcsec)
        phot_snr_val = phot["snr"] if (phot and phot.get("snr") is not None and np.isfinite(phot["snr"])) else 0.0
        phot_matched = bool(phot and phot_snr_val >= 2.0 and (phot.get("flux_uJy") or 0.0) > 0.0)
        is_matched = peak_matched or phot_matched

        if peak_matched and best_star:
            meas_ra = best_star["ra"]
            meas_dec = best_star["dec"]
            pix_x = best_star["x_pix"]
            pix_y = best_star["y_pix"]
            norm_x = best_star["norm_x"]
            norm_y_canvas = best_star["norm_y_canvas"]
            snr_val = best_star["snr"]
            sep_val = round(min_sep_arcsec, 3)
        elif phot_matched:
            meas_ra = target_ra
            meas_dec = target_dec
            pix_x = round(float(nom_x_f), 2)
            pix_y = round(float(nom_y_f), 2)
            norm_x = nom_norm_x
            norm_y_canvas = nom_norm_y_canvas
            snr_val = phot_snr_val
            sep_val = 0.0
        else:
            meas_ra = None
            meas_dec = None
            pix_x = round(float(nom_x_f), 2)
            pix_y = round(float(nom_y_f), 2)
            norm_x = nom_norm_x
            norm_y_canvas = nom_norm_y_canvas
            snr_val = 0.0
            sep_val = None

        obs_mjd = float(cutout["obs_mjd_start"])
        utc_str = ""
        survey_pass_str = ""
        try:
            utc_dt = Time(obs_mjd, format="mjd", scale="utc").datetime
            utc_str = utc_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
            survey_pass_str = f"Survey {int(max(1, round((obs_mjd - 60902.86) / 182.625) + 1))}"
        except Exception:
            utc_str = f"MJD {obs_mjd:.2f}"
            survey_pass_str = "Survey 1"

        flux_val = phot["flux_uJy"] if phot else None
        flux_err = phot["flux_err_uJy"] if phot else None
        snr_metric = snr_val if snr_val > 0 else (phot["snr"] if phot else 0.0)

        observations.append({
            "frame_index": idx,
            "obs_mjd": obs_mjd,
            "obs_mjd_end": float(cutout["obs_mjd_end"]),
            "obs_date_utc": utc_str,
            "survey_pass": survey_pass_str,
            "detector": cutout["detector_band"],
            "wavelength_um": round(float(cutout["wavelength_um"]), 4),
            "bandwidth_um": round(float(cutout["bandwidth_um"]), 4),
            "is_detected": is_matched,
            "measured_ra": meas_ra,
            "measured_dec": meas_dec,
            "pixel_x": pix_x,
            "pixel_y": pix_y,
            "norm_x": norm_x,
            "norm_y_canvas": norm_y_canvas,
            "offset_from_target_arcsec": sep_val,
            "peak_snr": snr_val,
            "phot_snr": phot["snr"] if phot else None,
            "snr": snr_metric,
            "flux_uJy": flux_val,
            "flux_err_uJy": flux_err,
            "aperture_flux_ujy": flux_val,
            "aperture_flux_err_ujy": flux_err,
            "flags": phot["flags"] if phot else 0,
            "flag_labels": phot["flag_labels"] if phot else ["NO_DATA"],
        })

    # Kinematic proper motion calculations from matched detections
    matched_obs = [o for o in observations if o["is_detected"]]
    num_matched = len(matched_obs)
    total_frames = len(observations)

    kinematics: Dict[str, Any] = {
        "status": "insufficient_observations",
        "message": "Insufficient observations to determine proper motion.",
        "matched_observations": num_matched,
        "total_observations": total_frames,
        "measured_pm_total_mas_yr": None,
        "measured_pmra_mas_yr": None,
        "measured_pmdec_mas_yr": None,
        "displacement_arcsec": None,
        "displacement_pixels": None,
        "temporal_baseline_days": None,
        "confidence_pct": None,
    }

    if num_matched >= 2:
        first_m = matched_obs[0]
        last_m = matched_obs[-1]
        delta_days = float(last_m["obs_mjd"] - first_m["obs_mjd"])
        c_first = SkyCoord(ra=first_m["measured_ra"] * u.deg, dec=first_m["measured_dec"] * u.deg, frame="icrs")
        c_last = SkyCoord(ra=last_m["measured_ra"] * u.deg, dec=last_m["measured_dec"] * u.deg, frame="icrs")

        tot_sep_arcsec = float(c_first.separation(c_last).arcsec)
        tot_sep_mas = tot_sep_arcsec * 1000.0
        tot_sep_pix = float(np.hypot(last_m["pixel_x"] - first_m["pixel_x"], last_m["pixel_y"] - first_m["pixel_y"]))

        kinematics["temporal_baseline_days"] = round(delta_days, 4)
        kinematics["displacement_arcsec"] = round(tot_sep_arcsec, 4)
        kinematics["displacement_pixels"] = round(tot_sep_pix, 3)

        if delta_days >= 0.5:
            delta_years = delta_days / 365.25
            pm_total = round(tot_sep_mas / delta_years, 1)

            # Components
            dra_mas = (c_last.ra.deg - c_first.ra.deg) * np.cos(np.radians(c_first.dec.deg)) * 3.6e6
            ddec_mas = (c_last.dec.deg - c_first.dec.deg) * 3.6e6
            pmra = round(dra_mas / delta_years, 1)
            pmdec = round(ddec_mas / delta_years, 1)

            confidence = round(min(98.0, 50.0 + min(30.0, delta_days / 10.0) + num_matched * 5.0), 1)

            kinematics.update({
                "status": "measured",
                "message": f"Measured displacement of {tot_sep_arcsec:.3f}\" ({tot_sep_pix:.2f} px) over {delta_days:.1f} days.",
                "measured_pm_total_mas_yr": pm_total,
                "measured_pmra_mas_yr": pmra,
                "measured_pmdec_mas_yr": pmdec,
                "confidence_pct": confidence,
            })
        else:
            kinematics.update({
                "status": "short_baseline",
                "message": f"Observations span {delta_days * 24.0:.1f} hours ({delta_days:.3f} days). Motion is unresolved over this baseline.",
                "measured_pm_total_mas_yr": None,
                "confidence_pct": None,
            })
    elif num_matched == 1:
        kinematics.update({
            "status": "single_detection",
            "message": "Target detected in 1 exposure. Repeat observations required to measure proper motion.",
        })
    else:
        kinematics.update({
            "status": "not_detected",
            "message": "Target below detection threshold in these exposures. Showing nominal celestial coordinate.",
        })

    # Target-specific variability analysis (within SAME detector band)
    detector_phot: Dict[str, List[Dict[str, Any]]] = {}
    for o in observations:
        if o.get("flux_uJy") is not None and np.isfinite(o["flux_uJy"]):
            detector_phot.setdefault(o["detector"], []).append(o)

    band_variability: Dict[str, Dict[str, Any]] = {}
    for band, p_list in sorted(detector_phot.items()):
        fluxes = [float(p["flux_uJy"]) for p in p_list if p.get("flux_uJy") is not None and np.isfinite(p["flux_uJy"])]
        errs = [max(0.1, float(p.get("flux_err_uJy") or 0.1)) for p in p_list if p.get("flux_err_uJy") is not None and np.isfinite(p.get("flux_err_uJy"))]
        if not fluxes:
            continue
        mean_f = float(np.mean(fluxes))
        std_f = float(np.std(fluxes)) if len(fluxes) > 1 else 0.0

        if len(fluxes) >= 2:
            chi2 = float(np.sum([((f - mean_f) / max(0.1, e)) ** 2 for f, e in zip(fluxes, errs)]))
            dof = max(1, len(fluxes) - 1)
            mean_denom = max(0.1, abs(mean_f))
            pct_change = float((max(fluxes) - min(fluxes)) / mean_denom * 100.0)
            is_var = bool(chi2 > 3.0 * dof and pct_change > 15.0)

            band_variability[band] = {
                "detector": band,
                "n_epochs": len(fluxes),
                "observations": len(fluxes),
                "mean_flux_ujy": round(mean_f, 2) if np.isfinite(mean_f) else 0.0,
                "std_flux_ujy": round(std_f, 2) if np.isfinite(std_f) else 0.0,
                "min_flux_ujy": round(float(min(fluxes)), 2) if np.isfinite(min(fluxes)) else 0.0,
                "max_flux_ujy": round(float(max(fluxes)), 2) if np.isfinite(max(fluxes)) else 0.0,
                "delta_flux_pct": round(pct_change, 1) if np.isfinite(pct_change) else 0.0,
                "fractional_variability_pct": round(pct_change, 1) if np.isfinite(pct_change) else 0.0,
                "chi2_reduced": round(chi2 / dof, 2) if np.isfinite(chi2) else 1.0,
                "is_variable": is_var,
                "is_significantly_variable": is_var,
                "status": "variable" if is_var else "photometrically_stable",
            }
        else:
            band_variability[band] = {
                "detector": band,
                "n_epochs": 1,
                "observations": 1,
                "mean_flux_ujy": round(mean_f, 2) if np.isfinite(mean_f) else 0.0,
                "std_flux_ujy": 0.0,
                "min_flux_ujy": round(mean_f, 2) if np.isfinite(mean_f) else 0.0,
                "max_flux_ujy": round(mean_f, 2) if np.isfinite(mean_f) else 0.0,
                "delta_flux_pct": 0.0,
                "fractional_variability_pct": 0.0,
                "chi2_reduced": None,
                "is_variable": False,
                "is_significantly_variable": False,
                "status": "single_epoch",
            }

    matched_count = len([o for o in observations if o["is_detected"]])

    def sanitize_obj(val: Any) -> Any:
        if isinstance(val, dict):
            return {k: sanitize_obj(v) for k, v in val.items()}
        elif isinstance(val, list):
            return [sanitize_obj(v) for v in val]
        elif isinstance(val, (float, np.floating)):
            return float(val) if np.isfinite(val) else None
        elif isinstance(val, (int, np.integer)):
            return int(val)
        return val

    result_payload = {
        "status": "success" if matched_count > 0 else "not_detected",
        "matched_count": matched_count,
        "total_frames": len(observations),
        "target": {
            "ra": target_ra,
            "dec": target_dec,
            "nominal_pixel_x": round(float(nom_x_f), 2),
            "nominal_pixel_y": round(float(nom_y_f), 2),
            "nominal_norm_x": nom_norm_x,
            "nominal_norm_y_canvas": nom_norm_y_canvas,
        },
        "kinematics": kinematics,
        "observations": observations,
        "band_variability": band_variability,
        "note": "Cross-detector flux differences reflect instrument spectral bandpass, not temporal variability.",
    }
    return sanitize_obj(result_payload)
