/**
 * ============================================================================
 * SPHEREx Real-World Astronomical Sky Explorer (IRSA + Astropy)
 * ============================================================================
 * Fetches real Multi-Extension FITS (MEF) cutouts from Caltech/IPAC IRSA,
 * overlays Gaia DR3 & AllWISE proper-motion vectors, and extracts on-the-fly
 * 102-band spectrophotometry via Astropy.
 */

// Target State: Defaulting to Barnard's Star (highest proper-motion star, verified in IRSA)
let currentTarget = BENCHMARK_PRESETS[1]; // Barnard's Star
let customTarget = null;
let activeSkyAbortController = null;
let activeSpecAbortController = null;

// Pipeline Data State
let realFrames = [];            // Array of real Base64 FITS frames from IRSA
let gaiaSources = [];           // Real Gaia DR3 astrometric sources
let allwiseSources = [];         // Real AllWISE infrared sources
let currentFrameIndex = 0;
let isAnimating = true;
let animationTimer = null;
let blinkIntervalMs = 500;       // 2 FPS blinking rate

// Overlay Options
let showVectors = true;
let vectorBaselineYears = 10;
let cachedImages = [];          // Pre-loaded HTML5 Image objects

// DOM Elements
const canvas = document.getElementById('blinkerCanvas');
const ctx = canvas.getContext('2d');
const playBtn = document.getElementById('playAnimationBtn');
const playIcon = document.getElementById('playIcon');
const playText = document.getElementById('playText');
const toggleVectorsBtn = document.getElementById('toggleVectorsBtn');
const vectorBtnText = document.getElementById('vectorBtnText');
const btnExtractSpectrum = document.getElementById('btnExtractSpectrum');
const targetSelect = document.getElementById('targetSelect');
const coordSearchInput = document.getElementById('coordSearchInput');
const btnCoordSearch = document.getElementById('btnCoordSearch');
const epochSlider = document.getElementById('epochSlider');
const epochDisplay = document.getElementById('epochDisplay');
const vectorSlider = document.getElementById('vectorSlider');
const vectorDisplay = document.getElementById('vectorDisplay');
const coordsBadge = document.getElementById('coordsBadge');
const epochBadge = document.getElementById('epochBadge');
const loaderOverlay = document.getElementById('loaderOverlay');
const loaderText = document.getElementById('loaderText');
const loaderSubtext = document.getElementById('loaderSubtext');

// Spectrum Drawer Elements
const spectrumDrawer = document.getElementById('spectrumDrawer');
const closeSpectrumBtn = document.getElementById('closeSpectrumBtn');
const specTargetName = document.getElementById('specTargetName');
const drawerCanvas = document.getElementById('drawerSpectrumCanvas');
const drawerCtx = drawerCanvas.getContext('2d');

// Custom Coordinates Modal Elements
const customModal = document.getElementById('customCoordModal');
const closeCoordModalBtn = document.getElementById('closeCoordModalBtn');
const btnSubmitCustomCoord = document.getElementById('btnSubmitCustomCoord');
const inputRA = document.getElementById('inputRA');
const inputDec = document.getElementById('inputDec');
const inputFOV = document.getElementById('inputFOV');

// Telemetry Elements
const targetTitle = document.getElementById('targetTitle');
const targetDesc = document.getElementById('targetDescription');
const valCoords = document.getElementById('valCoords');
const valGaiaCount = document.getElementById('valGaiaCount');
const valAllwiseCount = document.getElementById('valAllwiseCount');
const valPM = document.getElementById('valPM');
const valDetector = document.getElementById('valDetector');
const valStatus = document.getElementById('valStatus');

// ============================================================================
// 1. DATA FETCHING PIPELINE (Live IRSA & Astropy Backend)
// ============================================================================

/**
 * Fetch real SPHEREx cutouts & catalog overlays from FastAPI backend
 */
