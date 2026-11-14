/**
 * ============================================================================
 * SPHEREx & Planet X — Shared Client Configuration & Utilities
 * ============================================================================
 * Connects directly to the FastAPI backend querying live Caltech/IPAC IRSA TAP
 * services and Astropy data processing pipelines.
 */

// API Base URL: local frontend servers use the backend on port 8000; production can use an explicit override or same-origin proxy.
const API_BASE = (function() {
  if (typeof window !== 'undefined' && window.SPHEREX_API_BASE) {
    return window.SPHEREX_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
    const port = window.location.port ? `:${window.location.port}` : '';
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return `${window.location.protocol}//${window.location.hostname}${isLocalHost ? ':8000' : port}`;
  }
  return 'http://127.0.0.1:8000';
})();

// Official Benchmark Targets with verified SPHEREx & IRSA coverage
const BENCHMARK_PRESETS = [
  {
    id: "wise-0855",
    name: "WISE 0855-0714",
    name_mm: "ဝုဒ်ဆ် ၀၈၅၅-၀၇၁၄",
    type: "Coldest Sub-stellar Brown Dwarf",
    type_mm: "ကြယ်မဖြစ်နိုင်သော အအေးဆုံး ညိုဝါကြယ်ပု",
    ra: 133.795129,
    dec: -7.245147,
    fov: 0.04,
    detector: "SPHEREx-D6",
    description: "Fourth closest system to the Sun. Sub-zero Celsius temperature (250 K), prominent in SPHEREx Band 5 & 6.",
    description_mm: "နေအဖွဲ့အစည်းနှင့် စတုတ္ထမြောက်အနီးဆုံး ဖြစ်ပြီး အပူချိန် အနုတ် ၂၀ ဒီဂရီစင်တီဂရိတ်အောက်ရှိကာ SPHEREx Band 5 & 6 တွင် ထင်ရှားစွာ မြင်တွေ့ရသည်။",
    pm: "8,150 mas/yr"
  },
  {
    id: "barnards-star",
    name: "Barnard's Star",
    name_mm: "ဘာနတ်၏ ကြယ်",
    type: "High Proper-Motion Star",
    type_mm: "ရွေ့လျားနှုန်းအလွန်မြင့်မားသောကြယ်",
    ra: 269.452075,
    dec: 4.693391,
    fov: 0.05,
    detector: "SPHEREx-D1",
    description: "Highest known proper-motion star (10.3 arcsec/yr). Superb for verifying epoch difference dipoles and blinking.",
    description_mm: "ကောင်းကင်တွင် ရွေ့လျားမှုအလျင်မြန်ဆုံးကြယ် (တစ်နှစ်လျှင် ၁၀.၃ အာခ်စက္ကန့်)။ အချိန်ကွာခြားမှု ဒိုင်ပိုးနှင့် မှိတ်တုတ်လှုပ်ရှားမှုကို စစ်ဆေးရန် အကောင်းဆုံးဖြစ်သည်။",
    pm: "10,393 mas/yr"
  },
  {
    id: "eps-indi-b",
    name: "Epsilon Indi B",
    name_mm: "အက်ပစီလွန် အင်ဒီ ဘီ",
    type: "Binary Brown Dwarf Pair",
    type_mm: "အမြွှာ ညိုဝါကြယ်ပုစနစ်",
    ra: 331.068125,
    dec: -56.782806,
    fov: 0.05,
    detector: "SPHEREx-D3",
    description: "Benchmark T1+T6 brown dwarf binary pair at 3.6 pc with deep water and methane absorption bands across 1-5 um.",
    description_mm: "ရေငွေ့နှင့် မီသိန်းစုပ်ယူမှုလှိုင်းများ အထင်အရှားပါဝင်သည့် ညိုဝါကြယ်ပုအမြွှာစုံတွဲ။",
    pm: "4,705 mas/yr"
  },
  {
    id: "rw-aurigae",
    name: "RW Aurigae",
    name_mm: "အာရ်ဒဗလျူ အိုရီဂေး",
    type: "T Tauri Variable Star",
    type_mm: "တီတောရီ မတည်ငြိမ်ကြယ်ငယ်",
    ra: 76.956542,
    dec: 30.401417,
    fov: 0.05,
    detector: "SPHEREx-D2",
    description: "Young eruptive variable star system surrounded by a circumstellar dust disk undergoing periodic dimming events.",
    description_mm: "ဖုန်မှုန့်ချပ်ဝိုင်းရံထားသော မွေးကင်းစကြယ်ငယ်ဖြစ်ပြီး ပုံမှန်အလင်းမှိန်ကျလေ့ရှိသည်။",
    pm: "21.4 mas/yr"
  },
  {
    id: "r-draconis",
    name: "R Draconis",
    name_mm: "အာရ် ဒရာကိုနစ်",
    type: "Mira-type Pulsating Giant",
    type_mm: "မီရာအမျိုးအစား ဧရာမကြယ်ကြီး",
    ra: 248.108875,
    dec: 66.754167,
    fov: 0.05,
    detector: "SPHEREx-D4",
    description: "Long-period oxygen-rich AGB pulsating giant star located near the North Ecliptic Pole with frequent coverage.",
    description_mm: "မြောက်ဘက်ကြတ်ဂြိုဟ်လမ်းကြောင်းဝင်ရိုးစွန်းအနီးရှိ အချိန်ရှည်ခုန်လှုပ်ကြယ်ကြီး။",
    pm: "14.9 mas/yr"
  }
];

