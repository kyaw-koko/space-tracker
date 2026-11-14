/**
 * ============================================================================
 * SPHEREx Real-World Epoch Difference Inspector (IRSA & Astropy)
 * ============================================================================
 * Fetches real SPHEREx epoch cutouts from IRSA TAP, computes Astropy epoch
 * differencing (Epoch B - Epoch A) matched STRICTLY by detector band, and
 * renders dipole contrast with zero-centered coolwarm contrast stretching.
 */

let currentTarget = BENCHMARK_PRESETS[1]; // Barnard's Star (verified dipole)
let currentDetector = ""; // Empty string = Auto-select best band with multiple observations
let viewMode = 'diff'; // 'diff' | 'wipe' | 'epoch_single'
let wipeSplit = 0.5;
let currentSingleEpoch = 'b';

let diffImg = null;
let epochAImg = null;
let epochBImg = null;
let diffData = null;
let activeDiffAbortController = null;

// DOM Elements
const canvas = document.getElementById('diffCanvas');
const ctx = canvas.getContext('2d');
const btnViewDiff = document.getElementById('btnViewDiff');
const btnWipeSlider = document.getElementById('btnWipeSlider');
const btnToggleEpochs = document.getElementById('btnToggleEpochs');
const epochLabel = document.getElementById('epochLabel');
const wipeRow = document.getElementById('wipeRow');
const wipeSlider = document.getElementById('wipeSlider');
const wipeVal = document.getElementById('wipeVal');
const targetSelect = document.getElementById('targetSelect');
const detectorSelect = document.getElementById('detectorSelect');
const loaderOverlay = document.getElementById('loaderOverlay');
const loaderText = document.getElementById('loaderText');

// Card Fields
const coordsBadge = document.getElementById('coordsBadge');
const dipoleBadge = document.getElementById('dipoleBadge');
const posPeakVal = document.getElementById('posPeakVal');
const negPeakVal = document.getElementById('negPeakVal');
const valContrast = document.getElementById('valContrast');
const valDeltaMJD = document.getElementById('valDeltaMJD');
const valCandidateStatus = document.getElementById('valCandidateStatus');
const valEpochA = document.getElementById('valEpochA');
const valEpochB = document.getElementById('valEpochB');
const valDetector = document.getElementById('valDetector');

/**
 * Fetch real epoch differencing from FastAPI backend (/api/sky-patch?mode=diff)
 */
async function loadRealDiffData(target) {
  // Abort any redundant in-flight diff query
  if (activeDiffAbortController) {
    activeDiffAbortController.abort();
  }
  activeDiffAbortController = new AbortController();
  const currentSignal = activeDiffAbortController.signal;

  showLoader(true, `Querying IRSA TAP for multiple epochs of ${target.name || 'target'}...`);
  diffData = null;
  diffImg = null;
  epochAImg = null;
  epochBImg = null;

  // Sync URL coordinates
  setUrlCoordinates(target.ra, target.dec, target.fov, target.id);
  updateNavLinks();

  try {
    let url = `${API_BASE}/api/sky-patch?ra=${target.ra}&dec=${target.dec}&fov=${target.fov}&mode=diff&max_frames=12&sampling=baseline`;
    if (currentDetector) {
      url += `&detector=${encodeURIComponent(currentDetector)}`;
    }

    const res = await fetch(url, { signal: currentSignal });
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json.detail || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(errMsg);
    }

    if (json.status === 'success' && json.data && json.data.diff_frame) {
      diffData = json.data;
      loaderText.textContent = "Astropy same-band differencing complete. Decoding FITS frames...";
      await loadImagesFromData(diffData);
      
      const contrast = diffData.diff_frame.dipole_contrast;
      if (contrast > 0.05) {
        valCandidateStatus.textContent = "Dipole Signal Detected";
        valCandidateStatus.style.color = "#00e5ff";
      } else {
        valCandidateStatus.textContent = "Static / Negligible Residual";
        valCandidateStatus.style.color = "#00e676";
      }

      // Update detector dropdown to show available detectors
      if (diffData.available_detectors && diffData.available_detectors.length > 0) {
        syncAvailableDetectors(diffData.available_detectors, diffData.detector_used);
      }
    } else if (json.status === 'no_data') {
      renderNoData(target, json.message);
      return;
    } else {
      throw new Error(json.message || "Invalid diff payload returned.");
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Diff fetch failed:", err);
    renderError(err.message);
    valCandidateStatus.textContent = "Differencing Failed";
    valCandidateStatus.style.color = "#ff5252";
  } finally {
    if (!currentSignal.aborted) {
      showLoader(false);
      updateTelemetry();
      render();
    }
  }
}

function syncAvailableDetectors(available, used) {
  if (!detectorSelect) return;
  // Keep the auto option and add badge for which detector was matched
  const options = detectorSelect.options;
  for (let i = 0; i < options.length; i++) {
    const val = options[i].value;
    if (!val) continue;
    const isAvail = available.includes(val);
    const isUsed = val === used;
    if (isUsed) {
      options[i].text = `${val} (Active Match ✓)`;
    } else if (isAvail) {
      options[i].text = `${val} (Available)`;
    } else {
      options[i].text = `${val} (No Multi-Epoch)`;
    }
  }
}

