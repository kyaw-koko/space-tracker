/**
 * ============================================================================
 * SPHEREx Real-World Multi-Mission Astrometry & Vector Field (Gaia & AllWISE)
 * ============================================================================
 * Fetches real Gaia DR3 & AllWISE source cross-matching directly from IRSA TAP
 * and Astropy WCS coordinate transformations, rendering catalog-predicted
 * proper-motion vectors overlaid on real SPHEREx FITS coadds.
 */

let currentTarget = BENCHMARK_PRESETS[1]; // Barnard's Star (benchmark proper motion)
let gaiaSources = [];
let allwiseSources = [];
let showGaia = true;
let showAllwise = true;
let showVectors = true;
let baselineYears = 10;
let baseImage = null;
let hoveredSource = null;
let activeCatalogAbortController = null;

// DOM Elements
const canvas = document.getElementById('vectorCanvas');
const ctx = canvas.getContext('2d');
const toggleGaiaBtn = document.getElementById('toggleGaiaBtn');
const toggleAllwiseBtn = document.getElementById('toggleAllwiseBtn');
const toggleVectorsBtn = document.getElementById('toggleVectorsBtn');
const baselineSlider = document.getElementById('baselineSlider');
const baselineDisplay = document.getElementById('baselineDisplay');
const targetSelect = document.getElementById('targetSelect');
const loaderOverlay = document.getElementById('loaderOverlay');
const loaderText = document.getElementById('loaderText');

// Card Elements
const coordsBadge = document.getElementById('coordsBadge');
const countsBadge = document.getElementById('countsBadge');
const valGaiaCount = document.getElementById('valGaiaCount');
const valAllwiseCount = document.getElementById('valAllwiseCount');
const valMaxPM = document.getElementById('valMaxPM');
const insDesignation = document.getElementById('insDesignation');
const insDetails = document.getElementById('insDetails');
const inspectorBox = document.getElementById('inspectorBox');

/**
 * Fetch real catalog data from backend (/api/sky-patch?include_catalogs=true)
 */