// Bilingual Translations (English & Myanmar)
const I18N = {
  en: {
    nav_about: "About",
    nav_explore: "Explore",
    nav_track: "Track",
    nav_catalog: "Catalog",
    nav_spectrum: "Spectrum",
    nav_presets: "Presets",
    btn_animation: "see animation ▷",
    btn_pause: "pause animation ❚❚",
    btn_detail: "explore detail",
    btn_diff: "view difference dipole",
    btn_wipe: "wipe epochs ⇄",
    lbl_coords: "Coordinates (RA, Dec):",
    btn_explore: "Explore"
  },
  mm: {
    nav_about: "အကြောင်းအရာ",
    nav_explore: "လေ့လာမည်",
    nav_track: "ခြေရာခံရန်",
    nav_catalog: "ကြယ်စာရင်း",
    nav_spectrum: "ရောင်စဉ်ခွဲခြမ်းမှု",
    nav_presets: "ရည်ညွှန်းကြယ်များ",
    btn_animation: "လှုပ်ရှားမှုကြည့်မည် ▷",
    btn_pause: "ခေတ္တရပ်မည် ❚❚",
    btn_detail: "အသေးစိတ်လေ့လာရန်",
    btn_diff: "ဒိုင်ပိုးအလင်းကွာခြားချက်",
    btn_wipe: "ကာလနှစ်ခုနှိုင်းယှဉ်မည် ⇄",
    lbl_coords: "ကိုဩဒိနိတ် (RA, Dec):",
    btn_explore: "ရှာဖွေမည်"
  }
};

let currentLang = localStorage.getItem('spherex_lang') || 'en';

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'mm' : 'en';
  localStorage.setItem('spherex_lang', currentLang);
  applyLanguage();
}

function applyLanguage() {
  document.body.classList.toggle('lang-mm', currentLang === 'mm');
  const dict = I18N[currentLang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  const toggleBtn = document.getElementById('langToggleBtn');
  if (toggleBtn) {
    toggleBtn.textContent = currentLang === 'en' ? 'ENG/MM' : 'MM/ENG';
  }
}

// Draw celestial crosshair and compass on Canvas
function drawWCSCompass(ctx, x, y, size = 30) {
  ctx.save();
  ctx.strokeStyle = "rgba(0, 229, 255, 0.75)";
  ctx.fillStyle = "rgba(0, 229, 255, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.font = "11px 'Inter', sans-serif";

  // North (Up) Arrow
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - size);
  ctx.stroke();
  ctx.fillText("N", x - 4, y - size - 4);

  // East (Left) Arrow
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size, y);
  ctx.stroke();
  ctx.fillText("E", x - size - 12, y + 4);

  ctx.restore();
}

/**
 * Safe HTML escaping to prevent XSS from user nicknames, notes, or external catalog strings.
 */
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Converts real astronomical FITS MJD (Modified Julian Date) to human-readable
 * UTC date, exact timestamp, and official SPHEREx 6-month survey phase.
 * Never fabricates or synthesizes dates by multiplying frame indexes.
 */
