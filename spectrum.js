/**
 * ============================================================================
 * SPHEREx Real-World 102-Band Spectrophotometry SED Viewer (Astropy & Photutils)
 * ============================================================================
 * Fetches real aperture photometry across SPHEREx MEF cutouts from IRSA,
 * converts surface brightness (MJy/sr) to flux density (μJy) via pixel solid angle,
 * extracts photometric uncertainties from HDU 3 (VARIANCE), applies quality flag
 * filtering (0x00EB bad-pixel mask), and visualizes the 102-band SED.
 */

// Default target: WISE 0855 (matches spectrum.html selector)
let currentTarget = BENCHMARK_PRESETS[0]; 
let spectrum102 = [];
let summaryData = null;
let useLogScale = true;
let showMolecules = true;
let filterCleanOnly = false;
let hoveredPoint = null;
let activeSpectrumAbortController = null;

// DOM Elements
const canvas = document.getElementById('spectrumCanvas');
const ctx = canvas.getContext('2d');
const cubeContainer3D = document.getElementById('cubeContainer3D');
const btnToggle3D = document.getElementById('btnToggle3D');
const cubeBtnText = document.getElementById('cubeBtnText');
const btnToggleLog = document.getElementById('btnToggleLog');
const btnToggleMolecules = document.getElementById('btnToggleMolecules');
const btnFilterClean = document.getElementById('btnFilterClean');
const logLabel = document.getElementById('logLabel');
const channelBanner = document.getElementById('channelBanner');
const targetSelect = document.getElementById('targetSelect');
const loaderOverlay = document.getElementById('loaderOverlay');
const loaderText = document.getElementById('loaderText');

// Three.js Hyperspectral Cube State
let is3DMode = false;
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeControls = null;
let cubeGroup = null;
let threeAnimId = null;

// Card Elements
const coordsBadge = document.getElementById('coordsBadge');
const channelBadge = document.getElementById('channelBadge');
const valChannels = document.getElementById('valChannels');
const valPeakFlux = document.getElementById('valPeakFlux');
const valMeanSNR = document.getElementById('valMeanSNR');

// Detector boundaries (0.75 - 5.00 μm)
const DETECTOR_BANDS = [
  { name: "D1", wMin: 0.75, wMax: 1.09, color: "rgba(68, 138, 255, 0.08)", border: "#448aff" },
  { name: "D2", wMin: 1.10, wMax: 1.62, color: "rgba(0, 229, 255, 0.08)", border: "#00e5ff" },
  { name: "D3", wMin: 1.63, wMax: 2.41, color: "rgba(0, 230, 118, 0.08)", border: "#00e676" },
  { name: "D4", wMin: 2.42, wMax: 3.82, color: "rgba(255, 235, 59, 0.08)", border: "#ffeb3b" },
  { name: "D5", wMin: 3.83, wMax: 4.41, color: "rgba(255, 145, 0, 0.08)", border: "#ff9100" },
  { name: "D6", wMin: 4.42, wMax: 5.00, color: "rgba(255, 82, 82, 0.08)", border: "#ff5252" }
];

// Key Molecular absorption features
const MOLECULES = [
  { name: "CH₄ (1.66μm)", wave: 1.66 },
  { name: "H₂O Vapor (1.90μm)", wave: 1.90 },
  { name: "CH₄ (2.30μm)", wave: 2.30 },
  { name: "H₂O Ice (3.05μm)", wave: 3.05 },
  { name: "CO₂ (4.27μm)", wave: 4.27 },
  { name: "CO (4.67μm)", wave: 4.67 }
];

/**
 * Fetch real spectrophotometry from backend (/api/spectrum)
 */
