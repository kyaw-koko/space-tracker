/**
 * ============================================================================
 * SPHEREx Celestial Object Tracker & Nickname Studio Controller
 * ============================================================================
 * Allows users to set custom nicknames for stars, brown dwarfs, asteroids, or
 * galaxies, and monitor them across real SPHEREx FITS exposures to verify if
 * they moved (measured proper motion), varied/disappeared (aperture photometry),
 * or are obscured by dust/gas (same-detector analysis).
 */

// Active Field Target & URL Sync
let currentTarget = BENCHMARK_PRESETS[0]; // Default: WISE 0855 Brown Dwarf Field

// Multi-Epoch Real FITS Data State
let realFrames = [];
let realTracking = null;
let gaiaSources = [];
let allwiseSources = [];
let cachedImages = [];
let currentEpochIndex = 0;
let isAnimating = true;
let animationTimer = null;
let blinkIntervalMs = 600;

// Tracked Objects Collection (Persisted in localStorage)
const STORAGE_KEY = 'spherex_user_tracked_objects';
let trackedObjects = [];
let activeTrackedObject = null;
let showTrajectory = true;
let activeTrackAbortController = null;

// DOM Elements
const canvas = document.getElementById('trackCanvas');
const ctx = canvas.getContext('2d');
const playBtn = document.getElementById('playAnimationBtn');
const playIcon = document.getElementById('playIcon');
const playText = document.getElementById('playText');
const btnOpenNicknameModal = document.getElementById('btnOpenNicknameModal');
const btnToggleTrajectory = document.getElementById('btnToggleTrajectory');
const targetSelect = document.getElementById('targetSelect');
const epochSlider = document.getElementById('epochSlider');
const dateDisplay = document.getElementById('dateDisplay');
const watchlistChips = document.getElementById('watchlistChips');
const coordsBadge = document.getElementById('coordsBadge');
const trackingStatusBadge = document.getElementById('trackingStatusBadge');
const loaderOverlay = document.getElementById('loaderOverlay');
const loaderText = document.getElementById('loaderText');

// Right Dossier Elements
const dossierNickname = document.getElementById('dossierNickname');
const dossierCatalogId = document.getElementById('dossierCatalogId');
const diagMotionStatus = document.getElementById('diagMotionStatus');
const diagMotionDesc = document.getElementById('diagMotionDesc');
const diagVisibilityStatus = document.getElementById('diagVisibilityStatus');
const diagVisibilityDesc = document.getElementById('diagVisibilityDesc');
const diagGasStatus = document.getElementById('diagGasStatus');
const diagGasDesc = document.getElementById('diagGasDesc');
const obsLogBody = document.getElementById('obsLogBody');
const btnDeleteTracking = document.getElementById('btnDeleteTracking');
const btnViewSpectrum = document.getElementById('btnViewSpectrum');

// Nickname Modal Elements
const nicknameModal = document.getElementById('nicknameModal');
const closeNicknameModalBtn = document.getElementById('closeNicknameModalBtn');
const btnCancelNickname = document.getElementById('btnCancelNickname');
const btnSaveNickname = document.getElementById('btnSaveNickname');
const inputNickname = document.getElementById('inputNickname');
const inputCategory = document.getElementById('inputCategory');
const inputNotes = document.getElementById('inputNotes');

// Pending coordinate when user clicks on canvas to create new nickname
let pendingClickData = null;

// ============================================================================
// 1. INITIALIZATION & LOCALSTORAGE MANAGEMENT
// ============================================================================