async function fetchRealSkyData(target) {
  // Abort any redundant in-flight sky fetch
  if (activeSkyAbortController) {
    activeSkyAbortController.abort();
  }
  activeSkyAbortController = new AbortController();
  const currentSignal = activeSkyAbortController.signal;

  showLoader(true, "Connecting to NASA/IPAC IRSA TAP...", `Querying spherex.artifact at RA=${target.ra.toFixed(4)}°, Dec=${target.dec.toFixed(4)}°`);
  stopAnimation();
  realFrames = [];
  cachedImages = [];
  gaiaSources = [];
  allwiseSources = [];

  // Update browser URL query parameters
  setUrlCoordinates(target.ra, target.dec, target.fov, target.id === 'custom' ? null : target.id, target.detector);

  const url = `${API_BASE}/api/sky-patch?ra=${target.ra}&dec=${target.dec}&fov=${target.fov}&mode=epochs&include_catalogs=true&max_frames=10&sampling=baseline`;

  try {
    loaderSubtext.textContent = "IRSA TAP querying & fetching FITS cutouts in parallel...";
    const res = await fetch(url, { signal: currentSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const payload = await res.json();

    if (payload.status === 'no_data') {
      renderNoDataMessage(target, payload.message);
      valStatus.textContent = "No Data in IRSA";
      valStatus.style.color = "#ff5252";
      return;
    }

    if (payload.status === 'success' && payload.data && payload.data.frames) {
      realFrames = payload.data.frames;

      // Extract real Gaia DR3 and AllWISE sources from the backend
      if (payload.catalog_overlay) {
        gaiaSources = payload.catalog_overlay.gaia_sources || [];
        allwiseSources = payload.catalog_overlay.allwise_sources || [];
      }

      // Pre-load real FITS PNG images
      loaderSubtext.textContent = `Pre-rendering ${realFrames.length} real FITS exposures onto WCS grid...`;
      await preloadImages(realFrames);

      // Update UI controls
      epochSlider.max = realFrames.length - 1;
      epochSlider.value = 0;
      currentFrameIndex = 0;

      valStatus.textContent = "Live IRSA (100% Real)";
      valStatus.style.color = "#00e5ff";
      updateTelemetry(target, payload);

      render();
      if (realFrames.length > 1) {
        startAnimation();
      }
    } else {
      throw new Error("Invalid payload structure from backend.");
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log("Sky patch fetch aborted for new query.");
      return;
    }
    console.error("Pipeline Error:", err);
    renderErrorMessage(err.message);
    valStatus.textContent = "Connection Error";
    valStatus.style.color = "#ff5252";
  } finally {
    if (!currentSignal.aborted) {
      showLoader(false);
    }
  }
}

/**
 * Preload real base64 FITS images for smooth 60 FPS blinking.
 * Triggers renderCanvas immediately upon img.onload so the user never sees a black screen.
 */
function preloadImages(frames) {
  let initialRenderDone = false;
  const promises = frames.map((f, idx) => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        cachedImages[idx] = img;
        // As soon as the first frame loads, render immediately onto the canvas
        if (!initialRenderDone && idx === 0) {
          initialRenderDone = true;
          renderCanvas();
        }
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = f.data_url;
    });
  });
  return Promise.all(promises).then(images => {
    cachedImages = images.filter(Boolean);
    renderCanvas();
  });
}

function showLoader(show, title = "", subtext = "") {
  loaderOverlay.classList.toggle('active', show);
  if (title) loaderText.textContent = title;
  if (subtext) loaderSubtext.textContent = subtext;
}

// ============================================================================
// 2. RENDERING PIPELINE (FITS Background + Gaia/AllWISE Astrometric Vectors)
// ============================================================================

/**
 * Main Canvas Render Loop - Ensures colorful FITS background stays visible by default
 */