async function loadRealSpectrumData(target) {
  // Abort any redundant in-flight spectrum fetch
  if (activeSpectrumAbortController) {
    activeSpectrumAbortController.abort();
  }
  activeSpectrumAbortController = new AbortController();
  const currentSignal = activeSpectrumAbortController.signal;

  showLoader(true, `Querying IRSA cutouts & extracting photometry for ${target.name || 'target'}...`);
  spectrum102 = [];
  summaryData = null;
  hoveredPoint = null;

  // Sync coordinates to URL
  setUrlCoordinates(target.ra, target.dec, target.fov, target.id);
  updateNavLinks();

  try {
    const url = `${API_BASE}/api/spectrum?ra=${target.ra}&dec=${target.dec}&fov=${target.fov}&aperture_radius_arcsec=6.2&max_cutouts=18`;
    const res = await fetch(url, { signal: currentSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const json = await res.json();

    if (json.status === 'success' && json.spectrum_102_band) {
      spectrum102 = json.spectrum_102_band;
      summaryData = json.summary || null;
    } else if (json.status === 'no_data') {
      renderNoData(target, json.message);
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Spectrum extraction error:", err);
    renderError(err.message);
  } finally {
    if (!currentSignal.aborted) {
      showLoader(false);
      updateTelemetry();
      if (is3DMode) {
        update3DCubeData();
      } else {
        render();
      }
    }
  }
}

function showLoader(show, text = "") {
  if (loaderOverlay) {
    loaderOverlay.classList.toggle('active', show);
    if (text) loaderText.textContent = text;
  }
}

function updateTelemetry() {
  const targetLabel = currentTarget.name ? currentTarget.name.toUpperCase() : `RA ${currentTarget.ra.toFixed(4)}°`;
  coordsBadge.textContent = `TARGET: ${targetLabel} (0.75 - 5.00 μm)`;

  if (summaryData) {
    const covered = summaryData.covered_channels || 0;
    const total = summaryData.total_channels || 102;
    valChannels.textContent = `${covered} / ${total}`;
    channelBadge.textContent = `${covered} OBSERVED • ${total} NOMINAL CHANNELS`;

    valPeakFlux.textContent = summaryData.peak_flux_uJy !== null && summaryData.peak_flux_uJy !== undefined ? 
      `${summaryData.peak_flux_uJy.toFixed(1)} μJy` : "—";
    valMeanSNR.textContent = summaryData.mean_snr !== null && summaryData.mean_snr !== undefined ? 
      summaryData.mean_snr.toFixed(1) : "—";
  } else {
    const valid = spectrum102.filter(p => p.flux_uJy !== null && p.flux_uJy > 0);
    valChannels.textContent = `${valid.length} / 102`;
    valPeakFlux.textContent = "—";
    valMeanSNR.textContent = "—";
  }
}

/**
 * Main Render Function
 */
function render() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const margin = { top: 40, right: 35, bottom: 65, left: 75 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  // Background
  ctx.fillStyle = "#07090e";
  ctx.fillRect(margin.left, margin.top, plotW, plotH);

  const minWave = 0.75;
  const maxWave = 5.00;

  function toX(wave) {
    return margin.left + ((wave - minWave) / (maxWave - minWave)) * plotW;
  }

  // 1. Shaded Detector Bands
  DETECTOR_BANDS.forEach(b => {
    const x1 = toX(b.wMin);
    const x2 = toX(b.wMax);
    ctx.fillStyle = b.color;
    ctx.fillRect(x1, margin.top, x2 - x1, plotH);

    ctx.strokeStyle = "rgba(111, 140, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x2, margin.top);
    ctx.lineTo(x2, margin.top + plotH);
    ctx.stroke();

    ctx.font = "14px 'Lora', Georgia, serif";
    ctx.fillStyle = b.border;
    ctx.fillText(b.name, x1 + (x2 - x1) / 2 - 8, margin.top + 16);
  });

  // Filter valid points (channels with real measurements)
  let validPoints = spectrum102.filter(p => p.flux_uJy !== null && p.flux_uJy > 0);
  
  // Clean-pixel filtering: strictly check is_clean boolean (does NOT allow flagged pixels)
  if (filterCleanOnly) {
    validPoints = validPoints.filter(p => p.is_clean === true);
  }

  if (validPoints.length === 0) {
    ctx.font = "16px 'Lora', Georgia, serif";
    ctx.fillStyle = "#9ab0cf";
    ctx.fillText("No active exposures in this sky region have been observed in these bands yet.", margin.left + 40, h / 2);
    drawAxes(margin, plotW, plotH, 1, 100);
    return;
  }

  const minFlux = Math.max(0.01, Math.min(...validPoints.map(p => p.flux_uJy - (p.flux_err_uJy || 0))));
  const maxFlux = Math.max(...validPoints.map(p => p.flux_uJy + (p.flux_err_uJy || 0))) * 1.25;

  function toY(flux) {
    const f = Math.max(0.01, flux);
    if (useLogScale) {
      const logMin = Math.log10(minFlux);
      const logMax = Math.log10(maxFlux);
      const logF = Math.log10(f);
      return margin.top + plotH - ((logF - logMin) / (logMax - logMin)) * plotH;
    } else {
      return margin.top + plotH - ((f - minFlux) / (maxFlux - minFlux)) * plotH;
    }
  }

  // 2. Molecular Absorption Reference Lines
  if (showMolecules) {
    MOLECULES.forEach(m => {
      const mx = toX(m.wave);
      ctx.strokeStyle = "rgba(255, 64, 129, 0.45)";
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, margin.top + 24);
      ctx.lineTo(mx, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "13px 'Lora', Georgia, serif";
      ctx.fillStyle = "rgba(255, 128, 171, 0.85)";
      ctx.fillText(m.name, mx - 18, margin.top + 34);
    });
  }

  // 3. Connect valid points with line
  ctx.beginPath();
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 1.8;
  validPoints.forEach((pt, idx) => {
    const x = toX(pt.wavelength_um);
    const y = toY(pt.flux_uJy);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 4. Data Points & 1-sigma Error Bars from VARIANCE HDU
  validPoints.forEach(pt => {
    const x = toX(pt.wavelength_um);
    const y = toY(pt.flux_uJy);
    const err = pt.flux_err_uJy || 0;
    const yTop = toY(pt.flux_uJy + err);
    const yBot = toY(pt.flux_uJy - err);

    // Error Bar
    ctx.strokeStyle = pt.is_clean ? "rgba(0, 229, 255, 0.45)" : "rgba(255, 82, 82, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBot);
    ctx.stroke();

    // Node
    const isHovered = hoveredPoint && hoveredPoint.channel_index === pt.channel_index;
    ctx.beginPath();
    ctx.arc(x, y, isHovered ? 5.5 : (pt.is_clean ? 2.5 : 3.0), 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? "#ffffff" : (pt.is_clean ? "#00e5ff" : "#ff5252");
    ctx.fill();
  });

  drawAxes(margin, plotW, plotH, minFlux, maxFlux);
}

function drawAxes(margin, plotW, plotH, minFlux, maxFlux) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.strokeStyle = "rgba(111, 140, 184, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(margin.left, margin.top, plotW, plotH);

  // X-Ticks
  ctx.font = "14px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  for (let wStep = 1.0; wStep <= 5.0; wStep += 0.5) {
    const tx = margin.left + ((wStep - 0.75) / (5.00 - 0.75)) * plotW;
    ctx.beginPath();
    ctx.moveTo(tx, margin.top + plotH);
    ctx.lineTo(tx, margin.top + plotH + 5);
    ctx.stroke();
    ctx.fillText(`${wStep.toFixed(1)} μm`, tx - 14, margin.top + plotH + 20);
  }

  // Y-Axis Label
  ctx.save();
  ctx.translate(18, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "14px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(useLogScale ? "Flux Density (μJy) [Log Scale]" : "Flux Density (μJy) [Linear]", -60, 0);
  ctx.restore();

  // Bottom Title
  ctx.font = "14px 'Lora', Georgia, serif";
  ctx.fillStyle = "#eef3fc";
  ctx.fillText("Wavelength (μm) [SPHEREx 0.75 - 5.00 μm All-Sky Spectrophotometry]", margin.left + plotW / 2 - 160, h - 16);
}

function renderNoData(target, msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "17px 'Lora', Georgia, serif";
  ctx.fillStyle = "#ff9100";
  ctx.fillText("No FITS Cutouts in IRSA for Photometry Extraction", 60, canvas.height / 2 - 10);
  ctx.font = "15px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 15);
}

function renderError(msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "17px 'Lora', Georgia, serif";
  ctx.fillStyle = "#ff5252";
  ctx.fillText("Pipeline Error: Failed to Extract Photometry", 60, canvas.height / 2 - 10);
  ctx.font = "15px 'Lora', Georgia, serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 15);
}

// UI Controls
btnToggleLog.addEventListener('click', () => {
  useLogScale = !useLogScale;
  logLabel.textContent = useLogScale ? "Logarithmic Flux Scale" : "Linear Flux Scale";
  btnToggleLog.classList.toggle('active', useLogScale);
  render();
});

btnToggleMolecules.addEventListener('click', () => {
  showMolecules = !showMolecules;
  btnToggleMolecules.classList.toggle('active', showMolecules);
  render();
});

btnFilterClean.addEventListener('click', () => {
  filterCleanOnly = !filterCleanOnly;
  btnFilterClean.classList.toggle('active', filterCleanOnly);
  render();
});

targetSelect.addEventListener('change', (e) => {
  const chosen = BENCHMARK_PRESETS.find(p => p.id === e.target.value) || BENCHMARK_PRESETS[0];
  currentTarget = chosen;
  loadRealSpectrumData(currentTarget);
});

// Canvas Mouse Hover for Channel Inspection
canvas.addEventListener('mousemove', (e) => {
  if (spectrum102.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const margin = { top: 40, right: 35, bottom: 65, left: 75 };
  const plotW = canvas.width - margin.left - margin.right;

  if (mouseX < margin.left || mouseX > margin.left + plotW) {
    hoveredPoint = null;
    channelBanner.textContent = "Hover along the spectrum to inspect individual spectrophotometric channels and SNR...";
    render();
    return;
  }

  const waveAtMouse = 0.75 + ((mouseX - margin.left) / plotW) * (5.00 - 0.75);
  
  // Find closest channel
  let closest = null;
  let minDiff = Infinity;
  spectrum102.forEach(p => {
    const diff = Math.abs(p.wavelength_um - waveAtMouse);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  });

  if (closest && minDiff < 0.15) {
    hoveredPoint = closest;
    if (closest.flux_uJy !== null) {
      const cleanStr = closest.is_clean ? "CLEAN" : `FLAGGED (${(closest.flag_labels || []).join(", ")})`;
      const cleanColor = closest.is_clean ? "#00e676" : "#ff5252";
      channelBanner.innerHTML = `Channel <strong>#${closest.channel_index}</strong> (${closest.detector}): <strong>${closest.wavelength_um.toFixed(3)} μm</strong> • Flux: <strong>${closest.flux_uJy.toFixed(1)} ± ${(closest.flux_err_uJy || 0).toFixed(1)} μJy</strong> • SNR: <strong>${(closest.snr || 0).toFixed(1)}</strong> • Status: <span style="color:${cleanColor}; font-weight:600;">${cleanStr}</span> (${closest.n_exposures} exposures)`;
    } else {
      channelBanner.innerHTML = `Channel <strong>#${closest.channel_index}</strong> (${closest.detector}): <strong>${closest.wavelength_um.toFixed(3)} μm</strong> • <span style="color:#8ca0ba;">No active SPHEREx exposures in this band yet</span>`;
    }
  } else {
    hoveredPoint = null;
    channelBanner.textContent = "Hover along the spectrum to inspect individual spectrophotometric channels and SNR...";
  }
  render();
});

canvas.addEventListener('mouseleave', () => {
  hoveredPoint = null;
  channelBanner.textContent = "Hover along the spectrum to inspect individual spectrophotometric channels and SNR...";
  render();
});

if (btnToggle3D) {
  btnToggle3D.addEventListener('click', toggle3DMode);
}

// ============================================================================
// THREE.JS 3D HYPERSPECTRAL DATA CUBE ENGINE
// ============================================================================

function initThreeJSCube() {
  if (!cubeContainer3D || !window.THREE) return;
  if (threeRenderer) return; // Already initialized

  const w = cubeContainer3D.clientWidth || 800;
  const h = cubeContainer3D.clientHeight || 500;

  threeScene = new THREE.Scene();
  threeCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  threeCamera.position.set(28, 20, 36);

  threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  threeRenderer.setSize(w, h);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  cubeContainer3D.appendChild(threeRenderer.domElement);

  // HUD Overlay Badge
  const hud = document.createElement('div');
  hud.className = 'cube-hud-badge';
  hud.innerHTML = '<strong>3D HYPERSPECTRAL CUBE (Three.js)</strong><br><span style="color:#9ab0cf;">Drag: Orbit/Rotate • Scroll: Zoom • Right-click: Pan</span>';
  cubeContainer3D.appendChild(hud);

  // OrbitControls
  if (window.THREE.OrbitControls) {
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.autoRotate = true;
    threeControls.autoRotateSpeed = 0.8;
  }

  // Lights
  const ambLight = new THREE.AmbientLight(0xffffff, 0.7);
  threeScene.add(ambLight);
  const dirLight = new THREE.DirectionalLight(0x00e5ff, 0.8);
  dirLight.position.set(10, 20, 15);
  threeScene.add(dirLight);

  // Build Cube
  build3DCubeGeometry();

  // Animation Loop
  function animate() {
    threeAnimId = requestAnimationFrame(animate);
    if (threeControls) threeControls.update();
    threeRenderer.render(threeScene, threeCamera);
  }
  animate();

  window.addEventListener('resize', onThreeResize);
}

function onThreeResize() {
  if (!cubeContainer3D || !threeRenderer || !threeCamera) return;
  const w = cubeContainer3D.clientWidth;
  const h = cubeContainer3D.clientHeight;
  if (w > 0 && h > 0) {
    threeCamera.aspect = w / h;
    threeCamera.updateProjectionMatrix();
    threeRenderer.setSize(w, h);
  }
}

function getWavelengthColor(wave) {
  // Color scale from 0.75 μm (Blue/Violet) to 5.00 μm (Deep Red/Infrared)
  const norm = (wave - 0.75) / (5.00 - 0.75);
  const c = new THREE.Color();
  if (norm < 0.2) c.setRGB(0.2, 0.5, 1.0);      // D1
  else if (norm < 0.4) c.setRGB(0.0, 0.9, 1.0); // D2
  else if (norm < 0.6) c.setRGB(0.0, 0.9, 0.4); // D3
  else if (norm < 0.75) c.setRGB(1.0, 0.9, 0.2);// D4
  else if (norm < 0.9) c.setRGB(1.0, 0.5, 0.0); // D5
  else c.setRGB(1.0, 0.2, 0.3);                 // D6
  return c;
}

function build3DCubeGeometry() {
  if (!threeScene) return;
  if (cubeGroup) {
    threeScene.remove(cubeGroup);
    cubeGroup = null;
  }

  cubeGroup = new THREE.Group();

  const cubeWidth = 16;
  const cubeHeight = 16;
  const cubeDepth = 24;

  // 1. Outer Bounding Wireframe Box
  const boxGeom = new THREE.BoxGeometry(cubeWidth, cubeHeight, cubeDepth);
  const boxEdges = new THREE.EdgesGeometry(boxGeom);
  const boxLineMat = new THREE.LineBasicMaterial({ color: 0x6f8cb8, transparent: true, opacity: 0.45 });
  const wireBox = new THREE.LineSegments(boxEdges, boxLineMat);
  cubeGroup.add(wireBox);

  // 2. Corner Grid & Axes
  const axes = new THREE.AxesHelper(10);
  cubeGroup.add(axes);

  // 3. Spectral Slices along Z-axis (Wavelength)
  const validPoints = spectrum102.filter(p => p.wavelength_um !== null);
  const numSlices = Math.min(validPoints.length, 36);
  const step = Math.max(1, Math.floor(validPoints.length / (numSlices || 1)));

  const sampled = [];
  for (let i = 0; i < validPoints.length; i += step) {
    sampled.push(validPoints[i]);
  }

  const maxFlux = Math.max(1, ...sampled.map(p => p.flux_uJy || 0));
  const splinePoints = [];

  sampled.forEach((pt, idx) => {
    const normZ = idx / (sampled.length - 1 || 1);
    const zPos = (normZ - 0.5) * cubeDepth;
    const wave = pt.wavelength_um;
    const flux = Math.max(0, pt.flux_uJy || 0);
    const normFlux = Math.min(1.0, flux / maxFlux);

    const sliceGeom = new THREE.PlaneGeometry(cubeWidth * 0.95, cubeHeight * 0.95);
    const col = getWavelengthColor(wave);
    const sliceMat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.12 + normFlux * 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sliceMesh = new THREE.Mesh(sliceGeom, sliceMat);
    sliceMesh.position.set(0, 0, zPos);
    cubeGroup.add(sliceMesh);

    // Target Aperture Point Source Circle on Slice
    const starRadius = Math.max(0.4, 0.4 + normFlux * 1.8);
    const starGeom = new THREE.CircleGeometry(starRadius, 16);
    const starMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7 + normFlux * 0.3,
      side: THREE.DoubleSide,
    });
    const starMesh = new THREE.Mesh(starGeom, starMat);
    const yOffset = (normFlux - 0.5) * (cubeHeight * 0.5);
    starMesh.position.set(0, yOffset, zPos + 0.05);
    cubeGroup.add(starMesh);

    splinePoints.push(new THREE.Vector3(0, yOffset, zPos));
  });

  // 4. 3D Spectral Flux Spline Line
  if (splinePoints.length > 2) {
    const curve = new THREE.CatmullRomCurve3(splinePoints);
    const curvePoints = curve.getPoints(100);
    const lineGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2.5 });
    const splineLine = new THREE.Line(lineGeom, lineMat);
    cubeGroup.add(splineLine);
  }

  threeScene.add(cubeGroup);
}

function update3DCubeData() {
  if (is3DMode) {
    initThreeJSCube();
    build3DCubeGeometry();
    onThreeResize();
  }
}

function toggle3DMode() {
  is3DMode = !is3DMode;
  if (is3DMode) {
    canvas.style.display = 'none';
    cubeContainer3D.style.display = 'block';
    btnToggle3D.classList.add('active');
    cubeBtnText.textContent = "2D SED Chart";
    update3DCubeData();
  } else {
    cubeContainer3D.style.display = 'none';
    canvas.style.display = 'block';
    btnToggle3D.classList.remove('active');
    cubeBtnText.textContent = "3D Hyperspectral Cube (Three.js)";
    render();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Sync URL coordinates
  const urlCoords = getUrlCoordinates();
  if (urlCoords) {
    const matched = BENCHMARK_PRESETS.find(p => 
      Math.abs(p.ra - urlCoords.ra) < 0.005 && Math.abs(p.dec - urlCoords.dec) < 0.005
    );
    if (matched) {
      currentTarget = matched;
      targetSelect.value = currentTarget.id;
    } else {
      currentTarget = {
        id: "custom",
        name: `RA ${urlCoords.ra.toFixed(4)}, Dec ${urlCoords.dec.toFixed(4)}`,
        ra: urlCoords.ra,
        dec: urlCoords.dec,
        fov: urlCoords.fov || 0.05
      };
    }
  } else {
    // Default to wise-0855
    currentTarget = BENCHMARK_PRESETS[0];
    targetSelect.value = currentTarget.id;
  }

  loadRealSpectrumData(currentTarget);
});
