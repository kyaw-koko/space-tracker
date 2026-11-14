"""
Unit and Integration Test Suite for Planet X and SPHEREx Backend Engine.
Tests all modules, processing modes, algorithms, scientific accuracy, and FastAPI endpoints.
"""

import sys
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from main import app, BENCHMARK_TARGETS
from irsa_client import (
    build_tap_query,
    create_resilient_session,
    get_resilient_session,
    normalize_detector_name,
    validate_coordinates,
    VALID_DETECTORS,
    DETECTOR_WAVELENGTH_RANGES,
)
from image_processor import (
    build_reference_wcs,
    detect_moving_dipoles,
    stretch_and_encode_png,
    process_epochs_mode,
    process_coadd_mode,
    process_diff_mode,
    track_source_across_epochs,
)
from spectra_extractor import (
    decode_flags,
    is_clean_measurement,
    compute_pixel_solid_angle_sr,
    extract_photometry_single,
    synthesize_102_band_spectrum,
    extract_full_spectrum,
    BAD_FLAGS_MASK,
)
from catalog_overlay import project_sources_to_wcs

client = TestClient(app)


def test_detector_normalization():
    print("Testing detector normalization...")
    assert normalize_detector_name("d1") == "SPHEREx-D1"
    assert normalize_detector_name("D6") == "SPHEREx-D6"
    assert normalize_detector_name("SPHEREx-D3") == "SPHEREx-D3"
    assert normalize_detector_name(None) is None
    print("  -> Passed!")


def test_coordinate_validation():
    print("Testing coordinate validation...")
    # Valid coordinates
    ra, dec, fov = validate_coordinates(269.452075, 4.693391, 0.05)
    assert ra == 269.452075 and dec == 4.693391 and fov == 0.05

    # Edge cases
    validate_coordinates(0.0, -90.0, 0.005)
    validate_coordinates(360.0, 90.0, 0.5)

    # Invalid coordinates should raise ValueError
    try:
        validate_coordinates(-1.0, 0.0, 0.05)
        assert False, "Should have raised ValueError for negative RA"
    except ValueError:
        pass

    try:
        validate_coordinates(361.0, 0.0, 0.05)
        assert False, "Should have raised ValueError for RA > 360"
    except ValueError:
        pass

    try:
        validate_coordinates(180.0, -91.0, 0.05)
        assert False, "Should have raised ValueError for Dec < -90"
    except ValueError:
        pass

    try:
        validate_coordinates(180.0, 91.0, 0.05)
        assert False, "Should have raised ValueError for Dec > 90"
    except ValueError:
        pass

    try:
        validate_coordinates(180.0, 0.0, 0.0)
        assert False, "Should have raised ValueError for FOV <= 0"
    except ValueError:
        pass
    print("  -> Passed!")


def test_tap_query_builder():
    print("Testing TAP query builder with ordering and temporal filters...")
    q = build_tap_query(269.452075, 4.693391, fov_deg=0.05, detector="SPHEREx-D1", limit=10, order_by="DESC")
    assert "spherex.artifact" in q
    assert "spherex.plane" in q
    assert "SPHEREx-D1" in q
    assert "269.4520750" in q
    assert "TOP 10" in q
    assert "ORDER BY p.time_bounds_lower DESC" in q

    # Test MJD range filtering
    q_mjd = build_tap_query(269.452, 4.693, fov_deg=0.05, mjd_min=60900.0, mjd_max=61200.0)
    assert "p.time_bounds_lower >= 60900.0000" in q_mjd
    assert "p.time_bounds_upper <= 61200.0000" in q_mjd
    print("  -> Passed!")


def test_reference_wcs():
    print("Testing reference North-Up TAN WCS builder...")
    wcs, shape = build_reference_wcs(269.452075, 4.693391, fov_deg=0.05, pixel_scale_arcsec=6.2)
    assert wcs.wcs.ctype[0] == "RA---TAN"
    assert wcs.wcs.ctype[1] == "DEC--TAN"
    assert wcs.wcs.cdelt[0] < 0  # East is Left
    assert wcs.wcs.cdelt[1] > 0  # North is Up
    assert shape[0] == shape[1]
    assert shape[0] >= 16
    print(f"  -> Reference grid shape: {shape}, passed!")


