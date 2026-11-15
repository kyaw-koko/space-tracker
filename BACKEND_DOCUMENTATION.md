# SPHEREx Astronomical Backend Engine — Technical Architecture & API Documentation

## 1. System Overview

The **Planet X and SPHEREx Backend Engine** is a high-performance astronomical data processing and analysis service built with **FastAPI**, **Astropy**, **Astroquery**, **Photutils**, and **Reproject**.

It serves as the headless scientific pipeline for the SPHEREx Space Telescope Explorer, handling:
- **Caltech/IPAC IRSA TAP queries** (Astronomical Data Query Language / ADQL) for real-time SPHEREx Level 2 Multi-Extension FITS (MEF) cutouts.
- **Multi-threaded parallel FITS retrieval** with connection pooling, exponential backoff, and transient HTTP fault tolerance.
- **Zodiacal background light (ZODI) subtraction** and Linear Variable Filter (LVF) spectral coordinate resolution via alternate WCS keys.
- **Common-grid WCS Tangential (TAN) reprojection** with bilinear interpolation and footprint masking.
- **Multi-epoch blinking**, **detector array coaddition** (D1–D6), **epoch subtraction** (dipole transient detection for moving objects like brown dwarfs and Planet X), and **sub-pixel celestial source tracking**.
- **On-the-fly 102-band spectrophotometric extraction** with circular aperture photometry, surface-brightness-to-flux conversion, variance error propagation, and quality flag bitmask decoding.
- **Multi-mission catalog cross-matching** against **Gaia DR3** and **AllWISE** with proper motion vector projection.
- **Two-tier caching** (fast in-memory LRU + persistent serialized disk cache).

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    Client["Frontend Clients (Browser / REST API)"]
    
    subgraph FastAPI_App ["FastAPI Application (main.py)"]
        Router["Route Controllers & Input Validators (Pydantic / Query)"]
        CacheMgr["Two-Tier Cache Manager (RAM LRU + Disk Cache)"]
        ErrHandler["CORS & Error Handlers (HTTPException / 422 / 500)"]
    end

    subgraph Scientific_Core ["Astrophysical Processing Core"]
        IRSA["IRSA Client (irsa_client.py)"]
        ImgProc["Image Processor (image_processor.py)"]
        SpecExt["Spectra Extractor (spectra_extractor.py)"]
        CatOverlay["Catalog Overlay (catalog_overlay.py)"]
    end

    subgraph External_Services ["External Astronomical Services"]
        TAP["NASA/IPAC IRSA TAP Service (ADQL)"]
        IBE["IRSA Image Cutout Service (IBE / MEF FITS)"]
        Gaia["ESA Gaia DR3 (IRSA / Vizier Mirror)"]
        AllWISE["NASA AllWISE Infrared Catalog (IRSA)"]
    end

    Client -->|HTTP GET /api/...| Router
    Router --> CacheMgr
    CacheMgr -->|Cache Hit| ImgProc
    CacheMgr -->|Cache Miss| IRSA
    IRSA -->|ADQL Query| TAP
    IRSA -->|Parallel Download| IBE
    IRSA -->|HDU Parsing & ZODI Subtraction| CacheMgr
    
    CacheMgr --> ImgProc
    CacheMgr --> SpecExt
    Router --> CatOverlay
    CatOverlay --> Gaia
    CatOverlay --> AllWISE

    ImgProc -->|Base64 PNG Frames + Astrometry| Router
    SpecExt -->|102-Band SED Array (uJy)| Router
    CatOverlay -->|Projected Sources & Vectors| Router
    Router -->|JSON Response| Client
