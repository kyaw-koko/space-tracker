/**
 * SPHEREx Sky Navigator & Benchmark Presets Controller
 * Renders an all-sky celestial projection and connects benchmark targets to visualization pipelines.
 */

let targets = [...BENCHMARK_PRESETS];
let activeTarget = targets[0]; // WISE 0855 Brown Dwarf
let hoveredTarget = null;

const canvas = document.getElementById('skyMapCanvas');
const ctx = canvas.getContext('2d');
const cardsGrid = document.getElementById('benchmarkCardsGrid');
const loaderOverlay = document.getElementById('loaderOverlay');

// Card elements
const selName = document.getElementById('selName');
const selType = document.getElementById('selType');
const selDesc = document.getElementById('selDesc');
const valRA = document.getElementById('valRA');
const valDec = document.getElementById('valDec');
const valPM = document.getElementById('valPM');
const valBand = document.getElementById('valBand');

// Quick Action Launch Buttons
const launchBlinkerBtn = document.getElementById('launchBlinkerBtn');
const launchVectorsBtn = document.getElementById('launchVectorsBtn');
const launchDiffBtn = document.getElementById('launchDiffBtn');
const launchSpectrumBtn = document.getElementById('launchSpectrumBtn');

/**
 * Fetch Preset Targets from FastAPI Backend (/api/targets/presets)
 */
async function loadPresets() {
  try {
    const res = await fetch(`${API_BASE}/api/targets/presets`);
    if (res.ok) {
      const json = await res.json();
      if (json.targets && json.targets.length > 0) {
        // Merge backend data with local preset metadata
        targets = json.targets.map(bt => {
          const local = BENCHMARK_PRESETS.find(p => p.id === bt.id) || {};
          return {
            ...local,
            ...bt,
            pm: bt.proper_motion ? `${bt.proper_motion.total_pm_mas_yr.toFixed(1)} mas/yr` : local.pm
          };
        });
      }
    }
  } catch (err) {
    console.warn("Using local benchmark target presets:", err.message);
  } finally {
    renderCards();
    updateCardSelection();
    renderSkyMap();
  }
}

function renderCards() {
  cardsGrid.innerHTML = '';
  targets.forEach(t => {
    const card = document.createElement('div');
    card.className = `bench-card ${t.id === activeTarget.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="bench-name">${t.name}</div>
      <div class="bench-type">${t.target_type || t.type}</div>
      <div class="bench-band">${t.optimal_detector || t.detector} • ${t.pm || ''}</div>
    `;
    card.addEventListener('click', () => {
      selectTarget(t);
    });
    cardsGrid.appendChild(card);
  });
}

function selectTarget(t) {
  activeTarget = t;
  setUrlCoordinates(activeTarget.ra, activeTarget.dec, activeTarget.recommended_fov || 0.05, activeTarget.id);
  updateNavLinks();
  renderCards();
  updateCardSelection();
  renderSkyMap();
}

function updateCardSelection() {
  selName.textContent = activeTarget.name;
  selType.textContent = activeTarget.target_type || activeTarget.type;
  selDesc.textContent = activeTarget.description;
  valRA.textContent = `${activeTarget.ra.toFixed(4)}°`;
  valDec.textContent = `${activeTarget.dec.toFixed(4)}°`;
  valPM.textContent = activeTarget.pm || "10,393 mas/yr";
  valBand.textContent = activeTarget.optimal_detector || activeTarget.detector;
}

/**
 * Coordinate mapping from celestial (RA deg 0-360, Dec deg -90 to +90)
 * to Equirectangular / Cylindrical canvas projection
 */
function skyToCanvas(ra, dec, w, h) {
  const margin = 40;
  const pw = w - margin * 2;
  const ph = h - margin * 2;

  // RA 0 -> 360 mapped left to right (or reversed for East-Left)
  const x = margin + ((360 - ra) / 360.0) * pw;
  // Dec +90 (North) -> -90 (South) mapped top to bottom
  const y = margin + ((90 - dec) / 180.0) * ph;
  return { x, y };
}

function canvasToSky(x, y, w, h) {
  const margin = 40;
  const pw = w - margin * 2;
  const ph = h - margin * 2;

  const ra = 360 - ((x - margin) / pw) * 360.0;
  const dec = 90 - ((y - margin) / ph) * 180.0;
  return { ra, dec };
}

/**
 * Render All-Sky Map
 */