def test_stretch_and_encode_png():
    print("Testing astronomical contrast stretching & Base64 PNG encoding...")
    img = np.random.normal(loc=1.0, scale=0.2, size=(32, 32)).astype(np.float32)
    img[16, 16] = 20.0  # Star

    res = stretch_and_encode_png(img, stretch_type="asinh", colormap="viridis")
    assert "base64" in res
    assert "data_url" in res
    assert res["data_url"].startswith("data:image/png;base64,")
    assert res["width"] == 32
    assert res["height"] == 32
    assert res["vmax"] > res["vmin"]

    # Test diff mode stretch (symmetrical around zero)
    diff_img = np.random.normal(loc=0.0, scale=0.1, size=(32, 32)).astype(np.float32)
    diff_img[10, 10] = -5.0  # Negative dipole
    diff_img[20, 20] = 5.0   # Positive dipole
    res_diff = stretch_and_encode_png(diff_img, stretch_type="asinh", colormap="coolwarm", is_diff=True)
    assert res_diff["base64"] is not None
    print("  -> Passed!")


def test_image_processor_modes():
    print("Testing image processor modes (epochs, coadd, diff)...")
    ref_wcs, shape_out = build_reference_wcs(269.452, 4.693, fov_deg=0.05)

    # Build mock cutouts with realistic WCS
    cutouts = []
    for i in range(4):
        w = WCS(naxis=2)
        w.wcs.crpix = [15.0, 15.0]
        w.wcs.cdelt = [-6.2 / 3600.0, 6.2 / 3600.0]
        w.wcs.crval = [269.452, 4.693]
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]

        data = np.full((30, 30), 0.1 * (i + 1), dtype=np.float32)
        data[15, 15] = 10.0 + i

        det = f"SPHEREx-D{(i % 2) + 1}"
        cutouts.append({
            "image": data,
            "spatial_wcs": w,
            "obs_mjd_start": 60900.0 + i * 10.0,
            "obs_mjd_end": 60900.0 + i * 10.0 + 0.001,
            "detector_band": det,
            "wavelength_um": 0.85 if det == "SPHEREx-D1" else 1.30,
            "bandwidth_um": 0.02,
        })

    # Test epochs mode
    epochs = process_epochs_mode(cutouts, ref_wcs, shape_out)
    assert len(epochs) == 4
    assert epochs[0]["frame_index"] == 0
    assert epochs[0]["image_base64"] is not None
    assert "obs_date_utc" in epochs[0]
    assert "survey_pass" in epochs[0]

    # Test coadd mode
    coadd = process_coadd_mode(cutouts, ref_wcs, shape_out)
    assert "detector_coadds" in coadd
    assert len(coadd["detector_coadds"]) == 2  # D1 and D2 observed
    assert "detector_coverage" in coadd
    assert len(coadd["detector_coverage"]) == 6  # All 6 reported
    assert len(coadd["missing_detectors"]) == 4  # D3, D4, D5, D6 missing
    assert coadd["overall_coadd"] is not None

    # Test same-detector diff mode
    diff = process_diff_mode(cutouts, ref_wcs, shape_out)
    assert "diff_frame" in diff
    assert "epoch_a" in diff
    assert "epoch_b" in diff
    assert diff["detector_used"] in ("SPHEREx-D1", "SPHEREx-D2")
    assert diff["epoch_a"]["detector"] == diff["epoch_b"]["detector"]  # STRICTLY SAME DETECTOR
    assert diff["delta_mjd"] > 0
    print("  -> Passed!")