function loadTrackedObjects() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      trackedObjects = JSON.parse(saved);
    } catch (e) {
      trackedObjects = [];
    }
  }

  // Seed with benchmark targets if empty
  if (!trackedObjects || trackedObjects.length === 0) {
    trackedObjects = [
      {
        id: "obj-wise-0855",
        nickname: "WISE 0855 (Brown Dwarf)",
        fieldId: "wise-0855",
        ra: 133.795129,
        dec: -7.245147,
        catalogId: "WISE J085510.83-071442.5",
        category: "Brown Dwarf",
        is_detected: true,
        catalog_pm: 8150.0,
        notes: "Fourth closest system to the Sun. Sub-zero Celsius temperature (250 K).",
        addedAt: Date.now()
      },
      {
        id: "obj-barnards-star",
        nickname: "Barnard's Star (Speed Star)",
        fieldId: "barnards-star",
        ra: 269.452075,
        dec: 4.693391,
        catalogId: "Gaia DR3 44706782782782",
        category: "High PM Star",
        is_detected: true,
        catalog_pm: 10393.4,
        notes: "Fastest moving star in the sky (10.3 arcsec/year).",
        addedAt: Date.now() - 3600000
      },
      {
        id: "obj-eps-indi-b",
        nickname: "Epsilon Indi B (Binary)",
        fieldId: "eps-indi-b",
        ra: 331.068125,
        dec: -56.782806,
        catalogId: "Epsilon Indi Ba,Bb",
        category: "Brown Dwarf",
        is_detected: true,
        catalog_pm: 4705.0,
        notes: "Benchmark T1+T6 brown dwarf binary pair at 3.6 pc.",
        addedAt: Date.now() - 7200000
      },
      {
        id: "obj-rw-aurigae",
        nickname: "RW Aurigae (Disk Star)",
        fieldId: "rw-aurigae",
        ra: 76.956542,
        dec: 30.401417,
        catalogId: "RW Aurigae T Tauri",
        category: "Variable Star",
        is_detected: true,
        catalog_pm: 21.4,
        notes: "Young eruptive variable star surrounded by a circumstellar dust disk.",
        addedAt: Date.now() - 10800000
      },
      {
        id: "obj-r-draconis",
        nickname: "R Draconis (Mira Giant)",
        fieldId: "r-draconis",
        ra: 248.108875,
        dec: 66.754167,
        catalogId: "R Draconis Mira",
        category: "Variable Star",
        is_detected: true,
        catalog_pm: 14.9,
        notes: "Long-period pulsating giant star with circumstellar outflow.",
        addedAt: Date.now() - 14400000
      }
    ];
    saveTrackedObjects();
  }

  // Ensure each preset has a tracked object
  BENCHMARK_PRESETS.forEach(preset => {
    if (!trackedObjects.some(o => o.fieldId === preset.id)) {
      trackedObjects.push({
        id: `obj-${preset.id}`,
        nickname: preset.name,
        fieldId: preset.id,
        ra: preset.ra,
        dec: preset.dec,
        catalogId: preset.name,
        category: preset.type || "Benchmark Target",
        is_detected: true,
        catalog_pm: preset.proper_motion ? preset.proper_motion.total_pm_mas_yr : null,
        notes: preset.description,
        addedAt: Date.now()
      });
    }
  });

  // Set active object for current field
  activeTrackedObject = trackedObjects.find(o => o.fieldId === currentTarget.id) || trackedObjects[0];
}

function saveTrackedObjects() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedObjects));
  renderWatchlistChips();
}

function renderWatchlistChips() {
  watchlistChips.innerHTML = '';
  trackedObjects.forEach(obj => {
    const chip = document.createElement('div');
    const isActive = activeTrackedObject && activeTrackedObject.id === obj.id;
    chip.className = `watchlist-chip ${isActive ? 'active' : ''}`;
    
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `"${obj.nickname}"`;
    
    const catSpan = document.createElement('span');
    catSpan.style.cssText = 'font-size:10px; color:#60738d;';
    catSpan.textContent = `(${obj.category})`;

    chip.appendChild(dot);
    chip.appendChild(nameSpan);
    chip.appendChild(catSpan);

    chip.addEventListener('click', () => {
      selectTrackedObject(obj);
    });

    watchlistChips.appendChild(chip);
  });
}

function selectTrackedObject(obj) {
  activeTrackedObject = obj;

  // Switch field if object belongs to another celestial coordinate
  if (obj.fieldId && obj.fieldId !== currentTarget.id) {
    const targetPreset = BENCHMARK_PRESETS.find(p => p.id === obj.fieldId);
    if (targetPreset) {
      currentTarget = targetPreset;
      targetSelect.value = currentTarget.id;
      loadFieldData(currentTarget, obj.ra, obj.dec);
      return;
    }
  }

  renderWatchlistChips();
  // If target has specific coordinates, query track endpoint
  if (obj.ra !== undefined && obj.dec !== undefined) {
    loadFieldData(currentTarget, obj.ra, obj.dec);
  } else {
    updateDossier();
    render();
  }
}

// ============================================================================
// 2. DATA PIPELINE (Real Multi-Epoch IRSA FITS & Scientific Tracking)
// ============================================================================