```

---

## 3. Technology Stack & Key Dependencies

| Dependency | Version Spec | Functional Role in Backend |
|---|---|---|
| `fastapi` | `>=0.110.0` | Asynchronous high-performance REST API routing, request validation, and OpenAPI schema generation |
| `uvicorn[standard]` | `>=0.28.0` | Lightning-fast ASGI web server with auto-reload and UVLoop support |
| `astropy` | `>=6.0.0` | World Coordinate System (WCS) math, FITS file I/O, celestial coordinates (`SkyCoord`), astronomical units |
| `astroquery` | `>=0.4.7` | Programmatic TAP/Cone-search interface to IPAC/IRSA and Vizier databases |
| `pyvo` | `>=1.5.0` | IVOA Virtual Observatory TAP protocol execution and ADQL processing |
| `reproject` | `>=0.13.0` | Astronomical image spatial reprojection onto shared North-Up TAN WCS grids using bilinear interpolation |
| `photutils` | `>=2.0.0` | Circular aperture photometry, background estimation, and source centroiding |
| `numpy` | `>=1.24.0` | Vectorized numerical operations, bitmask manipulation, and image matrix math |
| `scipy` | `>=1.10.0` | Local peak detection, Gaussian filtering, and 2D morphological maximum filters |
| `pillow` (PIL) | `>=10.0.0` | High-speed 8-bit image serialization and Base64 PNG memory encoding |
| `matplotlib` | `>=3.7.0` | Astronomical colormap generation (`viridis`, `plasma`, `magma`, `coolwarm`, `gray`) |
| `requests` | `>=2.31.0` | HTTP transport with custom retry adapters and SSL verification |
| `pydantic` | `>=2.6.0` | Data modeling, boundary constraints, and type coercion |

---

## 4. Module Architecture & Source Code Breakdown

### 4.1 `main.py` — Application Orchestrator & Controllers
- **CORS Configuration**: Permissive CORS middleware registered globally to ensure zero browser blocking on cross-origin requests.
- **Exception Handlers**: Dedicated handlers for `HTTPException`, `RequestValidationError`, and global uncaught errors to ensure valid CORS headers accompany all 4xx/5xx responses.
- **Benchmark Presets**: Hardcoded, scientifically verified coordinates and metadata for 5 challenge targets:
  1. **Barnard's Star** (High proper-motion star: $10.39''/\text{yr}$)
  2. **WISE 0855-0714** (Sub-zero Celsius cold brown dwarf: $T \approx 250\ \text{K}$)
  3. **Epsilon Indi B** (T1+T6 binary brown dwarf pair at $3.6\ \text{pc}$)
  4. **RW Aurigae** (Young eruptive T Tauri variable star with dust disk)
  5. **R Draconis** (Mira-type pulsating AGB giant star)
- **Two-Tier Caching System**:
  - `CUTOUT_CACHE`: In-memory dictionary holding pre-parsed FITS cutout dictionaries (keyed by coordinates, FOV, and detector).
  - `DISK_CACHE_DIR` (`.cache_spherex/`): Serialized pickle files (`cutouts_{key}.pkl` and `cat_{key}.pkl`) enabling instant server cold-starts. Benchmark targets are permanently exempt from TTL expiration.
- **Endpoints**:
  - `GET /` — Root capability and mission band discovery.
  - `GET /api/health` — Service health and cache size monitoring.
  - `GET /api/targets/presets` — Benchmark target catalog.
  - `GET /api/sky-patch` — Multi-mode image processing pipeline.
  - `GET /api/track` — Source tracking and light-curve extractor.
  - `GET /api/spectrum` — 102-band spectrophotometric pipeline.
  - Direct static file and HTML page route bindings with extension whitelisting.

---

### 4.2 `irsa_client.py` — IRSA TAP Interface & Parallel Cutout Engine
- **Detector Normalization**: Normalizes inputs (`D1`, `SPHEREx-D1`, `ALL`) to canonical bandpass identifiers (`SPHEREx-D1` through `SPHEREx-D6`).
- **Coordinate Validation**: Ensures $\text{RA} \in [0, 360]$, $\text{Dec} \in [-90, 90]$, and $\text{FOV} > 0$.
- **ADQL TAP Query Builder**:
  Constructs optimized ADQL queries against `spherex.artifact` and `spherex.plane`:
  ```sql
  SELECT
      'https://irsa.ipac.caltech.edu/' || a.uri || '?center=' || ra || ',' || dec || 'd&size=' || fov AS cutout_url,
      p.time_bounds_lower AS obs_mjd_start,
      p.time_bounds_upper AS obs_mjd_end,
      p.energy_bandpassname AS detector_band,
      p.provenance_version AS version
  FROM spherex.artifact a
  JOIN spherex.plane p ON a.planeid = p.planeid
  WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), p.poly)
  ORDER BY p.time_bounds_lower ASC
  ```
- **Temporal Sampling**: Provides sampling strategies:
  - `baseline` (default): Samples across the mission duration (earliest, median, latest) to optimize dipole motion detection.
  - `latest`: Most recent observations.
  - `earliest`: First light observations.
  - `all`: Full chronological list.
- **Parallel Cutout Retrieval (`fetch_cutouts_parallel`)**:
  - Employs `concurrent.futures.ThreadPoolExecutor(max_workers=2)` (throttled to respect IRSA server rate limits and avoid HTTP 503 errors).
  - Uses a resilient `requests.Session` with `HTTPAdapter` configured for 4 retries, backoff factor of 0.8, and timeout of 120s.
- **FITS Multi-Extension (MEF) Parsing**:
  - HDU 0 (`PRIMARY`): Observation metadata.
  - HDU 1 (`IMAGE`): Surface brightness in $\text{MJy/sr}$.
  - HDU 2 (`FLAGS`): 32-bit pixel data quality mask.
  - HDU 3 (`VARIANCE`): Per-pixel variance $(\text{MJy/sr})^2$.
  - HDU 4 (`ZODI`): Zodiacal light model. Subtracted via:
    $$\text{IMAGE}_{\text{clean}} = \text{IMAGE} - \text{ZODI}$$
  - HDU 6 (`WCS-WAVE`): Spectral lookup table evaluated through alternate WCS key `W` (`WCS(header, fobj=hdul, key='W')`) to extract exact central wavelength ($\mu\text{m}$) and bandwidth ($\mu\text{m}$) at the target celestial position.

---

### 4.3 `image_processor.py` — WCS Reprojection & Image Analysis
- **Reference WCS Grid (`build_reference_wcs`)**:
  Generates a standardized North-Up, East-Left tangential WCS grid centered on the target coordinate:
  - Pixel scale: $6.2''/\text{pixel}$ (SPHEREx native spatial resolution).
  - Canvas dimensions: dynamically clamped between $16 \times 16$ and $512 \times 512$ pixels.
- **Reprojection Engine (`reproject_cutout_image`)**:
  - Re-maps raw spacecraft detector frames (having arbitrary roll angles and optical distortions) onto the common North-Up grid using `reproject.reproject_interp` with bilinear interpolation.
  - Masks footprint edge artifacts ($< 0.5$) with `NaN`.
- **Contrast Stretching & Compression (`stretch_and_encode_png`)**:
  - Computes robust sigma-clipped statistics (`sigma_clipped_stats`, $\sigma=3.0$, 5 iterations).
  - Uses `ZScaleInterval(contrast=0.25)` to identify noise floors and peak dynamic ranges without saturating bright stellar cores.
  - Applies non-linear `AsinhStretch(a=0.1)` (or `LinearStretch`) to reveal faint diffuse structures while retaining star core detail.
  - Maps normalized values $[0, 1]$ through Matplotlib colormaps (`viridis`, `plasma`, `magma`, `coolwarm`, `gray`).
  - Encodes the result directly to 8-bit RGBA PNG and returns a standard `data:image/png;base64,...` URI string.
- **Processing Modes**:
  1. `process_epochs_mode`: Chronologically sorted individual frames for blink video playback.
  2. `process_coadd_mode`: High-SNR median/mean stack across all exposures, and stacks grouped by detector array (D1–D6).
  3. `process_diff_mode`: Pairwise epoch subtraction:
     $$\Delta I = I_{\text{epoch } B} - I_{\text{epoch } A}$$
     Identifies moving solar system objects and high proper-motion stars via characteristic positive/negative dipoles.
  4. `track_source_across_epochs`: Identifies local flux peaks near target coordinates, calculates sub-pixel barycentric centroids, computes proper motion displacement ($\text{mas/yr}$), and extracts single-band light-curves.

---

### 4.4 `spectra_extractor.py` — 102-Band Spectrophotometry
- **Pixel Solid Angle Calculation (`compute_pixel_solid_angle_sr`)**:
  Computes pixel steradians from local WCS Jacobian scales:
  $$\Omega_{\text{pix}} = (\Delta \theta_{\text{deg}} \times \frac{\pi}{180})^2\ \text{steradians}$$
- **Aperture Photometry (`extract_photometry_single`)**:
  - Places a `photutils.aperture.CircularAperture` (default radius $r = 6.2'' = 1\ \text{pixel}$) at the target coordinates.
  - Integrates surface brightness ($\text{MJy/sr}$) and converts to physical flux density ($\mu\text{Jy}$):
    $$F_{\mu\text{Jy}} = I_{\text{aperture}}\ [\text{MJy/sr}] \times \Omega_{\text{pix}}\ [\text{sr}] \times 10^{12}\ \mu\text{Jy/MJy}$$
  - Propagates measurement uncertainty $\sigma$ by integrating the variance map (HDU 3):
    $$\sigma_{\mu\text{Jy}} = \sqrt{\sum \text{VARIANCE}_i} \times \Omega_{\text{pix}} \times 10^{12}$$
  - Decodes pixel flag bitmasks (`FLAGS` HDU 2) to flag cosmic rays, saturation, non-functional pixels, and contamination.
- **Spectral Energy Distribution (SED) Synthesis (`synthesize_102_band_spectrum`)**:
  - Groups photometric points into 102 defined SPHEREx spectral channels ($0.75\ \mu\text{m}$ to $5.00\ \mu\text{m}$).
  - Combines multiple observations within the same spectral channel via inverse-variance weighting:
    $$\bar{F} = \frac{\sum_{i} w_i F_i}{\sum_{i} w_i}, \quad w_i = \frac{1}{\sigma_i^2}, \quad \sigma_{\bar{F}} = \frac{1}{\sqrt{\sum_{i} w_i}}$$

---

### 4.5 `catalog_overlay.py` — Multi-Mission Astrometric Cross-Matching
- **Catalog Sources**:
  - **Gaia DR3**: Queried via IRSA `gaia_dr3_source` (with automatic fallback to Harvard Vizier mirror `I/355/gaiadr3`). Extracts precise RA, Dec, proper motions ($\mu_\alpha^*, \mu_\delta$), parallax, and $G, BP, RP$ magnitudes.
  - **AllWISE**: Queried via IRSA `allwise_p3as_psd`. Extracts infrared photometry ($W1, W2, W3, W4$) and motion metrics.
- **WCS Coordinate Projection (`project_sources_to_wcs`)**:
  - Maps celestial coordinates $(\alpha, \delta)$ to reference image pixel coordinates $(x, y)$ via `ref_wcs.world_to_pixel`.
  - Computes normalized viewport coordinates $(x_{\text{norm}}, y_{\text{norm}}) \in [0, 1]$ for SVG/Canvas frontend overlays.
  - Computes proper motion vector endpoints extrapolated forward in time (default 10 years):
    $$\alpha(t) = \alpha_0 + \frac{\mu_\alpha^*}{\cos \delta} \Delta t, \quad \delta(t) = \delta_0 + \mu_\delta \Delta t$$

---

## 5. REST API Endpoint Reference

### 5.1 `GET /`
Returns service capabilities, health summary, and detector band specifications.

**Response Structure (`200 OK`)**:
```json
{
  "engine": "Planet X and SPHEREx Backend Engine",
  "version": "1.0.0",
  "status": "online",
  "endpoints": {
    "presets": "/api/targets/presets",
    "sky_patch": "/api/sky-patch?ra={deg}&dec={deg}&fov={deg}&mode=epochs|coadd|diff|track",
    "track": "/api/track?ra={deg}&dec={deg}&target_ra={deg}&target_dec={deg}",
    "spectrum": "/api/spectrum?ra={deg}&dec={deg}&fov={deg}",
    "health": "/api/health"
  },
  "mission_bands": [
    {"detector": "SPHEREx-D1", "wavelength_range_um": "0.75 - 1.09", "resolving_power_R": 39},
    {"detector": "SPHEREx-D2", "wavelength_range_um": "1.10 - 1.62", "resolving_power_R": 41},
    {"detector": "SPHEREx-D3", "wavelength_range_um": "1.63 - 2.41", "resolving_power_R": 41},
    {"detector": "SPHEREx-D4", "wavelength_range_um": "2.42 - 3.82", "resolving_power_R": 35},
    {"detector": "SPHEREx-D5", "wavelength_range_um": "3.83 - 4.41", "resolving_power_R": 112},
    {"detector": "SPHEREx-D6", "wavelength_range_um": "4.42 - 5.00", "resolving_power_R": 128}
  ]
}
```

---

### 5.2 `GET /api/health`
Health check and resource monitoring endpoint.

**Response Structure (`200 OK`)**:
```json
{
  "status": "ok",
  "service": "spherex-backend",
  "timestamp": 1740000000.12,
  "cache": {
    "memory_entries": 5,
    "max_memory_entries": 100,
    "disk_files": 12,
    "disk_cache_dir": "/Users/.../.cache_spherex"
  }
}
```

---

### 5.3 `GET /api/targets/presets`
Returns verified benchmark targets for testing proper motion, cold brown dwarfs, binary systems, and variable stars.

**Response Structure (`200 OK`)**:
```json
{
  "count": 5,
  "targets": [
    {
      "id": "barnards-star",
      "name": "Barnard's Star",
      "ra": 269.452075,
      "dec": 4.693391,
      "recommended_fov": 0.05,
      "target_type": "High Proper-Motion Star",
      "description": "Highest known proper-motion star (10.3 arcsec/yr)...",
      "optimal_detector": "SPHEREx-D1",
      "proper_motion": {
        "pmra_mas_yr": -800.2,
        "pmdec_mas_yr": 10362.5,
        "total_pm_mas_yr": 10393.4
      }
    }
  ]
}
```

---

### 5.4 `GET /api/sky-patch`
Core multi-mode image processing pipeline.

**Query Parameters**:
| Parameter | Type | Required | Default | Bounds / Options | Description |
|---|---|---|---|---|---|
| `ra` | `float` | **Yes** | — | `0.0` to `360.0` | Right Ascension in decimal degrees (ICRS) |
| `dec` | `float` | **Yes** | — | `-90.0` to `90.0` | Declination in decimal degrees (ICRS) |
| `fov` | `float` | No | `0.05` | `0.005` to `0.5` | Field of View in degrees |
| `detector`| `string`| No | `None` | `SPHEREx-D1`..`D6` | Filter for specific detector array |
| `mode` | `string`| No | `"epochs"`| `epochs`, `coadd`, `diff`, `track` | Pipeline processing mode |
| `colormap`| `string`| No | `"viridis"`| `viridis`, `plasma`, `magma`, `coolwarm`, `gray` | Output colormap |
| `stretch` | `string`| No | `"asinh"` | `asinh`, `linear` | Contrast stretch algorithm |
| `max_frames`| `int` | No | `10` | `1` to `20` | Max cutouts to process |
| `sampling`| `string`| No | `"baseline"`| `baseline`, `latest`, `earliest`, `all` | Observation sampling pattern |
| `include_catalogs` | `bool` | No | `true` | `true`, `false` | Cross-match Gaia DR3 & AllWISE |

**Response Sample (`mode=epochs`)**:
```json
{
  "status": "success",
  "mode": "epochs",
  "target": {
    "ra": 269.452075,
    "dec": 4.693391,
    "fov": 0.05,
    "detector": "SPHEREx-D1"
  },
  "wcs_grid": {
    "width": 29,
    "height": 29,
    "pixel_scale_arcsec": 6.2,
    "projection": "TAN",
    "orientation": "North-Up East-Left"
  },
  "data": {
    "frames": [
      {
        "index": 0,
        "obs_mjd": 60850.25,
        "obs_date": "2025-08-15T06:00:00",
        "detector": "SPHEREx-D1",
        "wavelength_um": 0.925,
        "bandwidth_um": 0.024,
        "image_base64": "data:image/png;base64,iVBORw0KGgo...",
        "min_val": 1.25,
        "max_val": 450.8,
        "mean_val": 12.3,
        "std_val": 4.2
      }
    ],
    "frame_count": 1
  },
  "catalog_overlay": {
    "gaia_sources": [
      {
        "designation": "Gaia DR3 4472832130527085696",
        "ra": 269.452075,
        "dec": 4.693391,
        "pixel_x": 14.5,
        "pixel_y": 14.5,
        "g_mag": 9.51,
        "pmra": -800.2,
        "pmdec": 10362.5,
        "vector_endpoint": {"pixel_x": 14.2, "pixel_y": 19.8}
      }
    ],
    "allwise_sources": []
  },
  "metrics": {
    "total_cutouts_in_irsa": 8,
    "cutouts_processed": 1,
    "execution_time_seconds": 0.42
  }
}
```

---

### 5.5 `GET /api/track`
Measures displacement, proper motion, and light curves of astronomical objects across observation epochs.

**Query Parameters**:
| Parameter | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `ra` | `float` | **Yes** | — | `0.0` to `360.0` | Field Center RA in degrees |
| `dec` | `float` | **Yes** | — | `-90.0` to `90.0` | Field Center Dec in degrees |
| `target_ra` | `float` | No | `ra` | `0.0` to `360.0` | Target object RA |
| `target_dec`| `float` | No | `dec`| `-90.0` to `90.0` | Target object Dec |
| `tolerance_arcsec` | `float` | No | `18.0` | `1.0` to `120.0` | Search radius for centroid tracking |
| `aperture_radius_arcsec` | `float` | No | `6.2` | `2.0` to `30.0` | Photometric aperture radius |
| `max_frames` | `int` | No | `15` | `2` to `20` | Exposures to sample |

**Response Sample**:
```json
{
  "status": "success",
  "target": {
    "center_ra": 269.452075,
    "center_dec": 4.693391,
    "target_ra": 269.452075,
    "target_dec": 4.693391
  },
  "tracking": {
    "total_detections": 3,
    "time_span_days": 182.5,
    "measured_proper_motion": {
      "pm_ra_cosdec_mas_yr": -805.1,
      "pm_dec_mas_yr": 10355.8,
      "pm_total_mas_yr": 10387.1
    },
    "points": [
      {
        "mjd": 60850.25,
        "detector": "SPHEREx-D1",
        "measured_ra": 269.452075,
        "measured_dec": 4.693391,
        "pixel_x": 14.5,
        "pixel_y": 14.5,
        "flux_uJy": 14250.0,
        "flux_err_uJy": 120.0,
        "snr": 118.7
      }
    ]
  },
  "frames": [...]
}
```

---

### 5.6 `GET /api/spectrum`
Extracts on-the-fly calibrated 102-band spectrophotometric Spectral Energy Distributions (SEDs).

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ra` | `float` | **Yes** | — | Target RA in degrees (ICRS) |
| `dec` | `float` | **Yes** | — | Target Dec in degrees (ICRS) |
| `fov` | `float` | No | `0.05` | Cutout bounding radius in degrees |
| `detector` | `string` | No | `None` | Filter to single detector array |
| `aperture_radius_arcsec` | `float` | No | `6.2` | Photometric aperture radius |
| `max_cutouts` | `int` | No | `18` | Cutout sampling depth |