def test_same_detector_differencing_rejection():
    print("Testing rejection of cross-detector differencing...")
    ref_wcs, shape_out = build_reference_wcs(269.452, 4.693, fov_deg=0.05)

    # Build 2 cutouts with DIFFERENT detectors (e.g. D1 and D5)
    cutouts = []
    for i, det in enumerate(["SPHEREx-D1", "SPHEREx-D5"]):
        w = WCS(naxis=2)
        w.wcs.crpix = [15.0, 15.0]
        w.wcs.cdelt = [-6.2 / 3600.0, 6.2 / 3600.0]
        w.wcs.crval = [269.452, 4.693]
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]

        cutouts.append({
            "image": np.full((30, 30), 1.0, dtype=np.float32),
            "spatial_wcs": w,
            "obs_mjd_start": 60900.0 + i * 50.0,
            "obs_mjd_end": 60900.0 + i * 50.0 + 0.001,
            "detector_band": det,
            "wavelength_um": 0.90 if det == "SPHEREx-D1" else 4.0,
            "bandwidth_um": 0.02,
        })

    # Must raise ValueError because cross-detector differencing is scientifically invalid!
    try:
        process_diff_mode(cutouts, ref_wcs, shape_out)
        assert False, "Should have rejected cross-detector subtraction!"
    except ValueError as val_err:
        assert "same detector array" in str(val_err)
        print(f"  -> Correctly rejected cross-band subtraction: {val_err}")
    print("  -> Passed!")


def test_source_tracking_across_epochs():
    print("Testing real source tracking & measured proper motion...")
    ref_wcs, shape_out = build_reference_wcs(269.452, 4.693, fov_deg=0.05, pixel_scale_arcsec=6.2)

    # Build mock cutouts across 3 epochs (MJD 60900, 61000, 61100 = 200 days baseline)
    # Target moves +3 pixels in x over 200 days
    cutouts = []
    for i in range(3):
        w = WCS(naxis=2)
        w.wcs.crpix = [15.0, 15.0]
        w.wcs.cdelt = [-6.2 / 3600.0, 6.2 / 3600.0]
        w.wcs.crval = [269.452, 4.693]
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]

        # Synthetic PSF with star shifting in x
        data = np.full((30, 30), 0.05, dtype=np.float32)
        star_x = 15 + i
        star_y = 15
        data[star_y, star_x] = 12.0
        # Add a little spread
        data[star_y - 1, star_x] = 4.0
        data[star_y + 1, star_x] = 4.0
        data[star_y, star_x - 1] = 4.0
        data[star_y, star_x + 1] = 4.0

        var = np.full((30, 30), 0.02, dtype=np.float32)
        flags = np.zeros((30, 30), dtype=np.int32)
        flags[star_y, star_x] = 8  # SOURCE_DETECTED

        cutouts.append({
            "image": data,
            "variance": var,
            "flags": flags,
            "spatial_wcs": w,
            "obs_mjd_start": 60900.0 + i * 100.0,
            "obs_mjd_end": 60900.0 + i * 100.0 + 0.001,
            "detector_band": "SPHEREx-D1",
            "wavelength_um": 0.90,
            "bandwidth_um": 0.02,
        })

    track_res = track_source_across_epochs(
        cutouts,
        ref_wcs,
        shape_out,
        target_ra=269.452,
        target_dec=4.693,
        tolerance_arcsec=25.0,
    )

    assert track_res["status"] == "success"
    assert track_res["matched_count"] == 3
    assert len(track_res["observations"]) == 3
    
    # Verify measured proper motion kinematics
    k = track_res["kinematics"]
    assert k["temporal_baseline_days"] == 200.0
    assert k["displacement_pixels"] > 0
    assert k["measured_pm_total_mas_yr"] > 0
    assert k["confidence_pct"] >= 80

    # Verify target aperture photometry
    assert "band_variability" in track_res
    assert "SPHEREx-D1" in track_res["band_variability"]
    v = track_res["band_variability"]["SPHEREx-D1"]
    assert v["n_epochs"] == 3
    assert v["mean_flux_ujy"] > 0
    print(f"  -> Measured PM: {k['measured_pm_total_mas_yr']} mas/yr over {k['temporal_baseline_days']} days, passed!")