function renderSkyMap() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background Cosmic Void
  const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.6);
  bgGrad.addColorStop(0, '#0a0e1a');
  bgGrad.addColorStop(0.6, '#04060a');
  bgGrad.addColorStop(1, '#020305');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Celestial Grid (Equator & Meridian Lines)
  ctx.strokeStyle = "rgba(111, 140, 184, 0.18)";
  ctx.lineWidth = 1;

  // RA grid lines (every 60 deg = 4 hours)
  for (let ra = 0; ra <= 360; ra += 60) {
    const pt1 = skyToCanvas(ra, 90, w, h);
    const pt2 = skyToCanvas(ra, -90, w, h);
    ctx.beginPath();
    ctx.moveTo(pt1.x, pt1.y);
    ctx.lineTo(pt2.x, pt2.y);
    ctx.stroke();

    ctx.font = "10px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(154, 176, 207, 0.5)";
    ctx.fillText(`${ra}°`, pt2.x - 8, h - 18);
  }

  // Dec grid lines (every 30 deg)
  for (let dec = -60; dec <= 60; dec += 30) {
    const pt1 = skyToCanvas(0, dec, w, h);
    const pt2 = skyToCanvas(360, dec, w, h);
    ctx.beginPath();
    ctx.moveTo(pt1.x, pt1.y);
    ctx.lineTo(pt2.x, pt2.y);
    ctx.stroke();

    ctx.font = "10px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(154, 176, 207, 0.5)";
    ctx.fillText(`${dec > 0 ? '+' : ''}${dec}°`, 12, pt1.y + 3);
  }

  // Celestial Equator (Dec = 0) highlighted
  const eq1 = skyToCanvas(0, 0, w, h);
  const eq2 = skyToCanvas(360, 0, w, h);
  ctx.strokeStyle = "rgba(0, 229, 255, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(eq1.x, eq1.y);
  ctx.lineTo(eq2.x, eq2.y);
  ctx.stroke();

  // Draw Galactic Plane Curve
  ctx.strokeStyle = "rgba(255, 145, 0, 0.4)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let r = 0; r <= 360; r += 5) {
    // Approximate sinusoidal galactic equator curve in equatorial coords
    const d = 60 * Math.sin((r - 280) * (Math.PI / 180));
    const pt = skyToCanvas(r, d, w, h);
    if (r === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "11px 'Inter', sans-serif";
  ctx.fillStyle = "rgba(255, 145, 0, 0.7)";
  ctx.fillText("Galactic Plane", w - 130, h - 50);

  // Plot Benchmark Targets
  targets.forEach(t => {
    const pt = skyToCanvas(t.ra, t.dec, w, h);
    const isActive = t.id === activeTarget.id;
    const isHovered = t === hoveredTarget;

    // Glowing halo for active target
    if (isActive) {
      const halo = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, 28);
      halo.addColorStop(0, "rgba(0, 229, 255, 0.8)");
      halo.addColorStop(0.5, "rgba(0, 229, 255, 0.2)");
      halo.addColorStop(1, "rgba(0, 229, 255, 0.0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 28, 0, Math.PI * 2);
      ctx.fill();
    }

    // Target node
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isActive ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? "#ffffff" : (isHovered ? "#00e5ff" : "rgba(200, 220, 255, 0.85)");
    ctx.fill();

    ctx.strokeStyle = isActive ? "#00e5ff" : "#6f8cb8";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Target Label
    ctx.font = `${isActive ? 'bold 13px' : '11px'} 'Playfair Display', Georgia, serif`;
    ctx.fillStyle = isActive ? "#ffffff" : "rgba(230, 235, 245, 0.85)";
    ctx.fillText(t.name, pt.x + 10, pt.y - 8);
  });
}

// Mouse Interactivity on Sky Map
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  let closest = null;
  let minDist = 25;

  targets.forEach(t => {
    const pt = skyToCanvas(t.ra, t.dec, canvas.width, canvas.height);
    const d = Math.hypot(mx - pt.x, my - pt.y);
    if (d < minDist) {
      minDist = d;
      closest = t;
    }
  });

  if (closest !== hoveredTarget) {
    hoveredTarget = closest;
    canvas.style.cursor = closest ? 'pointer' : 'default';
    renderSkyMap();
  }
});

canvas.addEventListener('click', () => {
  if (hoveredTarget) {
    selectTarget(hoveredTarget);
  }
});

// Launch Button Navigations (Seamlessly passing active target to other pages!)
launchBlinkerBtn.addEventListener('click', () => {
  const fov = activeTarget.recommended_fov || 0.05;
  window.location.href = `explore.html?ra=${activeTarget.ra}&dec=${activeTarget.dec}&fov=${fov}&target=${encodeURIComponent(activeTarget.id)}`;
});

launchVectorsBtn.addEventListener('click', () => {
  const fov = activeTarget.recommended_fov || 0.05;
  window.location.href = `catalog.html?ra=${activeTarget.ra}&dec=${activeTarget.dec}&fov=${fov}&target=${encodeURIComponent(activeTarget.id)}`;
});

launchDiffBtn.addEventListener('click', () => {
  const fov = activeTarget.recommended_fov || 0.05;
  window.location.href = `diff.html?ra=${activeTarget.ra}&dec=${activeTarget.dec}&fov=${fov}&target=${encodeURIComponent(activeTarget.id)}`;
});

launchSpectrumBtn.addEventListener('click', () => {
  const fov = activeTarget.recommended_fov || 0.05;
  window.location.href = `spectrum.html?ra=${activeTarget.ra}&dec=${activeTarget.dec}&fov=${fov}&target=${encodeURIComponent(activeTarget.id)}`;
});

document.addEventListener('DOMContentLoaded', () => {
  const urlCoords = getUrlCoordinates();
  if (urlCoords) {
    const matched = BENCHMARK_PRESETS.find(p => 
      Math.abs(p.ra - urlCoords.ra) < 0.005 && Math.abs(p.dec - urlCoords.dec) < 0.005
    );
    if (matched) {
      activeTarget = matched;
    }
  }
  loadPresets();
});