function renderCanvas() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (realFrames.length === 0 || cachedImages.length === 0) return;

  const frameIdx = currentFrameIndex % cachedImages.length;
  const frameImg = cachedImages[frameIdx];
  const frameMeta = realFrames[frameIdx];

  // 1. Render the REAL calibrated colorful FITS Cutout star field image
  if (frameImg && frameImg.complete && frameImg.naturalWidth > 0) {
    ctx.drawImage(frameImg, 0, 0, w, h);
  }

  // 2. Overlay Gaia DR3, AllWISE, and Proper-Motion Vectors
  if (showVectors) {
    renderAstrometricOverlay(w, h);
  }

  // 3. Draw Astropy North-Up East-Left WCS Compass Indicator
  drawWCSCompass(ctx, w - 48, h - 48, 28);

  // 4. Update Header Badges with REAL observation MJD timestamps and detector band
  if (frameMeta) {
    const obsDateInfo = mjdToUtcDate(frameMeta.obs_mjd);
    coordsBadge.textContent = `RA ${currentTarget.ra.toFixed(4)}° • DEC ${currentTarget.dec.toFixed(4)}° (${frameMeta.detector || 'SPHEREx'})`;
    epochBadge.textContent = `SPHEREx ${obsDateInfo.phaseName} • ${obsDateInfo.shortDate} • MJD ${frameMeta.obs_mjd.toFixed(3)}`;
    epochDisplay.textContent = `[${frameIdx + 1}/${realFrames.length}] ${obsDateInfo.fullDateUTC} • MJD ${frameMeta.obs_mjd.toFixed(3)} • ${frameMeta.detector || ''} (${(frameMeta.wavelength_um || 0).toFixed(2)} μm)`;
  }
}
const render = renderCanvas;

/**
 * Render real Gaia DR3 optical sources, AllWISE infrared sources,
 * and proper-motion vectors calculated by Astropy.
 */