def test_spectra_extractor():
    print("Testing spectra extractor & 102-band SED synthesizer...")
    target = SkyCoord(ra=269.452, dec=4.693, unit="deg")
    ref_wcs, _ = build_reference_wcs(269.452, 4.693, 0.05)

    cutouts = []
    for i in range(6):
        w = WCS(naxis=2)
        w.wcs.crpix = [15.0, 15.0]
        w.wcs.cdelt = [-6.2 / 3600.0, 6.2 / 3600.0]
        w.wcs.crval = [269.452, 4.693]
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]

        data = np.full((30, 30), 0.05, dtype=np.float32)
        data[14, 14] = 5.0
        var = np.full((30, 30), 0.01, dtype=np.float32)
        flags = np.zeros((30, 30), dtype=np.int32)
        flags[14, 14] = 8  # SOURCE_DETECTED

        cutouts.append({
            "image": data,
            "variance": var,
            "flags": flags,
            "spatial_wcs": w,
            "obs_mjd_start": 60900.0 + i,
            "detector_band": f"SPHEREx-D{i + 1}",
            "wavelength_um": 0.8 + i * 0.7,
            "bandwidth_um": 0.02,
        })

    full_spec = extract_full_spectrum(cutouts, target, aperture_radius_arcsec=6.2)
    assert "raw_points" in full_spec
    assert "binned_102_band" in full_spec
    assert len(full_spec["binned_102_band"]) == 102
    assert len(full_spec["raw_points"]) == 6

    # Verify flux conversion & summary metrics
    first_pt = full_spec["raw_points"][0]
    assert first_pt["flux_uJy"] > 0
    assert first_pt["flux_err_uJy"] > 0
    assert first_pt["snr"] > 0
    assert first_pt["is_clean"] is True

    summary = full_spec["summary"]
    assert summary["total_channels"] == 102
    assert summary["covered_channels"] == 6
    assert summary["missing_channels"] == 96
    print(f"  -> Extracted flux: {first_pt['flux_uJy']} uJy, SNR: {first_pt['snr']}, passed!")


def test_quality_flag_filtering():
    print("Testing quality flag filtering (0x00EB bad-pixel mask)...")
    # Clean pixel with source detected
    labels_clean = decode_flags(8)
    assert is_clean_measurement(8) is True
    assert "SOURCE_DETECTED" in labels_clean

    # Saturated pixel (0x0002) with source detected (0x0008) -> total 0x000A
    # Must NOT be classified as clean!
    assert is_clean_measurement(10) is False
    labels_sat = decode_flags(10)
    assert "SATURATED" in labels_sat
    assert "SOURCE_DETECTED" in labels_sat

    # Cosmic ray (0x0004) -> not clean
    assert is_clean_measurement(4) is False

    # Contaminated (0x0020) -> not clean
    assert is_clean_measurement(0x0020) is False

    # Bad calibration (0x0080) -> not clean
    assert is_clean_measurement(0x0080) is False
    print("  -> Passed!")


def test_catalog_projection():
    print("Testing catalog projection & proper motion vectors...")
    ref_wcs, shape_out = build_reference_wcs(269.452075, 4.693391, fov_deg=0.05)
    mock_sources = [
        {
            "catalog": "Gaia DR3",
            "designation": "Barnard Star",
            "ra": 269.452075,
            "dec": 4.693391,
            "pmra_mas_yr": -800.2,
            "pmdec_mas_yr": 10362.5,
            "pm_total_mas_yr": 10393.4,
            "mag_g": 9.51,
        }
    ]
    projected = project_sources_to_wcs(mock_sources, ref_wcs, shape_out)
    assert len(projected) == 1
    p = projected[0]
    assert 0.4 <= p["norm_x"] <= 0.6  # Near center
    assert 0.4 <= p["norm_y"] <= 0.6
    assert abs(p["delta_y_pix"]) > 1.0  # Noticeable proper motion in pixels
    assert p["pm_source"] == "catalog_predicted"
    print(f"  -> Projected: norm_x={p['norm_x']}, norm_y={p['norm_y']}, delta_y_pix={p['delta_y_pix']}, passed!")