function showLoader(show, text = "") {
  if (loaderOverlay) {
    loaderOverlay.classList.toggle('active', show);
    if (text) loaderText.textContent = text;
  }
}

async function loadImagesFromData(d) {
  const p1 = new Promise(resolve => {
    const img = new Image();
    img.onload = () => { diffImg = img; resolve(); };
    img.onerror = () => resolve();
    img.src = d.diff_frame.data_url;
  });

  const p2 = new Promise(resolve => {
    if (!d.epoch_a || !d.epoch_a.data_url) return resolve();
    const img = new Image();
    img.onload = () => { epochAImg = img; resolve(); };
    img.onerror = () => resolve();
    img.src = d.epoch_a.data_url;
  });

  const p3 = new Promise(resolve => {
    if (!d.epoch_b || !d.epoch_b.data_url) return resolve();
    const img = new Image();
    img.onload = () => { epochBImg = img; resolve(); };
    img.onerror = () => resolve();
    img.src = d.epoch_b.data_url;
  });

  await Promise.all([p1, p2, p3]);
}

function updateTelemetry() {
  coordsBadge.textContent = `RA ${currentTarget.ra.toFixed(4)}° • DEC ${currentTarget.dec.toFixed(4)}° (TAN WCS)`;
  if (!diffData || !diffData.diff_frame) {
    valContrast.textContent = "—";
    valDeltaMJD.textContent = "—";
    if (valEpochA) valEpochA.textContent = "—";
    if (valEpochB) valEpochB.textContent = "—";
    if (valDetector) valDetector.textContent = "—";
    return;
  }

  const contrast = diffData.diff_frame.dipole_contrast;
  const posPeak = diffData.diff_frame.positive_peak_mjy_sr;
  const negPeak = diffData.diff_frame.negative_peak_mjy_sr;
  const delta = diffData.delta_mjd;
  const detector = diffData.detector_used || "Same-Band";
  const wave = diffData.wavelength_um ? `${diffData.wavelength_um.toFixed(2)} μm` : "";

  dipoleBadge.textContent = `DIPOLE CONTRAST: ${contrast.toFixed(3)} MJy/sr`;
  posPeakVal.textContent = `+${posPeak.toFixed(3)} MJy/sr`;
  negPeakVal.textContent = `${negPeak.toFixed(3)} MJy/sr`;
  valContrast.textContent = `${contrast.toFixed(3)} MJy/sr`;
  valDeltaMJD.textContent = `${delta.toFixed(2)} Days (MJD Δ)`;

  if (valDetector) valDetector.textContent = `${detector} ${wave ? `(${wave})` : ''}`;

  if (valEpochA && diffData.epoch_a) {
    valEpochA.textContent = `${diffData.epoch_a.obs_date_utc.split(' ')[0]} (MJD ${diffData.epoch_a.obs_mjd.toFixed(1)})`;
  }
  if (valEpochB && diffData.epoch_b) {
    valEpochB.textContent = `${diffData.epoch_b.obs_date_utc.split(' ')[0]} (MJD ${diffData.epoch_b.obs_mjd.toFixed(1)})`;
  }
}

/**
 * Main Render Function
 */
function render() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (viewMode === 'diff') {
    if (diffImg) {
      ctx.drawImage(diffImg, 0, 0, w, h);
      drawDipoleLegend(w, h);
      drawDipoleMarkers(w, h);
    }
  } else if (viewMode === 'wipe') {
    renderWipeView(w, h);
  } else if (viewMode === 'epoch_single') {
    const img = currentSingleEpoch === 'a' ? epochAImg : epochBImg;
    if (img) {
      ctx.drawImage(img, 0, 0, w, h);
      ctx.save();
      ctx.font = "14px 'Inter', sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(currentSingleEpoch === 'a' ? "Epoch A (Baseline Past)" : "Epoch B (Later Epoch)", 24, 38);
      ctx.restore();
    }
  }

  drawWCSCompass(ctx, w - 48, h - 48, 28);
}

function drawDipoleLegend(w, h) {
  ctx.save();
  ctx.font = "12px 'Inter', sans-serif";
  ctx.fillStyle = "rgba(255, 100, 100, 0.95)";
  ctx.fillText("(+) Positive Peak (Red): New Position (Epoch B)", 20, 36);

  ctx.fillStyle = "rgba(80, 160, 255, 0.95)";
  ctx.fillText("(-) Negative Trough (Blue): Past Position (Epoch A)", 20, 56);

  if (diffData && diffData.detector_used) {
    ctx.fillStyle = "rgba(0, 229, 255, 0.85)";
    ctx.fillText(`Detector: ${diffData.detector_used} (${diffData.wavelength_um.toFixed(2)} μm)`, 20, 76);
  }
  ctx.restore();
}