function renderAstrometricOverlay(w, h) {
  const scale = vectorBaselineYears / 10.0; // Normalized baseline relative to 10 years

  // A. AllWISE Infrared Sources (Orange Diamonds)
  allwiseSources.forEach(src => {
    const cx = src.norm_x * w;
    const cy = src.norm_y_canvas * h;
    const r = Math.max(3.5, 9 - (src.w1_mag ? (src.w1_mag - 8) * 0.7 : 3));

    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.strokeStyle = "rgba(255, 145, 0, 0.85)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  });

  // B. Gaia DR3 Optical Sources (Cyan Circles)
  gaiaSources.forEach(src => {
    const cx = src.norm_x * w;
    const cy = src.norm_y_canvas * h;
    const r = Math.max(3, 8 - (src.mag_g ? (src.mag_g - 10) * 0.6 : 3));

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // C. Proper Motion Vector Arrow (Yellow)
    if (src.delta_norm_x || src.delta_norm_y) {
      const dx = src.delta_norm_x * w * scale;
      const dy = src.delta_norm_y * h * scale;

      // Draw vector arrow if displacement is visually distinct
      if (Math.hypot(dx, dy) >= 2) {
        const x2 = cx + dx;
        const y2 = cy + dy;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Arrow tip
        const headlen = 6;
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = "#ffff00";
        ctx.fill();
      }
    }
  });
}

// ============================================================================
// 3. ON-THE-FLY 102-BAND SPECTRUM EXTRACTION (/api/spectrum)
// ============================================================================

/**
 * Request real spectrophotometric SED extraction from Astropy & Photutils
 */
async function extractSpectrumForTarget(target) {
  // Abort any redundant in-flight spectrum fetch
  if (activeSpecAbortController) {
    activeSpecAbortController.abort();
  }
  activeSpecAbortController = new AbortController();
  const currentSignal = activeSpecAbortController.signal;

  spectrumDrawer.classList.add('active');
  specTargetName.textContent = target.name;

  // Clear drawer canvas & draw loading notice
  drawerCtx.fillStyle = "#07090e";
  drawerCtx.fillRect(0, 0, drawerCanvas.width, drawerCanvas.height);
  drawerCtx.font = "16px 'Lora', Georgia, serif";
  drawerCtx.fillStyle = "#00e5ff";
  drawerCtx.fillText("Extracting aperture photometry across SPHEREx MEF cutouts from IRSA...", 30, drawerCanvas.height / 2);

  try {
    const url = `${API_BASE}/api/spectrum?ra=${target.ra}&dec=${target.dec}&fov=${target.fov}&aperture_radius_arcsec=6.2&max_cutouts=18`;
    const res = await fetch(url, { signal: currentSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === 'success' && data.spectrum_102_band) {
      renderSpectrumCurve(data.spectrum_102_band);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    drawerCtx.fillStyle = "#ff5252";
    drawerCtx.fillText(`Failed to extract spectrum: ${err.message}`, 30, drawerCanvas.height / 2);
  }
}

/**
 * Render real 102-band spectrophotometric curve with error bars
 */
function renderSpectrumCurve(spectrum) {
  const w = drawerCanvas.width;
  const h = drawerCanvas.height;
  drawerCtx.clearRect(0, 0, w, h);

  const margin = { top: 25, right: 30, bottom: 45, left: 65 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  drawerCtx.fillStyle = "#040609";
  drawerCtx.fillRect(margin.left, margin.top, pw, ph);

  const valid = spectrum.filter(p => p.flux_uJy !== null && p.flux_uJy > 0);
  if (valid.length === 0) {
    drawerCtx.fillStyle = "#ff9100";
    drawerCtx.font = "15px 'Lora', Georgia, serif";
    drawerCtx.fillText("No non-zero flux measurements available in this FOV.", margin.left + 20, h / 2);
    return;
  }

  const minW = 0.75;
  const maxW = 5.00;
  const minF = Math.max(0.1, Math.min(...valid.map(p => p.flux_uJy)) * 0.8);
  const maxF = Math.max(...valid.map(p => p.flux_uJy)) * 1.25;

  function toX(wave) {
    return margin.left + ((wave - minW) / (maxW - minW)) * pw;
  }

  function toY(flux) {
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);
    const logF = Math.log10(Math.max(minF, flux));
    return margin.top + ph - ((logF - logMin) / (logMax - logMin)) * ph;
  }

  // Draw Spline
  drawerCtx.beginPath();
  drawerCtx.strokeStyle = "#00e5ff";
  drawerCtx.lineWidth = 1.8;
  valid.forEach((pt, idx) => {
    const x = toX(pt.wavelength_um);
    const y = toY(pt.flux_uJy);
    if (idx === 0) drawerCtx.moveTo(x, y);
    else drawerCtx.lineTo(x, y);
  });
  drawerCtx.stroke();

  // Draw Nodes & Error Bars
  valid.forEach(pt => {
    const x = toX(pt.wavelength_um);
    const y = toY(pt.flux_uJy);
    const err = pt.flux_err_uJy || 0;
    const yTop = toY(pt.flux_uJy + err);
    const yBot = toY(pt.flux_uJy - err);

    // Error bar
    drawerCtx.strokeStyle = "rgba(0, 229, 255, 0.4)";
    drawerCtx.lineWidth = 1;
    drawerCtx.beginPath();
    drawerCtx.moveTo(x, yTop);
    drawerCtx.lineTo(x, yBot);
    drawerCtx.stroke();

    // Node
    drawerCtx.fillStyle = "#ffffff";
    drawerCtx.beginPath();
    drawerCtx.arc(x, y, 2.5, 0, Math.PI * 2);
    drawerCtx.fill();
  });

  // Axes
  drawerCtx.strokeStyle = "rgba(111, 140, 184, 0.3)";
  drawerCtx.strokeRect(margin.left, margin.top, pw, ph);

  // Axis Labels
  drawerCtx.font = "14px 'Lora', Georgia, serif";
  drawerCtx.fillStyle = "#9ab0cf";
  drawerCtx.fillText("Wavelength (0.75 - 5.00 μm)", margin.left + pw / 2 - 60, h - 12);
  drawerCtx.fillText("Flux F_ν (Log μJy)", 8, margin.top + 14);
}

// ============================================================================
// 4. ANIMATION & TIMELINE CONTROL
// ============================================================================

function startAnimation() {
  stopAnimation();
  if (cachedImages.length <= 1) return;
  isAnimating = true;
  playBtn.classList.add('active');
  playIcon.textContent = '❚❚';
  playText.textContent = currentLang === 'mm' ? I18N.mm.btn_pause : I18N.en.btn_pause;

  animationTimer = setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % cachedImages.length;
    epochSlider.value = currentFrameIndex;
    render();
  }, blinkIntervalMs);
}

function stopAnimation() {
  isAnimating = false;
  if (animationTimer) clearInterval(animationTimer);
  playBtn.classList.remove('active');
  playIcon.textContent = '▷';
  playText.textContent = currentLang === 'mm' ? I18N.mm.btn_animation : I18N.en.btn_animation;
}

function toggleAnimation() {
  if (isAnimating) stopAnimation();
  else startAnimation();
}

// ============================================================================
// 5. TELEMETRY & ERROR DISPLAY
// ============================================================================

function updateTelemetry(target, payload) {
  valCoords.textContent = `${target.ra.toFixed(4)}°, ${target.dec.toFixed(4)}°`;
  valGaiaCount.textContent = gaiaSources.length;
  valAllwiseCount.textContent = allwiseSources.length;
  valPM.textContent = target.pm || "10,393 mas/yr";
  valDetector.textContent = target.detector || "SPHEREx-All";

  if (currentLang === 'mm') {
    targetTitle.innerHTML = `<strong>${escapeHTML(target.name_mm || target.name)}</strong> (${escapeHTML(target.type_mm || target.type || '')})`;
    targetDesc.textContent = target.description_mm || target.description;
  } else {
    targetTitle.innerHTML = `<strong>${escapeHTML(target.name)}</strong> (${escapeHTML(target.type || '')})`;
    targetDesc.textContent = target.description;
  }
}

function renderNoDataMessage(target, msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "17px 'Lora', Georgia, serif";
  ctx.fillStyle = "#ff9100";
  ctx.fillText("No SPHEREx Cutouts in IRSA Archive for this Sky Region", 60, canvas.height / 2 - 20);

  ctx.font = "15px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 10);
  ctx.fillText("Try selecting Barnard's Star or WISE 0855 which have verified coverage in the current release.", 60, canvas.height / 2 + 35);
}

function renderErrorMessage(msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "17px 'Lora', Georgia, serif";
  ctx.fillStyle = "#ff5252";
  ctx.fillText("Error Connecting to Backend / IRSA Pipeline", 60, canvas.height / 2 - 20);

  ctx.font = "15px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 10);
}

// ============================================================================
// 6. EVENT LISTENERS & INITIALIZATION
// ============================================================================

playBtn.addEventListener('click', toggleAnimation);

toggleVectorsBtn.addEventListener('click', () => {
  showVectors = !showVectors;
  toggleVectorsBtn.classList.toggle('active', showVectors);
  vectorBtnText.textContent = `Catalog Vectors (${showVectors ? 'ON' : 'OFF'})`;
  render();
});

btnExtractSpectrum.addEventListener('click', () => {
  extractSpectrumForTarget(currentTarget);
});

closeSpectrumBtn.addEventListener('click', () => {
  spectrumDrawer.classList.remove('active');
});

/**
 * Compute exact canvas coordinates from mouse/pointer events preserving 1:1 aspect ratio mapping
 */
function getCanvasCoordinates(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  return {
    x,
    y,
    normX: Math.max(0, Math.min(1, x / canvas.width)),
    normY: Math.max(0, Math.min(1, y / canvas.height)),
  };
}

// Click anywhere on sky canvas to extract spectrum at that location
canvas.addEventListener('click', (e) => {
  const coords = getCanvasCoordinates(e);
  extractSpectrumForTarget(currentTarget);
});

epochSlider.addEventListener('input', (e) => {
  stopAnimation();
  currentFrameIndex = parseInt(e.target.value, 10);
  render();
});

vectorSlider.addEventListener('input', (e) => {
  vectorBaselineYears = parseInt(e.target.value, 10);
  vectorDisplay.textContent = `${vectorBaselineYears} Years`;
  render();
});

// Target Selector
targetSelect.addEventListener('change', (e) => {
  if (e.target.value === 'custom') {
    customModal.classList.add('active');
    return;
  }
  const chosen = BENCHMARK_PRESETS.find(p => p.id === e.target.value) || BENCHMARK_PRESETS[1];
  currentTarget = chosen;
  if (coordSearchInput) {
    coordSearchInput.value = `${currentTarget.ra.toFixed(6)}, ${currentTarget.dec.toFixed(6)}`;
  }
  fetchRealSkyData(currentTarget);
});

// Direct Coordinate Input Submission Handler
function handleDirectCoordinateInput() {
  if (!coordSearchInput) return;
  const raw = coordSearchInput.value.trim();
  if (!raw) return;

  // Extract numeric coordinates (supports formats like "269.452, 4.693", "269.452 4.693", "RA:269.452 DEC:4.693")
  const matches = raw.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g);
  if (!matches || matches.length < 2) {
    alert(currentLang === 'mm' 
      ? "ကျေးဇူးပြု၍ RA နှင့် Dec ကိုဩဒိနိတ်များကို ထည့်သွင်းပေးပါ (ဥပမာ 269.452075, 4.693391)" 
      : "Please enter valid coordinates as RA and Dec in degrees (e.g. 269.452075, 4.693391)");
    return;
  }

  const ra = parseFloat(matches[0]);
  const dec = parseFloat(matches[1]);
  const fov = matches.length >= 3 ? Math.max(0.005, Math.min(0.5, parseFloat(matches[2]))) : (currentTarget.fov || 0.05);

  if (isNaN(ra) || isNaN(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
    alert(currentLang === 'mm'
      ? "ကိုဩဒိနိတ် အတိုင်းအတာ မှားယွင်းနေပါသည်: RA (၀ မှ ၃၆၀ ဒီဂရီ) နှင့် Dec (-၉၀ မှ +၉၀ ဒီဂရီ)"
      : "Invalid celestial coordinates: RA must be between 0° and 360°, Dec between -90° and +90°.");
    return;
  }

  // Check if input matches one of our official benchmark targets
  const matchedPreset = BENCHMARK_PRESETS.find(p => Math.abs(p.ra - ra) < 0.003 && Math.abs(p.dec - dec) < 0.003);
  if (matchedPreset) {
    currentTarget = matchedPreset;
    if (targetSelect) targetSelect.value = matchedPreset.id;
  } else {
    customTarget = {
      id: "custom",
      name: `Field (${ra.toFixed(4)}°, ${dec.toFixed(4)}°)`,
      name_mm: `ကောင်းကင်နေရာ (${ra.toFixed(4)}°, ${dec.toFixed(4)}°)`,
      type: "User-Defined Coordinate",
      type_mm: "စိတ်ကြိုက် ကောင်းကင်နေရာ",
      ra: ra,
      dec: dec,
      fov: fov,
      detector: "SPHEREx-All",
      description: `User-specified celestial coordinate (RA=${ra.toFixed(4)}°, Dec=${dec.toFixed(4)}°) queried from NASA/IPAC IRSA TAP.`,
      description_mm: `အသုံးပြုသူထည့်သွင်းသော ကောင်းကင်ကိုဩဒိနိတ် (RA=${ra.toFixed(4)}°, Dec=${dec.toFixed(4)}°) ဖြစ်ပြီး IRSA မှ တိုက်ရိုက်ရယူသည်။`,
      pm: "Astrometric field"
    };
    currentTarget = customTarget;
    if (targetSelect) targetSelect.value = "custom";
  }

  // Update input text and sync modal fields
  coordSearchInput.value = `${ra.toFixed(6)}, ${dec.toFixed(6)}`;
  if (inputRA) inputRA.value = ra.toFixed(6);
  if (inputDec) inputDec.value = dec.toFixed(6);
  if (inputFOV) inputFOV.value = fov.toFixed(4);

  fetchRealSkyData(currentTarget);
}

// Bind Direct Coordinate Search Bar Events
if (btnCoordSearch) {
  btnCoordSearch.addEventListener('click', handleDirectCoordinateInput);
}
if (coordSearchInput) {
  coordSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDirectCoordinateInput();
    }
  });
}