**Response Sample**:
```json
{
  "status": "success",
  "target": {"ra": 269.452075, "dec": 4.693391, "aperture_radius_arcsec": 6.2},
  "spectrum_102_band": [
    {
      "channel_index": 1,
      "detector": "SPHEREx-D1",
      "wavelength_um": 0.762,
      "bandwidth_um": 0.021,
      "flux_uJy": 8540.2,
      "flux_err_uJy": 115.4,
      "snr": 74.0,
      "flags": ["CLEAN"],
      "n_exposures_combined": 2
    }
  ],
  "summary": {
    "total_channels_detected": 102,
    "peak_flux_uJy": 18450.0,
    "peak_wavelength_um": 1.15
  }
}
```

---

## 6. Mathematical Formulations & Calibration Algorithms

### 6.1 WCS Tangential Reprojection
Celestial sphere coordinates $(\alpha, \delta)$ are projected onto the tangent plane $(x, y)$ centered at reference coordinates $(\alpha_0, \delta_0)$ via the Gnomonic / Tangential (`TAN`) projection:
$$x = \frac{\cos \delta \sin(\alpha - \alpha_0)}{\sin \delta \sin \delta_0 + \cos \delta \cos \delta_0 \cos(\alpha - \alpha_0)}$$
$$y = \frac{\cos \delta_0 \sin \delta - \sin \delta_0 \cos \delta \cos(\alpha - \alpha_0)}{\sin \delta \sin \delta_0 + \cos \delta \cos \delta_0 \cos(\alpha - \alpha_0)}$$
Pixel coordinates on the output array are scaled by $CDELT = (-6.2'' / 3600^\circ, +6.2'' / 3600^\circ)$.