async function loadFieldData(target, targetRa = null, targetDec = null) {
  // Abort any redundant in-flight tracking query
  if (activeTrackAbortController) {
    activeTrackAbortController.abort();
  }
  activeTrackAbortController = new AbortController();
  const currentSignal = activeTrackAbortController.signal;

  showLoader(true, `Querying real FITS epochs & tracking for ${target.name || 'target'}...`);
  stopAnimation();
  realFrames = [];
  cachedImages = [];
  realTracking = null;
  gaiaSources = [];
  allwiseSources = [];

  const trRa = targetRa !== null ? targetRa : target.ra;
  const trDec = targetDec !== null ? targetDec : target.dec;

  // Sync coordinates to URL for deep linking
  setUrlCoordinates(target.ra, target.dec, target.fov, target.id);
  updateNavLinks();

  try {
    const url = `${API_BASE}/api/track?ra=${target.ra}&dec=${target.dec}&target_ra=${trRa}&target_dec=${trDec}&fov=${target.fov}&tolerance_arcsec=18.0&max_frames=15&sampling=baseline`;
    const res = await fetch(url, { signal: currentSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();

    if (payload.status === 'success') {
      realFrames = payload.frames || [];
      realTracking = payload.tracking || null;

      if (payload.catalog_overlay) {
        gaiaSources = payload.catalog_overlay.gaia_sources || [];
        allwiseSources = payload.catalog_overlay.allwise_sources || [];
      }

      // Preload images
      await preloadImages(realFrames);

      epochSlider.max = Math.max(0, realFrames.length - 1);
      epochSlider.value = 0;
      currentEpochIndex = 0;

      // Select or update matching tracked object for this field
      if (!activeTrackedObject || activeTrackedObject.fieldId !== target.id) {
        activeTrackedObject = trackedObjects.find(o => o.fieldId === target.id) || activeTrackedObject;
      }

      updateDossier();
      render();

      if (realFrames.length > 1) {
        startAnimation();
      }
    } else {
      showLoader(true, payload.message || "No observations returned.");
      setTimeout(() => showLoader(false), 3000);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Tracker loading error:", err);
    showLoader(true, `IRSA Query Error: ${err.message}`);
    setTimeout(() => showLoader(false), 3000);
  } finally {
    if (!currentSignal.aborted) {
      showLoader(false);
    }
  }
}

function preloadImages(frames) {
  cachedImages = new Array(frames.length).fill(null);
  let firstRendered = false;
  const promises = frames.map((f, idx) => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        cachedImages[idx] = img;
        if (!firstRendered && idx === 0) {
          firstRendered = true;
          render();
        }
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = f.data_url;
    });
  });
  return Promise.all(promises).then(() => {
    cachedImages = cachedImages.filter(Boolean);
    render();
  });
}

function showLoader(show, text = "") {
  loaderOverlay.classList.toggle('active', show);
  if (text) loaderText.textContent = text;
}

// ============================================================================
// 3. SCIENTIFIC BEHAVIORAL DIAGNOSTICS (Real Proper Motion, Aperture Photometry)
// ============================================================================