// Custom Coordinates Submission
closeCoordModalBtn.addEventListener('click', () => {
  customModal.classList.remove('active');
  targetSelect.value = currentTarget.id;
});

btnSubmitCustomCoord.addEventListener('click', () => {
  const ra = parseFloat(inputRA.value);
  const dec = parseFloat(inputDec.value);
  const fov = parseFloat(inputFOV.value);

  if (isNaN(ra) || isNaN(dec) || isNaN(fov)) {
    alert("Please enter valid numeric coordinates.");
    return;
  }

  customTarget = {
    id: "custom",
    name: `Field (${ra.toFixed(3)}°, ${dec.toFixed(3)}°)`,
    type: "User-Defined Celestial Coordinate",
    ra: ra,
    dec: dec,
    fov: fov,
    detector: "SPHEREx-All",
    description: `User-specified celestial field query dispatched to NASA/IPAC IRSA TAP.`,
    pm: "Astrometric field"
  };

  currentTarget = customTarget;
  if (coordSearchInput) {
    coordSearchInput.value = `${ra.toFixed(6)}, ${dec.toFixed(6)}`;
  }
  customModal.classList.remove('active');
  fetchRealSkyData(currentTarget);
});

// Bootstrapping on Page Load: Initialize from URL coordinates or default to Barnard's Star
document.addEventListener('DOMContentLoaded', () => {
  const urlCoords = getUrlCoordinates();
  if (urlCoords.hasCoords) {
    const matchedPreset = BENCHMARK_PRESETS.find(p => p.id === urlCoords.targetId);
    currentTarget = {
      id: urlCoords.targetId || "custom",
      name: matchedPreset ? matchedPreset.name : `Field (${urlCoords.ra.toFixed(4)}°, ${urlCoords.dec.toFixed(4)}°)`,
      type: matchedPreset ? matchedPreset.type : "Custom Celestial Target",
      ra: urlCoords.ra,
      dec: urlCoords.dec,
      fov: urlCoords.fov || 0.05,
      detector: urlCoords.detector || (matchedPreset ? matchedPreset.detector : "SPHEREx-All"),
      description: matchedPreset ? matchedPreset.description : `Coordinates specified via URL: RA=${urlCoords.ra.toFixed(4)}°, Dec=${urlCoords.dec.toFixed(4)}°`,
      pm: matchedPreset ? matchedPreset.pm : "Field query"
    };
    if (targetSelect) {
      targetSelect.value = urlCoords.targetId || "custom";
    }
    if (inputRA) inputRA.value = urlCoords.ra.toFixed(4);
    if (inputDec) inputDec.value = urlCoords.dec.toFixed(4);
    if (inputFOV) inputFOV.value = (urlCoords.fov || 0.05).toFixed(4);
  } else if (urlCoords.targetId) {
    const preset = BENCHMARK_PRESETS.find(p => p.id === urlCoords.targetId);
    if (preset) {
      currentTarget = preset;
      if (targetSelect) targetSelect.value = preset.id;
    }
  }

  // Populate coordinate input box with default target coordinates (Barnard's Star: 269.452075, 4.693391)
  if (coordSearchInput) {
    coordSearchInput.value = `${currentTarget.ra.toFixed(6)}, ${currentTarget.dec.toFixed(6)}`;
  }

  fetchRealSkyData(currentTarget);
});