---

### 6.2 ZODI Background Subtraction
SPHEREx Level 2 images contain thermal and scattered light emission from interplanetary dust grains (zodiacal light). This is removed before coaddition, differencing, and photometry:
$$I_{\text{calibrated}}(x, y) = I_{\text{IMAGE}}(x, y) - I_{\text{ZODI}}(x, y)$$

---

### 6.3 Photometric Calibration & Unit Conversion
SPHEREx images are delivered in surface brightness units of MegaJanskys per steradian ($\text{MJy/sr}$). Physical flux density $S_\nu$ in microJanskys ($\mu\text{Jy}$) within an aperture $\mathcal{A}$ is given by:
$$S_\nu = \left(\sum_{(x,y) \in \mathcal{A}} I(x,y)\right) \times \Omega_{\text{pixel}} \times 10^{12}$$
Where:
- $\Omega_{\text{pixel}} = \left(\frac{6.2}{3600} \times \frac{\pi}{180}\right)^2 \approx 7.026 \times 10^{-10}\ \text{steradians}$.
- $1\ \text{MJy} = 10^{12}\ \mu\text{Jy}$.

---

### 6.4 Inverse-Variance Spectral Stacking
For $N$ independent observations within a spectral band, the weighted mean flux $\bar{F}$ and propagated uncertainty $\sigma_{\bar{F}}$ are:
$$w_i = \frac{1}{\sigma_i^2}$$
$$\bar{F} = \frac{\sum_{i=1}^{N} w_i F_i}{\sum_{i=1}^{N} w_i}, \quad \sigma_{\bar{F}} = \left(\sum_{i=1}^{N} w_i\right)^{-\frac{1}{2}}$$