def test_api_endpoints():
    print("Testing FastAPI REST endpoints...")

    # GET /
    r_root = client.get("/")
    assert r_root.status_code == 200
    assert r_root.json()["engine"] == "Planet X and SPHEREx Backend Engine"

    # GET /api/health
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "healthy"

    # GET /api/targets/presets
    r_presets = client.get("/api/targets/presets")
    assert r_presets.status_code == 200
    targets = r_presets.json()["targets"]
    assert len(targets) == 5
    ids = [t["id"] for t in targets]
    assert "barnards-star" in ids
    assert "wise-0855" in ids
    assert "eps-indi-b" in ids
    assert "rw-aurigae" in ids
    assert "r-draconis" in ids

    # GET HTML files via direct routes
    for page in ["explore.html", "track.html", "diff.html", "spectrum.html", "catalog.html", "presets.html"]:
        r_page = client.get(f"/{page}")
        assert r_page.status_code == 200
        assert "html" in r_page.headers.get("content-type", "")

    # Test static security: python files and caches must NOT be served!
    r_py = client.get("/main.py")
    assert r_py.status_code in (403, 404)

    r_irsa = client.get("/irsa_client.py")
    assert r_irsa.status_code in (403, 404)

    # Test coordinate validation in API
    r_bad_coord = client.get("/api/sky-patch?ra=999.0&dec=0.0")
    assert r_bad_coord.status_code == 422  # Pydantic validation error

    print(f"  -> Verified {len(targets)} benchmark targets & API security!")


def test_resilient_session_and_503_retry():
    print("Testing resilient HTTP session & 503 retry configuration...")
    session = create_resilient_session()
    adapter = session.adapters.get("https://")
    assert adapter is not None, "HTTPS adapter must be configured"
    retries = adapter.max_retries
    assert retries.total >= 5, "Must configure at least 5 retries"
    assert retries.backoff_factor >= 2.0, "Must configure backoff factor >= 2.0"
    assert 503 in retries.status_forcelist, "503 must be in status_forcelist"
    assert 429 in retries.status_forcelist, "429 must be in status_forcelist"
    assert adapter._pool_connections >= 10, "Connection pool connections must be >= 10"
    assert adapter._pool_maxsize >= 10, "Connection pool maxsize must be >= 10"

    singleton = get_resilient_session()
    assert singleton is not None
    print("  -> Passed!")


def test_cors_and_cutout_limits():
    print("Testing CORS headers & cutout limit clamping (hard ceiling <= 20)...")
    cors_hdr = {"origin": "http://localhost:3000"}

    # Verify CORS headers on normal endpoint
    r_health = client.get("/api/health", headers=cors_hdr)
    assert r_health.headers.get("access-control-allow-origin") == "*"

    # Verify CORS headers on 422 error
    r_val = client.get("/api/sky-patch?ra=999.0&dec=0.0", headers=cors_hdr)
    assert r_val.status_code == 422
    assert r_val.headers.get("access-control-allow-origin") == "*"

    # Verify CORS headers on 404 error
    r_404 = client.get("/non-existent-api-path", headers=cors_hdr)
    assert r_404.status_code == 404
    assert r_404.headers.get("access-control-allow-origin") == "*"

    # Test clamping: request max_frames=50 on cached target (Barnard's Star)
    r_clamp = client.get("/api/sky-patch?ra=269.452075&dec=4.693391&fov=0.05&max_frames=50", headers=cors_hdr)
    assert r_clamp.status_code == 200
    data = r_clamp.json()
    assert len(data.get("data", {}).get("frames", [])) <= 20
    assert data["metrics"]["cutouts_processed"] <= 20
    print("  -> Passed!")