function drawDipoleMarkers(w, h) {
  if (!diffData || !diffData.diff_frame) return;
  const posPeaks = diffData.diff_frame.pos_peaks || [];
  const negPeaks = diffData.diff_frame.neg_peaks || [];

  ctx.save();
  // Positive Peaks (Green solid circle: New Position / Epoch B)
  posPeaks.forEach((pk, idx) => {
    const cx = pk.norm_x * w;
    const cy = pk.norm_y_canvas * h;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.font = "bold 11px 'Inter', sans-serif";
    ctx.fillStyle = "#22c55e";
    ctx.fillText(`(+) New #${idx + 1}`, cx + 15, cy + 4);
  });

  // Negative Peaks (Yellow dashed circle: Old Position / Epoch A)
  negPeaks.forEach((pk, idx) => {
    const cx = pk.norm_x * w;
    const cy = pk.norm_y_canvas * h;
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "bold 11px 'Inter', sans-serif";
    ctx.fillStyle = "#facc15";
    ctx.fillText(`(-) Old #${idx + 1}`, cx + 15, cy + 4);
  });
  ctx.restore();
}

function renderWipeView(w, h) {
  const splitX = w * wipeSplit;

  // Left: Epoch A
  if (epochAImg) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, h);
    ctx.clip();
    ctx.drawImage(epochAImg, 0, 0, w, h);
    ctx.restore();
  }

  // Right: Epoch B
  if (epochBImg) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(splitX, 0, w - splitX, h);
    ctx.clip();
    ctx.drawImage(epochBImg, 0, 0, w, h);
    ctx.restore();
  }

  // Divider Line
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(splitX, 0);
  ctx.lineTo(splitX, h);
  ctx.stroke();

  // Labels
  ctx.font = "13px 'Inter', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Epoch A (Past)", 20, 36);
  ctx.fillText("Epoch B (Current)", Math.max(splitX + 16, w - 160), 36);
}

function renderNoData(target, msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px 'Playfair Display', Georgia, serif";
  ctx.fillStyle = "#ff9100";
  ctx.fillText("No Multi-Epoch Cutouts Available for Differencing", 60, canvas.height / 2 - 10);
  ctx.font = "13px 'Inter', sans-serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 15);
}

function renderError(msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px 'Playfair Display', Georgia, serif";
  ctx.fillStyle = "#ff5252";
  ctx.fillText("Scientific Differencing Constraint", 60, canvas.height / 2 - 20);
  ctx.font = "13px 'Inter', sans-serif";
  ctx.fillStyle = "#cbd5e1";
  
  // Wrap error text
  const words = msg.split(' ');
  let line = '';
  let y = canvas.height / 2 + 10;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > canvas.width - 120 && n > 0) {
      ctx.fillText(line, 60, y);
      line = words[n] + ' ';
      y += 20;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, 60, y);

  ctx.fillStyle = "#8ca0ba";
  ctx.fillText("Note: SPHEREx detectors have non-overlapping bands. Differencing requires at least 2 exposures in the same band.", 60, y + 25);
}

// UI Controls
btnViewDiff.addEventListener('click', () => {
  viewMode = 'diff';
  btnViewDiff.classList.add('active');
  btnWipeSlider.classList.remove('active');
  btnToggleEpochs.classList.remove('active');
  wipeRow.style.display = 'none';
  render();
});

btnWipeSlider.addEventListener('click', () => {
  viewMode = 'wipe';
  btnWipeSlider.classList.add('active');
  btnViewDiff.classList.remove('active');
  btnToggleEpochs.classList.remove('active');
  wipeRow.style.display = 'flex';
  render();
});

btnToggleEpochs.addEventListener('click', () => {
  viewMode = 'epoch_single';
  currentSingleEpoch = currentSingleEpoch === 'a' ? 'b' : 'a';
  epochLabel.textContent = currentSingleEpoch === 'a' ? 'Show Epoch A (Past)' : 'Show Epoch B (Current)';
  btnToggleEpochs.classList.add('active');
  btnViewDiff.classList.remove('active');
  btnWipeSlider.classList.remove('active');
  wipeRow.style.display = 'none';
  render();
});

wipeSlider.addEventListener('input', (e) => {
  wipeSplit = parseInt(e.target.value, 10) / 100.0;
  wipeVal.textContent = `${Math.round(wipeSplit * 100)}% Split`;
  render();
});

targetSelect.addEventListener('change', (e) => {
  const chosen = BENCHMARK_PRESETS.find(p => p.id === e.target.value) || BENCHMARK_PRESETS[1];
  currentTarget = chosen;
  loadRealDiffData(currentTarget);
});

if (detectorSelect) {
  detectorSelect.addEventListener('change', (e) => {
    currentDetector = e.target.value;
    loadRealDiffData(currentTarget);
  });
}

document.addEventListener('DOMContentLoaded', () => {
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
  }

  loadRealDiffData(currentTarget);
});