---

### 6.5 Astronomical Focus & Seeing Quality (HFD vs. FWHM)
In the 3×3 comparison module (`comparison.js` / backend calibration models):
- **Full Width at Half Maximum (FWHM)**:
  Diameter across the stellar Point Spread Function where intensity falls to $50\%$ of peak:
  $$\text{FWHM} = 2\sqrt{2\ln 2}\,\sigma \approx 2.3548\,\sigma$$
- **Half Flux Diameter (HFD)**:
  Diameter of a circular boundary enclosing $50\%$ of total integrated star flux:
  $$\text{HFD} \approx 1.32 \times \text{FWHM}$$
  Unlike FWHM, HFD is robust against saturated/flat-topped cores, making it the primary metric for robotic focusers and guide-star quality assurance.

---

## 7. Caching & Performance Architecture

The backend implements a **hierarchical two-tier caching strategy** to deliver sub-100ms response times:

```mermaid
flowchart LR
    Req[Incoming API Request] --> L1{L1: In-Memory LRU}
    L1 -->|Hit (< 5ms)| Resp[Return Payload]
    L1 -->|Miss| L2{L2: Disk Cache .pkl}
    L2 -->|Hit (< 40ms)| MemUp[Load to L1 Cache] --> Resp
    L2 -->|Miss| TAP[IRSA TAP + Parallel Download]
    TAP --> StoreDisk[Save to Disk Cache]
    StoreDisk --> MemUp
```