def test_detect_moving_dipoles():
    print("Testing moving dipole peak detector (positive & negative peaks)...")
    wcs, shape = build_reference_wcs(269.452075, 4.693391, fov_deg=0.05)
    diff = np.zeros(shape, dtype=np.float32)
    # Inject a positive peak (new position) at (10, 10)
    diff[10, 10] = 15.0
    # Inject a negative trough (old position) at (20, 20)
    diff[20, 20] = -15.0

    pos_peaks, neg_peaks = detect_moving_dipoles(diff, sigma_thresh=4.0, wcs=wcs)
    assert len(pos_peaks) >= 1, "Must detect positive peak"
    assert len(neg_peaks) >= 1, "Must detect negative trough"
    assert pos_peaks[0]["x_pix"] == 10 and pos_peaks[0]["y_pix"] == 10
    assert neg_peaks[0]["x_pix"] == 20 and neg_peaks[0]["y_pix"] == 20
    assert pos_peaks[0]["ra"] is not None and pos_peaks[0]["dec"] is not None
    print(f"  -> Detected {len(pos_peaks)} (+) peaks and {len(neg_peaks)} (-) troughs, passed!")


def test_explore_page_coordinate_input_box():
    print("Testing explore page coordinate input box & default Barnard's Star...")
    resp = client.get("/explore.html")
    assert resp.status_code == 200
    html = resp.text
    # Verify input element with id coordSearchInput exists
    assert 'id="coordSearchInput"' in html, "Explore page must contain #coordSearchInput"
    assert 'id="btnCoordSearch"' in html, "Explore page must contain #btnCoordSearch"
    # Verify default coordinates for Barnard's Star are present in the HTML value
    assert "269.452075, 4.693391" in html or "269.452" in html, "Default coordinates must correspond to Barnard's Star"
    assert "barnards-star" in html
    print("  -> Verified coordinate input box & default target in explore page, passed!")


def test_benchmark_cache_and_star_field_visibility():
    print("Testing permanent disk cache & star field visibility for 5 benchmark targets...")
    import base64
    import io
    from PIL import Image

    for target in BENCHMARK_TARGETS:
        # Request with max_frames=20 to ensure slicing works even if target has fewer cutouts
        resp = client.get(
            f"/api/sky-patch?ra={target['ra']}&dec={target['dec']}&fov={target['recommended_fov']}&mode=epochs&max_frames=20",
            headers={"origin": "http://localhost:3000"}
        )
        assert resp.status_code == 200, f"Failed for {target['name']}"
        data = resp.json()
        assert data["status"] == "success", f"Status not success for {target['name']}"
        assert "frames" in data["data"]
        frames = data["data"]["frames"]
        assert len(frames) > 0, f"Expected cached frames for {target['name']}"

        # Inspect the first frame's Base64 PNG image to verify star field visibility
        f0 = frames[0]
        raw_b64 = f0["data_url"].split(",")[1] if "," in f0["data_url"] else f0["data_url"]
        img_bytes = base64.b64decode(raw_b64)
        im = Image.open(io.BytesIO(img_bytes))
        arr = np.array(im)

        # 1. Non-empty alpha channel
        assert arr.ndim == 3 and arr.shape[2] == 4, "Must be RGBA image"
        alpha_count = np.count_nonzero(arr[:, :, 3])
        assert alpha_count > 0, f"Alpha channel is completely blank for {target['name']}"

        # 2. Bright star field pixels
        bright_pixels = np.count_nonzero(arr[:, :, :3] > 30)
        assert bright_pixels > 0, f"Star field completely black for {target['name']}"
        print(f"  -> {target['name']}: {len(frames)} frames cached, {alpha_count} visible px, {bright_pixels} bright star px.")

    print("  -> All 5 default benchmark targets loaded instantly from cache with vivid star fields!")