function mjdToUtcDate(mjd) {
  if (typeof mjd !== 'number' || isNaN(mjd) || mjd < 10000) {
    return {
      mjd: mjd || 0,
      shortDate: "Unknown Date",
      fullDateUTC: "Unknown UTC",
      surveyPass: 1,
      phaseName: "Survey 1",
      compactPhase: "Survey 1",
      isoString: ""
    };
  }

  // MJD 40587.0 is Jan 1, 1970 00:00:00 UTC
  const unixMs = (mjd - 40587.0) * 86400000.0;
  const d = new Date(unixMs);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');

  // SPHEREx launch / survey baseline: MJD 60900 (~Aug 2025)
  // Each survey pass covers the full sky over 182.625 days (~6 months)
  const daysSinceLaunch = Math.max(0, mjd - 60900.0);
  const surveyPass = Math.min(4, Math.floor(daysSinceLaunch / 182.625) + 1);

  return {
    mjd: mjd,
    surveyPass: surveyPass,
    phaseName: `Survey ${surveyPass}`,
    shortPhase: `Survey ${surveyPass}`,
    shortDate: `${month} ${day}, ${year}`,
    compactPhase: `Survey ${surveyPass}: ${month} ${day}`,
    fullDateUTC: `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hours}:${minutes} UTC`,
    isoString: d.toISOString()
  };
}

/**
 * Backward compatibility wrapper for older callers.
 * Directly formats real MJD timestamp.
 */
function mjdToSurveyPhaseInfo(mjd, phaseOffset = 0) {
  return mjdToUtcDate(mjd);
}

/**
 * Read celestial coordinates and target from URL query parameters.
 * E.g., explore.html?ra=269.452075&dec=4.693391&fov=0.05
 */
function getUrlCoordinates() {
  const params = new URLSearchParams(window.location.search);
  const raStr = params.get('ra');
  const decStr = params.get('dec');
  const fovStr = params.get('fov');
  const targetId = params.get('target');
  const detector = params.get('detector');

  const ra = raStr !== null ? parseFloat(raStr) : null;
  const dec = decStr !== null ? parseFloat(decStr) : null;
  const fov = fovStr !== null ? parseFloat(fovStr) : null;

  const validRa = (ra !== null && !isNaN(ra) && ra >= 0 && ra <= 360);
  const validDec = (dec !== null && !isNaN(dec) && dec >= -90 && dec <= 90);
  const validFov = (fov !== null && !isNaN(fov) && fov >= 0.005 && fov <= 0.5);

  return {
    hasCoords: validRa && validDec,
    ra: validRa ? ra : null,
    dec: validDec ? dec : null,
    fov: validFov ? fov : (fov !== null ? 0.05 : null),
    targetId: targetId || null,
    detector: detector || null
  };
}

/**
 * Update the browser URL bar and inter-page navigation links when coordinates change.
 */
function setUrlCoordinates(ra, dec, fov, targetId, detector) {
  try {
    const url = new URL(window.location.href);
    if (typeof ra === 'number') url.searchParams.set('ra', ra.toFixed(6));
    if (typeof dec === 'number') url.searchParams.set('dec', dec.toFixed(6));
    if (typeof fov === 'number') url.searchParams.set('fov', fov.toFixed(4));
    if (targetId) url.searchParams.set('target', targetId);
    else url.searchParams.delete('target');
    if (detector) url.searchParams.set('detector', detector);
    window.history.replaceState({}, '', url.toString());
    updateNavLinks();
  } catch (e) {
    // Graceful fallback for non-browser or sandbox environments
  }
}

/**
 * Update all navigation links on the page so coordinates persist when clicking tabs.
 */
function updateNavLinks() {
  const currentParams = window.location.search;
  if (!currentParams) return;
  document.querySelectorAll('nav a.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.endsWith('.html')) {
      const baseName = href.split('?')[0];
      link.setAttribute('href', `${baseName}${currentParams}`);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyLanguage();
  updateNavLinks();
  const langBtn = document.getElementById('langToggleBtn');
  if (langBtn) {
    langBtn.addEventListener('click', toggleLanguage);
  }
});
