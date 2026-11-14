# -*- coding: utf-8 -*-
"""
SPHEREx Multi-Epoch Cutout Downloader, Reprojection, Difference & Moving Object Detector
(With 503 Retry Logic & Auto-Fallback Exposures for Google Colab)
"""

import io
import time
import random
import concurrent.futures
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import numpy as np
import matplotlib.pyplot as plt
from scipy.ndimage import maximum_filter

from astropy.io import fits
from astropy.wcs import WCS
from astropy.time import Time
from astropy.visualization import AsinhStretch, ImageNormalize
from astroquery.ipac.irsa import Irsa
from reproject import reproject_interp


# ---------------------------------------------------------
# 1. Configuration & Target Setup
# ---------------------------------------------------------
TARGET_NAME = "Barnard's Star"
RA_DEG = 269.452075
DEC_DEG = 4.693391
FOV_DEG = 0.05
GRID_SIZE = 160
DETECTOR_BAND = "SPHEREx-D2"

TARGET_EPOCHS = [
    ("2025-06", "2025-05-01", "2025-07-31"),
    ("2026-06", "2026-05-01", "2026-07-31"),
    ("2026-12", "2026-11-01", "2027-01-31"),
]


# ---------------------------------------------------------
# 2. Resilient HTTP Session (Handles 503 / 429 / Timeouts)
# ---------------------------------------------------------
def create_resilient_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (SPHEREx-Sky-Explorer-Research/1.0)"
    })
    retry_strategy = Retry(
        total=5,
        backoff_factor=2.0,  # 2s, 4s, 8s, 16s, 32s စောင့်ပြီး ပြန်ဆွဲမည်
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=4, pool_maxsize=4)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# ---------------------------------------------------------
# 3. Query Caltech/IPAC IRSA TAP Endpoint
# ---------------------------------------------------------
def query_spherex_tap(ra_deg: float, dec_deg: float, size_deg: float = 0.05, detector: str = None):
    band_filter = f"AND p.energy_bandpassname = '{detector}'" if detector else ""
    adql = f"""
    SELECT
        'https://irsa.ipac.caltech.edu/' || a.uri || '?center={ra_deg},{dec_deg}d&size={size_deg}' AS cutout_url,
        p.time_bounds_lower AS obs_mjd,
        p.energy_bandpassname AS detector_band
    FROM spherex.artifact a
    JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra_deg}, {dec_deg}), p.poly)
    {band_filter}
    ORDER BY p.time_bounds_lower ASC
    """
    print(f"[1/4] Querying IRSA TAP for {TARGET_NAME} ({ra_deg}, {dec_deg})...")
    table = Irsa.query_tap(adql).to_table()
    print(f"      Found {len(table)} total exposures.")
    return table