async function loadRealCatalogData(target) {
  // Abort any redundant in-flight catalog query
  if (activeCatalogAbortController) {
    activeCatalogAbortController.abort();
  }
  activeCatalogAbortController = new AbortController();
  const currentSignal = activeCatalogAbortController.signal;

  showLoader(true, `Querying IRSA TAP for Gaia DR3 & AllWISE sources around ${target.name || 'target'}...`);
  gaiaSources = [];
  allwiseSources = [];
  baseImage = null;
  hoveredSource = null;

  // Sync coordinates to URL
  setUrlCoordinates(target.ra, target.dec, target.fov, target.id);
  updateNavLinks();

  try {
    const url = `${API_BASE}/api/sky-patch?ra=${target.ra}&dec=${target.dec}&fov=${target.fov}&mode=coadd&include_catalogs=true&max_frames=6`;
    const res = await fetch(url, { signal: currentSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const json = await res.json();

    if (json.status === 'success' && json.catalog_overlay) {
      gaiaSources = json.catalog_overlay.gaia_sources || [];
      allwiseSources = json.catalog_overlay.allwise_sources || [];

      // Load master coadd FITS frame
      if (json.data && json.data.overall_coadd && json.data.overall_coadd.data_url) {
        await new Promise(resolve => {
          const img = new Image();
          img.onload = () => { baseImage = img; resolve(); };
          img.onerror = () => resolve();
          img.src = json.data.overall_coadd.data_url;
        });
      }
    } else if (json.status === 'no_data') {
      renderNoData(target, json.message);
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Catalog fetch error:", err);
    renderError(err.message);
  } finally {
    if (!currentSignal.aborted) {
      showLoader(false);
      updateBadges();
      render();
    }
  }
}

function showLoader(show, text = "") {
  if (loaderOverlay) {
    loaderOverlay.classList.toggle('active', show);
    if (text) loaderText.textContent = text;
  }
}

function updateBadges() {
  coordsBadge.textContent = `RA ${currentTarget.ra.toFixed(4)}° • DEC ${currentTarget.dec.toFixed(4)}° (ICRS / TAN WCS)`;
  countsBadge.textContent = `GAIA: ${gaiaSources.length} • ALLWISE: ${allwiseSources.length}`;
  valGaiaCount.textContent = gaiaSources.length;
  valAllwiseCount.textContent = allwiseSources.length;

  const validPMs = [
    ...gaiaSources.filter(s => s.pm_total_mas_yr !== null && s.pm_total_mas_yr !== undefined).map(s => s.pm_total_mas_yr),
    ...allwiseSources.filter(s => s.pm_total_mas_yr !== null && s.pm_total_mas_yr !== undefined).map(s => s.pm_total_mas_yr)
  ];

  const maxPM = validPMs.length > 0 ? Math.max(...validPMs) : 0;
  valMaxPM.textContent = maxPM > 0 ? `${maxPM.toFixed(1)} mas/yr` : "—";
}

/**
 * Main Render Loop
 */
function render() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 1. Draw Real Calibrated FITS Coadd Background
  if (baseImage) {
    ctx.drawImage(baseImage, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#06070a";
    ctx.fillRect(0, 0, w, h);
  }

  const scaleFactor = baselineYears / 10.0;

  // 2. Draw Real AllWISE Infrared Sources (Orange Diamonds)
  if (showAllwise) {
    allwiseSources.forEach(src => {
      const cx = src.norm_x * w;
      const cy = src.norm_y_canvas * h;
      const w1 = (src.w1_mag !== null && src.w1_mag !== undefined) ? src.w1_mag : 12;
      const size = Math.max(3.5, 9 - (w1 - 8) * 0.7);

      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size, cy);
      ctx.closePath();
      ctx.strokeStyle = "rgba(255, 145, 0, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (src === hoveredSource) {
        ctx.fillStyle = "rgba(255, 145, 0, 0.35)";
        ctx.fill();
      }
    });
  }

  // 3. Draw Real Gaia DR3 Optical Sources (Cyan Circles)
  if (showGaia) {
    gaiaSources.forEach(src => {
      const cx = src.norm_x * w;
      const cy = src.norm_y_canvas * h;
      const gMag = (src.mag_g !== null && src.mag_g !== undefined) ? src.mag_g : 14;
      const r = Math.max(3, 8 - (gMag - 10) * 0.6);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (src === hoveredSource) {
        ctx.fillStyle = "rgba(0, 229, 255, 0.35)";
        ctx.fill();
      }
    });
  }

  // 4. Draw Real Proper-Motion Vector Arrows
  if (showVectors) {
    const all = [...(showGaia ? gaiaSources : []), ...(showAllwise ? allwiseSources : [])];
    all.forEach(src => {
      if (src.delta_norm_x === null || src.delta_norm_y === null || 
          src.delta_norm_x === undefined || src.delta_norm_y === undefined) return;

      const x1 = src.norm_x * w;
      const y1 = src.norm_y_canvas * h;
      const dx = src.delta_norm_x * w * scaleFactor;
      const dy = src.delta_norm_y * h * scaleFactor;

      if (Math.hypot(dx, dy) < 2) return;

      const x2 = x1 + dx;
      const y2 = y1 + dy;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
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
    });
  }

  drawWCSCompass(ctx, w - 48, h - 48, 28);
}

// Hover Inspection
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  const all = [...(showGaia ? gaiaSources : []), ...(showAllwise ? allwiseSources : [])];
  let closest = null;
  let minDist = 22;

  all.forEach(src => {
    const sx = src.norm_x * canvas.width;
    const sy = src.norm_y_canvas * canvas.height;
    const d = Math.hypot(mouseX - sx, mouseY - sy);
    if (d < minDist) {
      minDist = d;
      closest = src;
    }
  });

  if (closest !== hoveredSource) {
    hoveredSource = closest;
    render();

    if (closest) {
      inspectorBox.classList.add('active');
      const dotColor = closest.catalog === 'Gaia DR3' ? '#00e5ff' : '#ff9100';
      insDesignation.innerHTML = `<span style="color:${dotColor}">●</span> ${escapeHTML(closest.designation || 'Catalog Source')}`;
      
      const pmText = (closest.pm_total_mas_yr !== null && closest.pm_total_mas_yr !== undefined) ? 
        `${closest.pm_total_mas_yr.toFixed(1)} mas/yr (Catalog Predicted)` : `Not Measured / Negligible`;

      const gMagText = (closest.mag_g !== null && closest.mag_g !== undefined) ? 
        `<div class="inspector-stat">G Mag: ${closest.mag_g.toFixed(2)}</div>` : '';
      const w1MagText = (closest.w1_mag !== null && closest.w1_mag !== undefined) ? 
        `<div class="inspector-stat">W1 Mag: ${closest.w1_mag.toFixed(2)}</div>` : '';
      const plxText = (closest.parallax_mas !== null && closest.parallax_mas !== undefined) ? 
        `<div class="inspector-stat">Parallax: ${closest.parallax_mas.toFixed(2)} mas</div>` : '';

      insDetails.innerHTML = `
        <div class="inspector-stat">Catalog: ${escapeHTML(closest.catalog || 'Astrometric')}</div>
        <div class="inspector-stat">PM: ${pmText}</div>
        ${gMagText}
        ${w1MagText}
        ${plxText}
        <div class="inspector-stat">Coords: RA ${closest.ra.toFixed(5)}°, Dec ${closest.dec.toFixed(5)}°</div>
      `;
    } else {
      inspectorBox.classList.remove('active');
      insDesignation.textContent = "Hover over any star marker...";
      insDetails.textContent = "Hover over cyan circles (Gaia DR3) or orange diamonds (AllWISE) to inspect astrometry.";
    }
  }
});