def test_explore_layout_constraints():
    print("Testing explore layout constraints & responsive canvas...")
    with open("explore.css", "r", encoding="utf-8") as f:
        explore_css = f.read()
    with open("common.css", "r", encoding="utf-8") as f:
        common_css = f.read()
    with open("explore.html", "r", encoding="utf-8") as f:
        explore_html = f.read()

    # Layout constraints
    assert "minmax(0, 1fr) 360px" in explore_css or "minmax(0, 1fr) 360px" in common_css
    assert "overflow-x: hidden" in explore_css or "overflow-x: hidden" in common_css
    assert "aspect-ratio: 1 / 1" in explore_css or "aspect-ratio: 1 / 1" in common_css
    assert "max-height: calc(100vh - 110px)" in explore_css or "max-height: calc(100vh - 110px)" in common_css
    assert 'width="800" height="800"' in explore_html, "Canvas must have square 1:1 dimensions"

    print("  -> Layout constraints & responsive 1:1 canvas verified!")


def test_track_endpoint_and_ui():
    print("Testing tracking pipeline & tracker UI...")
    # 1. Test /api/track endpoint for ALL 5 benchmark targets
    for target in BENCHMARK_TARGETS:
        t_ra = target["ra"]
        t_dec = target["dec"]
        t_fov = target.get("recommended_fov", 0.05)
        res = client.get(f"/api/track?ra={t_ra}&dec={t_dec}&target_ra={t_ra}&target_dec={t_dec}&fov={t_fov}&tolerance_arcsec=18.0")
        assert res.status_code == 200, f"/api/track failed for {target['name']} with {res.status_code}: {res.text}"
        data = res.json()
        assert data.get("status") == "success", f"/api/track failed status for {target['name']}"
        tracking = data.get("tracking", {})
        assert "observations" in tracking
        assert "kinematics" in tracking
        obs_list = tracking["observations"]
        assert len(obs_list) > 0, f"Observations list empty for {target['name']}"
        matched = tracking.get("matched_count", 0)
        assert matched > 0, f"Zero matched detections for {target['name']}"
        first_obs = obs_list[0]
        for required_key in ["snr", "aperture_flux_ujy", "obs_date_utc", "survey_pass", "wavelength_um", "detector"]:
            assert required_key in first_obs, f"Missing required observation field: {required_key}"
        print(f"  -> {target['name']}: {matched}/{len(obs_list)} exposures matched, kinematics: {tracking['kinematics']['status']}")

    # 2. Test track.html and track.css responsive layout and canvas scaling
    with open("track.html", "r", encoding="utf-8") as f:
        track_html = f.read()
    with open("track.css", "r", encoding="utf-8") as f:
        track_css = f.read()
    with open("track.js", "r", encoding="utf-8") as f:
        track_js = f.read()

    assert 'width="800" height="800"' in track_html, "trackCanvas must have 1:1 aspect ratio"
    assert "minmax(0, 1fr) 360px" in track_css
    assert "aspect-ratio: 1 / 1" in track_css
    assert "canvasClickX" in track_js, "track.js must scale click coordinates accurately"
    print("  -> Tracker endpoint and UI verified successfully!")


def run_all_tests():
    print("\n=======================================================")
    print("STARTING COMPREHENSIVE TEST SUITE FOR SPHEREx ENGINE")
    print("=======================================================\n")
    test_detector_normalization()
    test_coordinate_validation()
    test_tap_query_builder()
    test_reference_wcs()
    test_stretch_and_encode_png()
    test_image_processor_modes()
    test_same_detector_differencing_rejection()
    test_source_tracking_across_epochs()
    test_spectra_extractor()
    test_quality_flag_filtering()
    test_catalog_projection()
    test_api_endpoints()
    test_resilient_session_and_503_retry()
    test_cors_and_cutout_limits()
    test_detect_moving_dipoles()
    test_explore_page_coordinate_input_box()
    test_benchmark_cache_and_star_field_visibility()
    test_explore_layout_constraints()
    test_track_endpoint_and_ui()
    print("\n=======================================================")
    print("ALL 19 TEST SUITES PASSED WITH 100% SUCCESS")
    print("=======================================================\n")


if __name__ == "__main__":
    run_all_tests()