def build_epoch_candidates(table, epoch_windows):
    """Return a list of candidate exposures per epoch so if one gets 503, we can try the next nearby exposure."""
    if len(table) == 0:
        return {}

    mjds = np.array(table["obs_mjd"], dtype=float)
    iso_dates = Time(mjds, format="mjd").iso
    candidates_map = {}

    for label, start_str, end_str in epoch_windows:
        mjd_start = Time(start_str).mjd
        mjd_end = Time(end_str).mjd
        idx = np.where((mjds >= mjd_start) & (mjds <= mjd_end))[0]
        if len(idx) > 0:
            # Up to 4 backup candidates within this window
            pick = idx[np.linspace(0, len(idx) - 1, min(4, len(idx)), dtype=int)]
            candidates_map[label] = [
                {
                    "url": str(table["cutout_url"][i]),
                    "mjd": float(mjds[i]),
                    "date": iso_dates[i][:10],
                    "detector": str(table["detector_band"][i]),
                }
                for i in pick
            ]

    # Fallback: split all 62 exposures into 3 chronological buckets (Earliest, Mid, Latest)
    if len(candidates_map) < 2 and len(table) >= 2:
        print("      [Note] Exact 2026-12 window not yet released in archive; selecting earliest, mid, and latest available epochs.")
        buckets = np.array_split(np.arange(len(table)), min(3, len(table)))
        candidates_map = {}
        for b_idx, bucket in enumerate(buckets):
            if len(bucket) == 0:
                continue
            mid_i = bucket[len(bucket) // 2]
            d_str = iso_dates[mid_i][:7]
            key = f"{d_str} (Epoch {b_idx+1})"
            # Take up to 4 candidate exposures from this bucket
            pick = bucket[np.linspace(0, len(bucket) - 1, min(4, len(bucket)), dtype=int)]
            candidates_map[key] = [
                {
                    "url": str(table["cutout_url"][i]),
                    "mjd": float(mjds[i]),
                    "date": iso_dates[i][:10],
                    "detector": str(table["detector_band"][i]),
                }
                for i in pick
            ]

    return candidates_map


# ---------------------------------------------------------
# 4. Download Cutout with Fallback & ZODI Removal
# ---------------------------------------------------------
def download_epoch_with_fallback(session: requests.Session, label: str, candidate_list: list):
    """Try downloading the primary exposure; if IRSA returns 503, automatically fallback to another exposure in that epoch."""
    for idx, meta in enumerate(candidate_list):
        try:
            # Small jitter delay to avoid triggering IRSA 503 burst limits
            time.sleep(random.uniform(0.3, 1.0))
            resp = session.get(meta["url"], timeout=90)
            resp.raise_for_status()

            with fits.open(io.BytesIO(resp.content), memmap=False) as hdul:
                img_hdu = hdul["IMAGE"]
                data = img_hdu.data.astype(np.float32)

                if "ZODI" in hdul:
                    data = data - hdul["ZODI"].data.astype(np.float32)

                if "FLAGS" in hdul:
                    flags = hdul["FLAGS"].data
                    bad_mask = (flags & 3) > 0
                    data[bad_mask] = np.nan

                wcs = WCS(img_hdu.header)
                print(f"      [OK] {label} -> {meta['date']} (Exposure candidate #{idx+1})")
                return {
                    "data": data,
                    "wcs": wcs,
                    "date": meta["date"],
                    "mjd": meta["mjd"],
                    "detector": meta["detector"],
                }
        except Exception as e:
            print(f"      [Retry/Fallback] {label} candidate #{idx+1} failed ({type(e).__name__}), trying next...")

    return None


# ---------------------------------------------------------
# 5. Astropy WCS Alignment, Image Differencing & Peak Detection
# ---------------------------------------------------------
def build_north_up_wcs(ra_deg: float, dec_deg: float, fov_deg: float, grid_size: int) -> WCS:
    w = WCS(naxis=2)
    pixel_scale = fov_deg / grid_size
    w.wcs.crpix = [grid_size / 2.0 + 0.5, grid_size / 2.0 + 0.5]
    w.wcs.cdelt = np.array([-pixel_scale, pixel_scale])
    w.wcs.crval = [ra_deg, dec_deg]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return w


def detect_moving_dipoles(diff_img: np.ndarray, sigma_thresh: float = 4.5):
    clean = np.nan_to_num(diff_img, nan=0.0)
    med = np.nanmedian(diff_img)
    mad = np.nanmedian(np.abs(diff_img - med))
    sigma = 1.4826 * mad if mad > 0 else np.nanstd(diff_img)

    pos_max = (clean == maximum_filter(clean, size=5)) & (clean > med + sigma_thresh * sigma)
    pos_y, pos_x = np.where(pos_max)

    neg_clean = -clean
    neg_max = (neg_clean == maximum_filter(neg_clean, size=5)) & (neg_clean > -med + sigma_thresh * sigma)
    neg_y, neg_x = np.where(neg_max)

    return list(zip(pos_x, pos_y)), list(zip(neg_x, neg_y))


# ---------------------------------------------------------
# 6. Main Execution Pipeline
# ---------------------------------------------------------
def run_spherex_pipeline():
    table = query_spherex_tap(RA_DEG, DEC_DEG, FOV_DEG, DETECTOR_BAND)
    candidates_map = build_epoch_candidates(table, TARGET_EPOCHS)

    if len(candidates_map) < 2:
        print("Error: Not enough epochs found at these coordinates.")
        return

    print(f"[2/4] Downloading {len(candidates_map)} epochs (with 503 auto-retry)...")
    session = create_resilient_session()
    cutouts = {}

    # Use 2 workers instead of 4 so IRSA IBE server doesn't reject with 503
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_map = {
            executor.submit(download_epoch_with_fallback, session, lbl, cands): lbl
            for lbl, cands in candidates_map.items()
        }
        for fut in concurrent.futures.as_completed(future_map):
            lbl = future_map[fut]
            res = fut.result()
            if res is not None:
                cutouts[lbl] = res

    if len(cutouts) < 2:
        print("Error: IRSA IBE server is currently overloaded (503). Please re-run in 30 seconds.")
        return

    # Preserve chronological order
    epoch_labels = sorted(cutouts.keys(), key=lambda k: cutouts[k]["mjd"])

    print("[3/4] Reprojecting images onto common North-Up WCS grid...")
    target_wcs = build_north_up_wcs(RA_DEG, DEC_DEG, FOV_DEG, GRID_SIZE)
    aligned_images = {}

    for lbl in epoch_labels:
        item = cutouts[lbl]
        reproj_data, _ = reproject_interp(
            (item["data"], item["wcs"]),
            target_wcs,
            shape_out=(GRID_SIZE, GRID_SIZE),
            order="bilinear"
        )
        reproj_data = reproj_data - np.nanmedian(reproj_data)
        aligned_images[lbl] = reproj_data.astype(np.float32)

    first_lbl = epoch_labels[0]
    last_lbl = epoch_labels[-1]
    diff_image = aligned_images[last_lbl] - aligned_images[first_lbl]

    print(f"[4/4] Detecting moving object dipoles ({last_lbl} - {first_lbl})...")
    pos_peaks, neg_peaks = detect_moving_dipoles(diff_image, sigma_thresh=4.5)
    print(f"      Detected {len(pos_peaks)} new-position (+) peaks and {len(neg_peaks)} old-position (-) peaks.")

    for idx, (px, py) in enumerate(pos_peaks[:5]):
        sky = target_wcs.pixel_to_world(px, py)
        print(f"      Candidate #{idx+1} [NEW POS]: Pixel=({px}, {py}) -> RA={sky.ra.deg:.6f}°, Dec={sky.dec.deg:.6f}°")

    # ---------------------------------------------------------
    # 7. Visualization
    # ---------------------------------------------------------
    n_epochs = len(epoch_labels)
    fig, axes = plt.subplots(1, n_epochs + 1, figsize=(5 * (n_epochs + 1), 5), facecolor="#0b0f19")

    for i, lbl in enumerate(epoch_labels):
        ax = axes[i]
        img = aligned_images[lbl]
        vmin, vmax = np.nanpercentile(img, [2, 99.5])
        norm = ImageNormalize(vmin=vmin, vmax=vmax, stretch=AsinhStretch(a=0.1))
        ax.imshow(img, origin="lower", cmap="magma", norm=norm)
        ax.set_title(f"{lbl}\nDate: {cutouts[lbl]['date']}", color="white", fontsize=11)
        ax.axis("off")

    ax_diff = axes[-1]
    d_lim = np.nanpercentile(np.abs(diff_image), 99.2)
    ax_diff.imshow(diff_image, origin="lower", cmap="coolwarm", vmin=-d_lim, vmax=d_lim)
    ax_diff.set_title(f"Difference ({last_lbl} - {first_lbl})\nRed=(+) New | Blue=(-) Old", color="#38bdf8", fontsize=11)

    for (px, py) in pos_peaks:
        circ = plt.Circle((px, py), radius=6, edgecolor="#22c55e", facecolor="none", lw=2)
        ax_diff.add_patch(circ)
    for (nx, ny) in neg_peaks:
        circ = plt.Circle((nx, ny), radius=6, edgecolor="#facc15", facecolor="none", lw=1.5, ls="--")
        ax_diff.add_patch(circ)

    ax_diff.axis("off")
    plt.tight_layout()
    plt.savefig("spherex_moving_object_detection.png", dpi=150, bbox_inches="tight")
    plt.show()
    print("Saved output image: spherex_moving_object_detection.png")


if __name__ == "__main__":
    run_spherex_pipeline()