1. **L1 RAM Cache**: Python dictionary (`CUTOUT_CACHE`) limited to 100 entries with automatic Least-Recently-Used (LRU) eviction.
2. **L2 Persistent Disk Cache**: Serialized binary pickle files (`.cache_spherex/cutouts_{key}.pkl`). Survives service restarts.
3. **Benchmark Exemption**: The 5 official challenge targets are permanently exempt from TTL expiration.
4. **Cache Preheater (`preheat_cache.py`)**: Script that pre-populates all benchmark target data during deployment.

---

## 8. Deployment & Execution Guide

### 8.1 Environment Setup
```bash
# 1. Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt
```

### 8.2 Pre-warming the Cache
```bash
python preheat_cache.py
```

### 8.3 Running the Server
```bash
# Standard local execution (with auto-reload on code change)
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 8.4 Environment Variables
| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Network interface binding |
| `PORT` | `8000` | Port binding |
| `REMOTE_TIMEOUT` | `120` | HTTP timeout (seconds) for IRSA TAP and IBE cutouts |

### 8.5 Automated Test Suite Execution
```bash
python test_backend.py
```
Validates:
- Detector normalization.
- Celestial coordinate boundaries.
- TAP ADQL query construction.
- Bitmask decoding & quality flags.
- WCS reprojection & pixel solid angle computation.
- Epoch differencing & moving dipole detection.
- Full end-to-end FastAPI endpoint integration.
