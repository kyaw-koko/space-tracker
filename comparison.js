/**
 * SPHEREx — 3×3 Astronomical CCD Star Field Blink & Guide Star Comparison
 * Features:
 * - High-fidelity synthesis of 9 realistic monochrome CCD star field subframes
 * - Epoch A vs Epoch B Blink Comparator with configurable frequency
 * - Astronomical HFD (Half Flux Diameter) and FWHM calculations & overlay rings
 * - Interactive tile inspection & 1D Radial Point Spread Function (PSF) curve plotting
 */

(function () {
  'use strict';

  // ── Configuration & State ──────────────────────────────────────────────────
  const GRID_SIZE = 3;
  const TILE_RES = 300; // Resolution per subframe tile canvas

  const STATE = {
    currentEpoch: 'A',      // 'A' or 'B'
    isBlinking: true,
    blinkRateHz: 1.5,
    showCircles: true,
    scenario: 'seeing',     // 'seeing' | 'dipole' | 'optics' | 'hfd-fwhm'
    selectedRow: 1,         // 0-indexed (row 1 = visual row 2, center)
    selectedCol: 1,         // 0-indexed (col 1 = visual col 2, center)
    gain: 1.0,
    noiseFloor: 40,
    tiles: []               // Stores star models & pre-computed metrics for 9 tiles
  };

  let blinkInterval = null;

  // ── Seeded Random Generator for Deterministic Consistency ──────────────────
  function createRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // ── Astronomical Star Field Generation ──────────────────────────────────────
  function generateMosaicData() {
    STATE.tiles = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const tileSeed = 1000 + r * 137 + c * 359;
        const rng = createRng(tileSeed);

        // Radial distance from center (for optical coma / field curvature)
        const dxFromCenter = (c - 1);
        const dyFromCenter = (r - 1);
        const radialDist = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter);

        // Generate 12 - 25 stars per subframe
        const numStars = Math.floor(rng() * 14) + 12;
        const starsA = [];
        const starsB = [];

        for (let i = 0; i < numStars; i++) {
          const x = 20 + rng() * (TILE_RES - 40);
          const y = 20 + rng() * (TILE_RES - 40);

          // Magnitude distribution: many faint stars, a few bright guide stars
          const isGuideStar = i === 0 || (i === 1 && rng() > 0.5);
          const flux = isGuideStar ? (200 + rng() * 55) : (40 + rng() * 120);

          // Base Point Spread Function (PSF) size in pixels
          const baseSigma = isGuideStar ? 2.4 : 1.8;

          // Epoch A parameters
          const starA = {
            x: x,
            y: y,
            flux: flux,
            sigmaX: baseSigma + radialDist * 0.35,
            sigmaY: baseSigma + (radialDist > 0 ? (radialDist * 0.2) : 0),
            isGuideStar: isGuideStar
          };

          // Epoch B variations depending on scenario
          let starB = { ...starA };

          if (STATE.scenario === 'seeing') {
            // Seeing / defocus bloat: stars expand, peak flux lowers slightly
            starB.sigmaX = starA.sigmaX * 1.65;
            starB.sigmaY = starA.sigmaY * 1.65;
            starB.flux = starA.flux * 0.88;
            // Minor seeing jitter
            starB.x += (rng() - 0.5) * 1.5;
            starB.y += (rng() - 0.5) * 1.5;
          } else if (STATE.scenario === 'dipole') {
            // Proper Motion / Asteroid shift: guide star in tile [1,1] or [2,2] shifts
            if (i === 0 && (r === 1 && c === 1)) {
              starB.x += 12.0; // High proper motion jump!
              starB.y -= 7.0;
            } else if (i === 2 && (r === 0 && c === 2)) {
              // Transient fast-moving solar system object
              starB.x -= 15.0;
              starB.y += 10.0;
            }
          } else if (STATE.scenario === 'optics') {
            // Field curvature: center gets sharper, corners get stronger coma
            if (radialDist > 0) {
              starB.sigmaX = starA.sigmaX * (1.0 + radialDist * 0.5);
              starB.sigmaY = starA.sigmaY * (1.0 + radialDist * 0.8);
            }
          } else if (STATE.scenario === 'hfd-fwhm') {
            // Slight focus breathe to benchmark HFD vs FWHM sensitivity
            starB.sigmaX = starA.sigmaX * 1.25;
            starB.sigmaY = starA.sigmaY * 1.25;
          }

          starsA.push(starA);
          starsB.push(starB);
        }

        STATE.tiles.push({
          row: r,
          col: c,
          radialDist: radialDist,
          starsA: starsA,
          starsB: starsB
        });
      }
    }
  }

  // ── Render Astronomical CCD Frame on Canvas ─────────────────────────────────
  function renderSubframe(ctx, tileData, epoch) {
    const stars = epoch === 'A' ? tileData.starsA : tileData.starsB;
    const width = TILE_RES;
    const height = TILE_RES;

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // 1. Generate realistic sky background with CCD Poisson/Gaussian read noise
    const baseNoise = STATE.noiseFloor;
    const gain = STATE.gain;

    for (let i = 0; i < data.length; i += 4) {
      // Gaussian noise approximation (Box-Muller light)
      const u1 = Math.random() || 0.0001;
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      let noiseVal = (baseNoise + z0 * 14) * gain;
      if (noiseVal < 0) noiseVal = 0;
      if (noiseVal > 255) noiseVal = 255;

      data[i] = noiseVal;     // R
      data[i + 1] = noiseVal; // G
      data[i + 2] = noiseVal; // B
      data[i + 3] = 255;      // A
    }

    // 2. Splat 2D Gaussian/Moffat stellar Point Spread Functions (PSFs)
    stars.forEach(star => {
      const radius = Math.ceil(Math.max(star.sigmaX, star.sigmaY) * 3.8);
      const minX = Math.max(0, Math.floor(star.x - radius));
      const maxX = Math.min(width - 1, Math.ceil(star.x + radius));
      const minY = Math.max(0, Math.floor(star.y - radius));
      const maxY = Math.min(height - 1, Math.ceil(star.y + radius));

      const inv2SigmaX2 = 1.0 / (2.0 * star.sigmaX * star.sigmaX);
      const inv2SigmaY2 = 1.0 / (2.0 * star.sigmaY * star.sigmaY);

      for (let py = minY; py <= maxY; py++) {
        const dy = py - star.y;
        const dy2 = dy * dy;

        for (let px = minX; px <= maxX; px++) {
          const dx = px - star.x;
          const dx2 = dx * dx;

          // 2D elliptical Gaussian intensity
          const exponent = -(dx2 * inv2SigmaX2 + dy2 * inv2SigmaY2);
          if (exponent > -7.0) {
            const intensity = star.flux * Math.exp(exponent) * gain;
            const idx = (py * width + px) * 4;

            // Additive CCD electron accumulation
            const current = data[idx];
            const newVal = Math.min(255, current + intensity);

            data[idx] = newVal;
            data[idx + 1] = newVal;
            data[idx + 2] = newVal;
          }
        }
      }
    });

    ctx.putImageData(imgData, 0, 0);

    // 3. Draw measurement overlays (HFD and FWHM circles) if enabled
    if (STATE.showCircles) {
      stars.forEach(star => {
        if (!star.isGuideStar && star.flux < 90) return; // Only highlight candidate guide stars

        // FWHM = 2 * sqrt(2 * ln(2)) * sigma ≈ 2.355 * sigma
        const fwhmRadius = ((star.sigmaX + star.sigmaY) * 0.5) * 1.177;
        // HFD (Half Flux Diameter radius) ≈ 1.35 * FWHM radius
        const hfdRadius = fwhmRadius * 1.32;

        // FWHM inner circle (Orange)
        ctx.beginPath();
        ctx.arc(star.x, star.y, fwhmRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 145, 0, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // HFD outer circle (Cyan)
        ctx.beginPath();
        ctx.arc(star.x, star.y, hfdRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Guide Star text label
        if (star.isGuideStar) {
          ctx.font = '10px sans-serif';
          ctx.fillStyle = '#00e5ff';
          ctx.fillText(`HFD ${(hfdRadius * 2).toFixed(1)}px`, star.x + hfdRadius + 3, star.y + 3);
        }
      });
    }
  }

  // ── Astronomical Calculations: HFD & FWHM ─────────────────────────────────
  function calculateTileMetrics(tileData, epoch) {
    const stars = epoch === 'A' ? tileData.starsA : tileData.starsB;

    let totalHfd = 0;
    let totalFwhm = 0;
    let validCount = 0;

    stars.forEach(star => {
      const avgSigma = (star.sigmaX + star.sigmaY) * 0.5;
      const fwhmPx = avgSigma * 2.355;
      const hfdPx = fwhmPx * 1.32;

      totalHfd += hfdPx;
      totalFwhm += fwhmPx;
      validCount++;
    });

    const meanHfd = validCount > 0 ? (totalHfd / validCount) : 2.2;
    const meanFwhmPx = validCount > 0 ? (totalFwhm / validCount) : 2.8;
    const pixelScaleArcsec = 1.20;
    const meanFwhmArcsec = meanFwhmPx * pixelScaleArcsec;

    // Seeing assessment
    let seeingStr = 'Optimal';
    let seeingColor = '#00e5ff';
    if (meanFwhmArcsec > 4.0) {
      seeingStr = 'Poor';
      seeingColor = '#ff5252';
    } else if (meanFwhmArcsec > 2.8) {
      seeingStr = 'Moderate';
      seeingColor = '#ff9100';
    }

    // Focus state
    let focusStr = 'Critical Focus';
    let focusColor = '#69f0ae';
    if (meanHfd > 3.8) {
      focusStr = 'Defocused (Needs Focuser Adjustment)';
      focusColor = '#ff5252';
    } else if (meanHfd > 2.8) {
      focusStr = 'Slight Softness';
      focusColor = '#ff9100';
    }

    return {
      hfd: meanHfd.toFixed(2),
      fwhmPx: meanFwhmPx.toFixed(2),
      fwhmArcsec: meanFwhmArcsec.toFixed(2),
      starCount: stars.length,
      seeing: `${meanFwhmArcsec.toFixed(1)}" (${seeingStr})`,
      seeingColor: seeingColor,
      focusState: focusStr,
      focusColor: focusColor,
      snr: (36 + Math.min(20, 100 / meanHfd)).toFixed(1)
    };
  }

  // ── Render 1D Radial Point Spread Function (PSF) Plot ──────────────────────
  function drawPsfPlot(tileData, epoch) {
    const canvas = document.getElementById('psfCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dark grid background
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(111, 140, 184, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 30; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - 20);
      ctx.stroke();
    }
    for (let y = 15; y < h - 20; y += 25) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const stars = epoch === 'A' ? tileData.starsA : tileData.starsB;
    const guideStar = stars.find(s => s.isGuideStar) || stars[0] || { sigmaX: 2.5, sigmaY: 2.5 };
    const sigma = (guideStar.sigmaX + guideStar.sigmaY) * 0.5;

    const fwhmRadius = sigma * 1.177;
    const hfdRadius = fwhmRadius * 1.32;

    const originX = 50;
    const originY = h - 25;
    const scaleX = 22; // Pixels on canvas per radial pixel
    const plotHeight = h - 45;

    // Plot Gaussian curve: I(r) = exp(-r^2 / (2 * sigma^2))
    ctx.beginPath();
    ctx.strokeStyle = '#eef3fc';
    ctx.lineWidth = 2;

    for (let px = 0; px <= (w - originX); px++) {
      const r = px / scaleX;
      const intensity = Math.exp(-(r * r) / (2 * sigma * sigma));
      const py = originY - intensity * plotHeight;

      if (px === 0) ctx.moveTo(originX + px, py);
      else ctx.lineTo(originX + px, py);
    }
    ctx.stroke();

    // Mark FWHM line at Intensity = 0.5
    const halfMaxY = originY - 0.5 * plotHeight;
    ctx.strokeStyle = '#ff9100';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    // Horizontal line at 50% max
    ctx.beginPath();
    ctx.moveTo(originX, halfMaxY);
    ctx.lineTo(originX + fwhmRadius * scaleX, halfMaxY);
    ctx.stroke();

    // Vertical line down at FWHM radius
    ctx.beginPath();
    ctx.moveTo(originX + fwhmRadius * scaleX, halfMaxY);
    ctx.lineTo(originX + fwhmRadius * scaleX, originY);
    ctx.stroke();

    // Mark HFD vertical line at HFD radius (Cyan)
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(originX + hfdRadius * scaleX, originY - 0.7 * plotHeight);
    ctx.lineTo(originX + hfdRadius * scaleX, originY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes & Axis Labels
    ctx.strokeStyle = 'rgba(111, 140, 184, 0.4)';
    ctx.beginPath();
    ctx.moveTo(originX, 10);
    ctx.lineTo(originX, originY);
    ctx.lineTo(w - 10, originY);
    ctx.stroke();

    ctx.fillStyle = '#9ab0cf';
    ctx.font = '9px sans-serif';
    ctx.fillText('0', originX - 10, originY + 4);
    ctx.fillText('2 px', originX + 2 * scaleX - 10, originY + 14);
    ctx.fillText('4 px', originX + 4 * scaleX - 10, originY + 14);
    ctx.fillText('6 px', originX + 6 * scaleX - 10, originY + 14);
    ctx.fillText('Max', 10, 20);
    ctx.fillText('50%', 10, halfMaxY + 3);
  }

  // ── DOM Initialization & Event Wiring ──────────────────────────────────────
  function initMosaicUI() {
    const mosaicContainer = document.getElementById('starfieldMosaic');
    if (!mosaicContainer) return;

    mosaicContainer.innerHTML = '';

    STATE.tiles.forEach(tile => {
      const tileDiv = document.createElement('div');
      tileDiv.className = `mosaic-tile ${tile.row === STATE.selectedRow && tile.col === STATE.selectedCol ? 'selected' : ''}`;
      tileDiv.dataset.row = tile.row;
      tileDiv.dataset.col = tile.col;

      const canvas = document.createElement('canvas');
      canvas.width = TILE_RES;
      canvas.height = TILE_RES;
      canvas.className = 'tile-canvas';

      const coordBadge = document.createElement('div');
      coordBadge.className = 'tile-coord-badge';
      coordBadge.textContent = `[${tile.row + 1}, ${tile.col + 1}]`;

      const hfdBadge = document.createElement('div');
      hfdBadge.className = 'tile-hfd-badge';
      hfdBadge.id = `badge-${tile.row}-${tile.col}`;
      hfdBadge.textContent = 'HFD --';

      tileDiv.appendChild(canvas);
      tileDiv.appendChild(coordBadge);
      tileDiv.appendChild(hfdBadge);

      tileDiv.addEventListener('click', () => {
        document.querySelectorAll('.mosaic-tile').forEach(t => t.classList.remove('selected'));
        tileDiv.classList.add('selected');
        STATE.selectedRow = tile.row;
        STATE.selectedCol = tile.col;
        updateSelectedTileSidebar();
      });

      mosaicContainer.appendChild(tileDiv);
    });

    renderAllTiles();
    updateSelectedTileSidebar();
  }

  function renderAllTiles() {
    STATE.tiles.forEach(tile => {
      const tileDiv = document.querySelector(`.mosaic-tile[data-row="${tile.row}"][data-col="${tile.col}"]`);
      if (!tileDiv) return;

      const canvas = tileDiv.querySelector('.tile-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      renderSubframe(ctx, tile, STATE.currentEpoch);

      // Update tile corner metric badge
      const metrics = calculateTileMetrics(tile, STATE.currentEpoch);
      const badge = tileDiv.querySelector('.tile-hfd-badge');
      if (badge) {
        badge.textContent = `HFD ${metrics.hfd}px`;
      }
    });

    // Update epoch badge in frame top-right
    const epochBadge = document.getElementById('epochBadge');
    if (epochBadge) {
      epochBadge.textContent = `FRAME: EPOCH ${STATE.currentEpoch}`;
      if (STATE.currentEpoch === 'B') {
        epochBadge.classList.add('blink-epoch-b');
      } else {
        epochBadge.classList.remove('blink-epoch-b');
      }
    }

    updateSelectedTileSidebar();
  }

  function updateSelectedTileSidebar() {
    const tile = STATE.tiles.find(t => t.row === STATE.selectedRow && t.col === STATE.selectedCol);
    if (!tile) return;

    const metrics = calculateTileMetrics(tile, STATE.currentEpoch);

    // Update Titles
    const tileTitle = document.getElementById('tileTitle');
    const tileDesc = document.getElementById('tileDescription');

    const isCenter = tile.row === 1 && tile.col === 1;
    const isCorner = (tile.row === 0 || tile.row === 2) && (tile.col === 0 || tile.col === 2);

    if (tileTitle) {
      const zoneName = isCenter ? 'Optical Axis Center' : (isCorner ? 'Outer Field Corner' : 'Edge Sensor');
      tileTitle.innerHTML = `<strong>Tile [${tile.row + 1}, ${tile.col + 1}]</strong> (${zoneName})`;
    }

    if (tileDesc) {
      if (isCenter) {
        tileDesc.textContent = 'Central bore-sight sensor subframe. High optical sharpness with minimal coma/distortion. Guide star profiles are circular with optimal Half Flux Diameter (HFD).';
      } else if (isCorner) {
        tileDesc.textContent = 'Outer field corner subframe. Exhibits slight geometric coma and field curvature. Essential for evaluating full-frame focal plane uniformity.';
      } else {
        tileDesc.textContent = 'Mid-field perimeter subframe. Good signal-to-noise ratio and clean guide star centroids suitable for tracking.';
      }
    }

    // Telemetry fields
    document.getElementById('valHFD').textContent = `${metrics.hfd} px`;
    document.getElementById('valFWHM').textContent = `${metrics.fwhmPx} px (${metrics.fwhmArcsec}")`;
    document.getElementById('valStarCount').textContent = `${metrics.starCount} detected`;
    document.getElementById('valSNR').textContent = `${metrics.snr} dB`;

    const seeingEl = document.getElementById('valSeeing');
    if (seeingEl) {
      seeingEl.textContent = metrics.seeing;
      seeingEl.style.color = metrics.seeingColor;
    }

    const focusEl = document.getElementById('valFocusState');
    if (focusEl) {
      focusEl.textContent = metrics.focusState;
      focusEl.style.color = metrics.focusColor;
    }

    // Draw PSF 1D curve
    drawPsfPlot(tile, STATE.currentEpoch);
  }

  // ── Blinker Engine ──────────────────────────────────────────────────────────
  function startBlinker() {
    stopBlinker();
    const intervalMs = 1000 / STATE.blinkRateHz;
    blinkInterval = setInterval(() => {
      STATE.currentEpoch = STATE.currentEpoch === 'A' ? 'B' : 'A';
      renderAllTiles();
    }, intervalMs);
  }

  function stopBlinker() {
    if (blinkInterval) {
      clearInterval(blinkInterval);
      blinkInterval = null;
    }
  }

  // ── Event Handlers ──────────────────────────────────────────────────────────
  function attachEventHandlers() {
    // Play / Pause Blink
    const btnPlayBlink = document.getElementById('btnPlayBlink');
    if (btnPlayBlink) {
      btnPlayBlink.addEventListener('click', () => {
        STATE.isBlinking = !STATE.isBlinking;
        const icon = document.getElementById('blinkIcon');
        const text = document.getElementById('blinkBtnText');

        if (STATE.isBlinking) {
          btnPlayBlink.classList.add('active');
          if (icon) icon.textContent = '❚❚';
          if (text) text.textContent = 'Blink Animation (ON)';
          startBlinker();
        } else {
          btnPlayBlink.classList.remove('active');
          if (icon) icon.textContent = '▷';
          if (text) text.textContent = 'Blink Animation (OFF)';
          stopBlinker();
        }
      });
    }

    // Manual Toggle Epoch
    const btnToggleEpoch = document.getElementById('btnToggleEpoch');
    if (btnToggleEpoch) {
      btnToggleEpoch.addEventListener('click', () => {
        STATE.currentEpoch = STATE.currentEpoch === 'A' ? 'B' : 'A';
        const epochBtnText = document.getElementById('epochBtnText');
        if (epochBtnText) {
          epochBtnText.textContent = STATE.currentEpoch === 'A' ? 'Switch to Epoch B' : 'Switch to Epoch A';
        }
        renderAllTiles();
      });
    }

    // Toggle Star Circles (HFD & FWHM)
    const btnToggleCircles = document.getElementById('btnToggleCircles');
    if (btnToggleCircles) {
      btnToggleCircles.addEventListener('click', () => {
        STATE.showCircles = !STATE.showCircles;
        const circleText = document.getElementById('circleBtnText');
        if (STATE.showCircles) {
          btnToggleCircles.classList.add('active');
          if (circleText) circleText.textContent = 'Star Circles: ON';
        } else {
          btnToggleCircles.classList.remove('active');
          if (circleText) circleText.textContent = 'Star Circles: OFF';
        }
        renderAllTiles();
      });
    }

    // Scenario Select
    const scenarioSelect = document.getElementById('scenarioSelect');
    if (scenarioSelect) {
      scenarioSelect.addEventListener('change', (e) => {
        STATE.scenario = e.target.value;
        generateMosaicData();
        renderAllTiles();
      });
    }

    // Blink Speed Slider
    const blinkSpeedSlider = document.getElementById('blinkSpeedSlider');
    const blinkSpeedDisplay = document.getElementById('blinkSpeedDisplay');
    if (blinkSpeedSlider && blinkSpeedDisplay) {
      blinkSpeedSlider.addEventListener('input', (e) => {
        STATE.blinkRateHz = parseFloat(e.target.value);
        const period = (1.0 / STATE.blinkRateHz).toFixed(2);
        blinkSpeedDisplay.textContent = `${STATE.blinkRateHz.toFixed(1)} Hz (${period}s / frame)`;
        if (STATE.isBlinking) {
          startBlinker();
        }
      });
    }

    // Gain Slider
    const gainSlider = document.getElementById('gainSlider');
    const gainDisplay = document.getElementById('gainDisplay');
    if (gainSlider && gainDisplay) {
      gainSlider.addEventListener('input', (e) => {
        STATE.gain = parseFloat(e.target.value);
        gainDisplay.textContent = `${STATE.gain.toFixed(1)}×`;
        renderAllTiles();
      });
    }

    // Noise Slider
    const noiseSlider = document.getElementById('noiseSlider');
    const noiseDisplay = document.getElementById('noiseDisplay');
    if (noiseSlider && noiseDisplay) {
      noiseSlider.addEventListener('input', (e) => {
        STATE.noiseFloor = parseInt(e.target.value, 10);
        noiseDisplay.textContent = `${STATE.noiseFloor}%`;
        renderAllTiles();
      });
    }
  }

  // ── Document Ready ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    generateMosaicData();
    initMosaicUI();
    attachEventHandlers();
    startBlinker();
  });

})();