function renderNoData(target, msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px 'Playfair Display', Georgia, serif";
  ctx.fillStyle = "#ff9100";
  ctx.fillText("No FITS Cutouts in IRSA Archive for this Sky Region", 60, canvas.height / 2 - 10);
  ctx.font = "13px 'Inter', sans-serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 15);
}

function renderError(msg) {
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px 'Playfair Display', Georgia, serif";
  ctx.fillStyle = "#ff5252";
  ctx.fillText("Pipeline Error: Failed to Cross-Match Catalogs", 60, canvas.height / 2 - 10);
  ctx.font = "13px 'Inter', sans-serif";
  ctx.fillStyle = "#9ab0cf";
  ctx.fillText(msg, 60, canvas.height / 2 + 15);
}

// UI Controls
toggleGaiaBtn.addEventListener('click', () => {
  showGaia = !showGaia;
  toggleGaiaBtn.classList.toggle('active', showGaia);
  render();
});

toggleAllwiseBtn.addEventListener('click', () => {
  showAllwise = !showAllwise;
  toggleAllwiseBtn.classList.toggle('active', showAllwise);
  render();
});

toggleVectorsBtn.addEventListener('click', () => {
  showVectors = !showVectors;
  toggleVectorsBtn.classList.toggle('active', showVectors);
  render();
});

baselineSlider.addEventListener('input', (e) => {
  baselineYears = parseInt(e.target.value, 10);
  baselineDisplay.textContent = `${baselineYears} Years Extrapolation`;
  render();
});

targetSelect.addEventListener('change', (e) => {
  const chosen = BENCHMARK_PRESETS.find(p => p.id === e.target.value) || BENCHMARK_PRESETS[1];
  currentTarget = chosen;
  loadRealCatalogData(currentTarget);
});

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

  loadRealCatalogData(currentTarget);
});