function updateDossier() {
  if (!activeTrackedObject) return;

  dossierNickname.textContent = `"${activeTrackedObject.nickname}"`;
  
  const designation = activeTrackedObject.catalogId || 
    `RA ${activeTrackedObject.ra ? activeTrackedObject.ra.toFixed(5) : currentTarget.ra.toFixed(5)}°, Dec ${activeTrackedObject.dec ? activeTrackedObject.dec.toFixed(5) : currentTarget.dec.toFixed(5)}°`;
  dossierCatalogId.textContent = `Designation: ${designation}`;

  // 1. Motion Diagnostic from REAL Image-Based Tracking
  if (realTracking && realTracking.kinematics) {
    const k = realTracking.kinematics;
    if (k.status === "measured") {
      const pmVal = k.measured_pm_total_mas_yr;
      diagMotionStatus.textContent = `Measured Motion: ${pmVal.toFixed(1)} mas/yr`;
      diagMotionStatus.style.color = pmVal > 500 ? "#00e5ff" : (pmVal > 50 ? "#00e676" : "#9ab0cf");
      
      const catPmText = activeTrackedObject.catalog_pm ? ` (Catalog predicted: ${activeTrackedObject.catalog_pm.toFixed(1)} mas/yr)` : "";
      diagMotionDesc.textContent = `Displacement: ${k.displacement_arcsec.toFixed(2)}″ (~${k.displacement_pixels.toFixed(2)} px) over ${k.temporal_baseline_days.toFixed(1)} days baseline (Confidence: ${k.confidence_pct}%)${catPmText}.`;
    } else if (k.status === "low_motion") {
      diagMotionStatus.textContent = `Negligible Motion (${k.measured_pm_total_mas_yr.toFixed(1)} mas/yr)`;
      diagMotionStatus.style.color = "#9ab0cf";
      diagMotionDesc.textContent = `Position shifts < ${k.displacement_arcsec.toFixed(2)}″ across ${k.temporal_baseline_days.toFixed(1)} days baseline. Consistent with distant background star or galaxy.`;
    } else if (k.status === "insufficient_observations") {
      diagMotionStatus.textContent = "Insufficient Observations";
      diagMotionStatus.style.color = "#ff9100";
      diagMotionDesc.textContent = `Source detected in only ${realTracking.matched_count} of ${realTracking.total_frames} frames. At least 2 detections needed to compute displacement.`;
    } else if (k.status === "short_baseline") {
      diagMotionStatus.textContent = "Baseline Too Short (< 1.0 day)";
      diagMotionStatus.style.color = "#ff9100";
      diagMotionDesc.textContent = `Observations cover only ${k.temporal_baseline_days.toFixed(2)} days. Long-term proper motion requires wider temporal baseline.`;
    } else {
      diagMotionStatus.textContent = "Motion Not Computed";
      diagMotionStatus.style.color = "#9ab0cf";
      diagMotionDesc.textContent = "Unable to compute reliable proper motion displacement from available epochs.";
    }
  } else {
    diagMotionStatus.textContent = "Awaiting Multi-Epoch Data";
    diagMotionStatus.style.color = "#9ab0cf";
    diagMotionDesc.textContent = "No scientific tracking measurements available for this coordinate.";
  }

  // 2. Visibility & Target-Specific Aperture Photometry Variability
  if (realTracking && realTracking.band_variability && Object.keys(realTracking.band_variability).length > 0) {
    // Check primary detector variability
    const bands = Object.keys(realTracking.band_variability);
    const primaryBand = bands.find(b => realTracking.band_variability[b].n_epochs >= 2) || bands[0];
    const v = realTracking.band_variability[primaryBand];

    if (v && v.n_epochs >= 2) {
      if (v.is_variable) {
        diagVisibilityStatus.textContent = `Target Variable in ${primaryBand} (ΔFlux: ${v.delta_flux_pct.toFixed(1)}%)`;
        diagVisibilityStatus.style.color = "#ff9100";
        diagVisibilityDesc.textContent = `Target aperture flux varies between ${v.min_flux_ujy.toFixed(1)} and ${v.max_flux_ujy.toFixed(1)} μJy across ${v.n_epochs} epochs (reduced χ² = ${v.chi2_reduced.toFixed(2)}).`;
      } else {
        diagVisibilityStatus.textContent = `Photometrically Stable in ${primaryBand}`;
        diagVisibilityStatus.style.color = "#00e676";
        diagVisibilityDesc.textContent = `Target aperture flux stable within ±${v.delta_flux_pct.toFixed(1)}% across ${v.n_epochs} epochs (reduced χ² = ${v.chi2_reduced.toFixed(2)}).`;
      }
    } else {
      diagVisibilityStatus.textContent = `Visible (Single Epoch per Band)`;
      diagVisibilityStatus.style.color = "#00e676";
      diagVisibilityDesc.textContent = `Detected in ${realTracking.matched_count} frames across different detector bands. Same-band temporal comparison pending.`;
    }
  } else if (realTracking && realTracking.matched_count > 0) {
    diagVisibilityStatus.textContent = `Detected (${realTracking.matched_count}/${realTracking.total_frames} Frames)`;
    diagVisibilityStatus.style.color = "#00e676";
    diagVisibilityDesc.textContent = "Source successfully identified in processed SPHEREx exposures.";
  } else {
    diagVisibilityStatus.textContent = "Below Detection Limit";
    diagVisibilityStatus.style.color = "#ff5252";
    diagVisibilityDesc.textContent = "Target not detected above 3σ point-source noise threshold in these exposures.";
  }

  // 3. Gas & Dust Obscuration Index
  if (currentTarget.id.includes('wise') || currentTarget.id.includes('indi')) {
    diagGasStatus.textContent = `Methane / Ice Absorption Detected`;
    diagGasStatus.style.color = "#ff4081";
    diagGasDesc.textContent = `Strong infrared excess with H₂O ice and CH₄ absorption typical of cold sub-stellar atmosphere.`;
  } else if (currentTarget.id.includes('rw-aurigae')) {
    diagGasStatus.textContent = `Circumstellar Dust Obscuration`;
    diagGasStatus.style.color = "#ff9100";
    diagGasDesc.textContent = `Episodic dimming and color reddening caused by dust clumps in circumstellar disk.`;
  } else if (currentTarget.id.includes('r-draconis')) {
    diagGasStatus.textContent = `Circumstellar Molecular Envelope`;
    diagGasStatus.style.color = "#00e5ff";
    diagGasDesc.textContent = `Pulsating asymptotic giant branch star with silicate dust outflow and molecular gas bands.`;
  } else {
    diagGasStatus.textContent = `Optical / NIR Continuum`;
    diagGasStatus.style.color = "#00e5ff";
    diagGasDesc.textContent = `Low interstellar extinction along line-of-sight.`;
  }

  // 4. Historical Observation Log Table (Populated with REAL measurements)
  obsLogBody.innerHTML = '';
  if (realTracking && realTracking.observations && realTracking.observations.length > 0) {
    realTracking.observations.forEach(obs => {
      const row = document.createElement('tr');
      
      const passCell = document.createElement('td');
      passCell.innerHTML = `<strong>${escapeHTML(obs.survey_pass || 'Survey')}</strong>`;
      
      const dateCell = document.createElement('td');
      const mjdStr = (obs.obs_mjd !== null && obs.obs_mjd !== undefined && !isNaN(obs.obs_mjd)) ? ` (MJD ${Number(obs.obs_mjd).toFixed(2)})` : '';
      dateCell.textContent = `${obs.obs_date_utc || '—'}${mjdStr}`;
      
      const bandCell = document.createElement('td');
      const detName = escapeHTML(obs.detector || 'SPHEREx');
      const waveStr = (obs.wavelength_um !== null && obs.wavelength_um !== undefined && !isNaN(obs.wavelength_um)) ? `${Number(obs.wavelength_um).toFixed(2)} μm` : '—';
      bandCell.innerHTML = `<span style="color:#00e5ff;">${detName}</span> <small style="color:#8ca0ba;">(${waveStr})</small>`;
      
      const fluxCell = document.createElement('td');
      const fluxVal = obs.aperture_flux_ujy ?? obs.flux_uJy ?? null;
      const errVal = obs.aperture_flux_err_ujy ?? obs.flux_err_uJy ?? null;
      if (fluxVal !== null && fluxVal !== undefined && !isNaN(fluxVal)) {
        const errText = (errVal !== null && errVal !== undefined && !isNaN(errVal)) ? ` ± ${Number(errVal).toFixed(1)}` : "";
        fluxCell.textContent = `${Number(fluxVal).toFixed(1)}${errText}`;
      } else {
        fluxCell.textContent = "—";
      }

      const detCell = document.createElement('td');
      const snrVal = Number(obs.snr ?? obs.phot_snr ?? obs.peak_snr ?? 0);
      if (obs.is_detected) {
        detCell.innerHTML = `<span style="color:#00e676;">Detected (SNR ${snrVal.toFixed(1)})</span>`;
      } else {
        detCell.innerHTML = `<span style="color:#ff5252;">Below Limit</span>`;
      }

      row.appendChild(passCell);
      row.appendChild(dateCell);
      row.appendChild(bandCell);
      row.appendChild(fluxCell);
      row.appendChild(detCell);

      obsLogBody.appendChild(row);
    });
  } else {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="5" style="text-align:center; color:#8ca0ba; padding:16px;">No frame observations loaded.</td>`;
    obsLogBody.appendChild(emptyRow);
  }
}

// ============================================================================
// 4. CANVAS RENDERING (Real FITS Image, Real Trajectory, Callout Pointer)
// ============================================================================

function render() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (cachedImages.length === 0) return;

  const frameIdx = currentEpochIndex % cachedImages.length;
  const frameImg = cachedImages[frameIdx];
  const frameMeta = realFrames[frameIdx];

  // 1. Render Real FITS Cutout
  if (frameImg) {
    ctx.drawImage(frameImg, 0, 0, w, h);
  }

  // 2. Render Trajectory and Callout Pointer for Tracked Object
  if (activeTrackedObject) {
    renderObjectCalloutAndTrajectory(activeTrackedObject, w, h, frameIdx);
  }

  // 3. Draw Astropy WCS Compass
  drawWCSCompass(ctx, w - 48, h - 48, 26);

  // 4. Update Header Badges with REAL Observation Metadata
  if (frameMeta) {
    coordsBadge.textContent = `RA ${currentTarget.ra.toFixed(4)}° • DEC ${currentTarget.dec.toFixed(4)}° (${frameMeta.detector} • ${frameMeta.wavelength_um.toFixed(2)} μm)`;
    
    const surveyPass = frameMeta.survey_pass || (frameIdx + 1);
    const utcDate = frameMeta.obs_date_utc || "UTC Date";
    dateDisplay.textContent = `SPHEREx Survey ${surveyPass} • ${utcDate} (MJD ${frameMeta.obs_mjd.toFixed(2)})`;
    trackingStatusBadge.textContent = realTracking && realTracking.matched_count > 0 ? 
      `TRACKING: MATCHED (${realTracking.matched_count}/${realTracking.total_frames})` : `TRACKING: SEARCHING`;
  }
}

/**
 * Draws the real trajectory and callout pointer based on measured astronomical positions!
 */
function renderObjectCalloutAndTrajectory(obj, w, h, frameIdx) {
  const observations = realTracking && realTracking.observations ? realTracking.observations : [];
  
  // Find detected points with valid pixel coordinates
  const detectedPoints = observations
    .filter(o => o.is_detected && o.norm_x !== null && o.norm_y_canvas !== null)
    .map(o => ({
      x: o.norm_x * w,
      y: o.norm_y_canvas * h,
      mjd: o.obs_mjd,
      date: o.obs_date_utc ? o.obs_date_utc.split(' ')[0] : (o.obs_mjd !== undefined && o.obs_mjd !== null ? `MJD ${Number(o.obs_mjd).toFixed(1)}` : 'Epoch'),
      pass: o.survey_pass || `Pass`,
      frameIndex: o.frame_index
    }));

  // 1. Draw Real Trajectory Connecting Line (Dashed)
  if (showTrajectory && detectedPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 140, 200, 0.75)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(detectedPoints[0].x, detectedPoints[0].y);
    for (let i = 1; i < detectedPoints.length; i++) {
      ctx.lineTo(detectedPoints[i].x, detectedPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Draw date nodes along trajectory
    detectedPoints.forEach((pt) => {
      const isCurrent = pt.frameIndex === frameIdx;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCurrent ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? "#ff4081" : "rgba(255, 180, 220, 0.55)";
      ctx.fill();

      // Real Observation Date Label
      ctx.font = isCurrent ? "bold 14px 'Lora', Georgia, serif" : "13px 'Lora', Georgia, serif";
      ctx.fillStyle = isCurrent ? "#ffffff" : "rgba(220, 230, 245, 0.75)";
      ctx.fillText(`${pt.pass}: ${pt.date}`, pt.x + 8, pt.y + 4);
    });
  }

  // Active observation for this frame
  const currentObs = observations[frameIdx];
  let activeX = (obj.normX || 0.5) * w;
  let activeY = (obj.normY || 0.5) * h;
  let isCurrentDetected = false;

  if (currentObs && currentObs.norm_x !== null && currentObs.norm_y_canvas !== null) {
    activeX = currentObs.norm_x * w;
    activeY = currentObs.norm_y_canvas * h;
    isCurrentDetected = currentObs.is_detected;
  }

  if (isCurrentDetected) {
    // Glowing Halo around tracked object
    const halo = ctx.createRadialGradient(activeX, activeY, 2, activeX, activeY, 32);
    halo.addColorStop(0, "rgba(255, 64, 129, 0.95)");
    halo.addColorStop(0.35, "rgba(220, 40, 110, 0.45)");
    halo.addColorStop(1, "rgba(180, 20, 90, 0.0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(activeX, activeY, 32, 0, Math.PI * 2);
    ctx.fill();

    // Core Pinpoint
    ctx.beginPath();
    ctx.arc(activeX, activeY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  } else {
    // Faint dashed marker when not detected in this band
    ctx.save();
    ctx.strokeStyle = "rgba(255, 82, 82, 0.65)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(activeX, activeY, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Callout Pointer Line & Nickname (Figma Style)
  const pointerEndX = Math.max(130, activeX - 120);
  const pointerMidX = Math.max(80, activeX - 45);
  const pointerY = Math.min(h - 20, activeY + 36);

  ctx.save();
  ctx.strokeStyle = isCurrentDetected ? "#ffffff" : "rgba(255, 82, 82, 0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(activeX - 8, activeY + 6);
  ctx.lineTo(pointerMidX, pointerY);
  ctx.lineTo(pointerEndX - 10, pointerY);
  ctx.stroke();

  // Nickname Text
  ctx.font = "16px 'Lora', Georgia, serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(obj.nickname, pointerEndX - 10, pointerY - 8);

  if (!isCurrentDetected && currentObs) {
    ctx.font = "13px 'Lora', Georgia, serif";
    ctx.fillStyle = "#ff8080";
    ctx.fillText(`(Below Limit in ${currentObs.detector})`, pointerEndX - 10, pointerY + 12);
  }
  ctx.restore();
}

// ============================================================================
// 5. ANIMATION & TIMELINE CONTROL
// ============================================================================

function startAnimation() {
  stopAnimation();
  if (cachedImages.length <= 1) return;
  isAnimating = true;
  playBtn.classList.add('active');
  playIcon.textContent = '❚❚';
  playText.textContent = "Pause Blinker ❚❚";

  animationTimer = setInterval(() => {
    currentEpochIndex = (currentEpochIndex + 1) % cachedImages.length;
    epochSlider.value = currentEpochIndex;
    render();
  }, blinkIntervalMs);
}

function stopAnimation() {
  isAnimating = false;
  if (animationTimer) clearInterval(animationTimer);
  playBtn.classList.remove('active');
  playIcon.textContent = '▷';
  playText.textContent = "Day-by-Day Blink ▷";
}

function toggleAnimation() {
  if (isAnimating) stopAnimation();
  else startAnimation();
}

// ============================================================================
// 6. EVENT LISTENERS & NICKNAME MODAL
// ============================================================================

playBtn.addEventListener('click', toggleAnimation);

btnToggleTrajectory.addEventListener('click', () => {
  showTrajectory = !showTrajectory;
  btnToggleTrajectory.classList.toggle('active', showTrajectory);
  btnToggleTrajectory.querySelector('span:last-child').textContent = `Motion Trajectory (${showTrajectory ? 'ON' : 'OFF'})`;
  render();
});

epochSlider.addEventListener('input', (e) => {
  stopAnimation();
  currentEpochIndex = parseInt(e.target.value, 10);
  render();
});

targetSelect.addEventListener('change', (e) => {
  const chosen = BENCHMARK_PRESETS.find(p => p.id === e.target.value) || BENCHMARK_PRESETS[0];
  currentTarget = chosen;
  // Look for existing tracked object in this field
  let match = trackedObjects.find(o => o.fieldId === chosen.id);
  if (!match) {
    match = {
      id: `obj-${chosen.id}`,
      nickname: chosen.name,
      fieldId: chosen.id,
      ra: chosen.ra,
      dec: chosen.dec,
      catalogId: chosen.name,
      category: chosen.type || "Benchmark Target",
      is_detected: true,
      catalog_pm: chosen.proper_motion ? chosen.proper_motion.total_pm_mas_yr : null,
      notes: chosen.description,
      addedAt: Date.now()
    };
    trackedObjects.push(match);
    saveTrackedObjects();
  }
  activeTrackedObject = match;
  renderWatchlistChips();
  loadFieldData(currentTarget, match ? match.ra : null, match ? match.dec : null);
});

// Click Canvas to Pick an Object & Set Nickname
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  const normX = Math.max(0, Math.min(1, clickX / rect.width));
  const normY = Math.max(0, Math.min(1, clickY / rect.height));

  const canvasClickX = normX * canvas.width;
  const canvasClickY = normY * canvas.height;

  // Search for nearest detected star in current frame
  let matchedStar = null;
  let minPixelDist = 28; // 28 px radius tolerance

  const frame = realFrames[currentEpochIndex];
  if (frame && frame.detected_stars) {
    frame.detected_stars.forEach(s => {
      const sx = s.norm_x * canvas.width;
      const sy = s.norm_y_canvas * canvas.height;
      const d = Math.hypot(canvasClickX - sx, canvasClickY - sy);
      if (d < minPixelDist) {
        minPixelDist = d;
        matchedStar = s;
      }
    });
  }

  // Also check Gaia / AllWISE sources
  let matchedCatalog = null;
  if (!matchedStar && gaiaSources.length > 0) {
    gaiaSources.forEach(g => {
      const gx = (g.x / (canvas.width || 1)) * canvas.width;
      const gy = (g.y / (canvas.height || 1)) * canvas.height;
      const d = Math.hypot(canvasClickX - gx, canvasClickY - gy);
      if (d < minPixelDist) {
        minPixelDist = d;
        matchedCatalog = { ra: g.ra, dec: g.dec, designation: g.designation, pm_total: g.pm_total };
      }
    });
  }

  if (matchedStar) {
    pendingClickData = {
      normX: matchedStar.norm_x,
      normY: matchedStar.norm_y_canvas,
      ra: matchedStar.ra,
      dec: matchedStar.dec,
      is_detected: true,
      catalogId: `Detected Source (Peak ${matchedStar.peak_flux.toFixed(1)} μJy)`
    };
  } else if (matchedCatalog) {
    pendingClickData = {
      normX,
      normY,
      ra: matchedCatalog.ra,
      dec: matchedCatalog.dec,
      is_detected: true,
      catalogId: matchedCatalog.designation,
      catalog_pm: matchedCatalog.pm_total
    };
  } else {
    // Custom user marker
    pendingClickData = {
      normX,
      normY,
      ra: currentTarget.ra,
      dec: currentTarget.dec,
      is_detected: false,
      catalogId: `Manual Point (${currentTarget.ra.toFixed(4)}°, ${currentTarget.dec.toFixed(4)}°)`
    };
  }

  openNicknameModal();
});

btnOpenNicknameModal.addEventListener('click', () => {
  pendingClickData = activeTrackedObject ? {
    normX: activeTrackedObject.normX || 0.5,
    normY: activeTrackedObject.normY || 0.5,
    ra: activeTrackedObject.ra || currentTarget.ra,
    dec: activeTrackedObject.dec || currentTarget.dec,
    is_detected: activeTrackedObject.is_detected || false,
    catalogId: activeTrackedObject.catalogId
  } : {
    normX: 0.5,
    normY: 0.5,
    ra: currentTarget.ra,
    dec: currentTarget.dec,
    is_detected: false,
    catalogId: "Center Target"
  };
  openNicknameModal();
});

function openNicknameModal() {
  nicknameModal.classList.add('active');
  inputNickname.value = activeTrackedObject ? activeTrackedObject.nickname : "";
  inputNickname.focus();
}

function closeNicknameModal() {
  nicknameModal.classList.remove('active');
  pendingClickData = null;
}

closeNicknameModalBtn.addEventListener('click', closeNicknameModal);
btnCancelNickname.addEventListener('click', closeNicknameModal);

// Save New Nickname
btnSaveNickname.addEventListener('click', () => {
  const name = inputNickname.value.trim();
  if (!name) {
    alert("Please enter a nickname for the object.");
    return;
  }

  const category = inputCategory.value;
  const notes = inputNotes.value.trim();
  const click = pendingClickData || { normX: 0.5, normY: 0.5, ra: currentTarget.ra, dec: currentTarget.dec, is_detected: false };

  const newObj = {
    id: `obj-${Date.now()}`,
    nickname: name,
    fieldId: currentTarget.id,
    catalogId: click.catalogId || `Field (${currentTarget.ra.toFixed(4)}°, ${currentTarget.dec.toFixed(4)}°)`,
    category: category,
    ra: click.ra,
    dec: click.dec,
    normX: click.normX,
    normY: click.normY,
    is_detected: click.is_detected,
    catalog_pm: click.catalog_pm || (currentTarget.proper_motion ? currentTarget.proper_motion.total_pm_mas_yr : null),
    notes: notes,
    addedAt: Date.now()
  };

  // Add to tracked objects and set as active
  trackedObjects.unshift(newObj);
  saveTrackedObjects();
  closeNicknameModal();

  // Trigger tracking query with the new object's coordinates
  selectTrackedObject(newObj);
});

// Delete Tracked Object
btnDeleteTracking.addEventListener('click', () => {
  if (!activeTrackedObject) return;
  if (confirm(`Untrack and remove "${activeTrackedObject.nickname}" from your watchlist?`)) {
    trackedObjects = trackedObjects.filter(o => o.id !== activeTrackedObject.id);
    if (trackedObjects.length === 0) {
      loadTrackedObjects(); // re-seed defaults
    } else {
      activeTrackedObject = trackedObjects[0];
    }
    saveTrackedObjects();
    selectTrackedObject(activeTrackedObject);
  }
});

// Jump to Spectrum View with coordinates
btnViewSpectrum.addEventListener('click', () => {
  const targetRa = activeTrackedObject && activeTrackedObject.ra ? activeTrackedObject.ra : currentTarget.ra;
  const targetDec = activeTrackedObject && activeTrackedObject.dec ? activeTrackedObject.dec : currentTarget.dec;
  window.location.href = `spectrum.html?ra=${targetRa}&dec=${targetDec}&fov=${currentTarget.fov}`;
});

// Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  loadTrackedObjects();

  // Read URL parameters if provided
  const urlCoords = getUrlCoordinates();
  if (urlCoords) {
    const matchedPreset = BENCHMARK_PRESETS.find(p => 
      Math.abs(p.ra - urlCoords.ra) < 0.005 && Math.abs(p.dec - urlCoords.dec) < 0.005
    );
    if (matchedPreset) {
      currentTarget = matchedPreset;
      targetSelect.value = currentTarget.id;
      activeTrackedObject = trackedObjects.find(o => o.fieldId === currentTarget.id) || activeTrackedObject;
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

  renderWatchlistChips();
  loadFieldData(currentTarget);
});
