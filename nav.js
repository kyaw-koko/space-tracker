document.addEventListener('DOMContentLoaded', () => {
  const dropdowns = document.querySelectorAll('.sx-dropdown');
  dropdowns.forEach(dd => {
    const btn = dd.querySelector('.sx-drop-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdowns.forEach(other => {
        if (other !== dd) {
          other.classList.remove('open');
          const otherBtn = other.querySelector('.sx-drop-btn');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });
      const open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  document.addEventListener('click', () => {
    dropdowns.forEach(dd => {
      dd.classList.remove('open');
      const btn = dd.querySelector('.sx-drop-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  });

  // Timeline is not implemented yet
  const tl = document.getElementById('nav-timeline');
  if (tl) tl.addEventListener('click', (e) => e.preventDefault());

  // Pages without shared.js (home, about, learn, measurement) translate nav labels here
  if (typeof applyLanguage === 'undefined') {
    const t = {
      en: {
        'nav_learning': 'Learning',
        'nav_rotation': 'Rotation',
        'nav_objects': 'Objects',
        'nav_measurements': 'Measurements',
        'nav_comparison': 'Comparison',
        'nav_menu': 'Tools',
        'nav_tools': 'Tools',
        'nav_about': 'About',
        'nav_explore': 'Explore',
        'nav_track': 'Track',
        'nav_catalog': 'Catalog',
        'nav_spectrum': 'Spectrum',
        'nav_timeline': 'Timeline',
        lang: 'ENG/MM'
      },
      mm: {
        'nav_learning': 'လေ့လာမှု',
        'nav_rotation': 'ပတ်လမ်းလည်ပတ်မှု',
        'nav_objects': 'အရာဝတ္ထုများ',
        'nav_measurements': 'တိုင်းတာချက်များ',
        'nav_comparison': 'နှိုင်းယှဉ်ချက်',
        'nav_menu': 'ကိရိယာများ',
        'nav_tools': 'ကိရိယာများ',
        'nav_about': 'အကြောင်းအရာ',
        'nav_explore': 'လေ့လာမည်',
        'nav_track': 'ခြေရာခံရန်',
        'nav_catalog': 'ကြယ်စာရင်း',
        'nav_spectrum': 'ရောင်စဉ်ခွဲခြမ်းမှု',
        'nav_timeline': 'အချိန်ဇယား',
        lang: 'MM/ENG'
      }
    };
    let lang = localStorage.getItem('spherex_lang') || 'en';
    window.SXLang = {
      get: () => (lang === 'mm' ? 'MM' : 'ENG')
    };

    function updateNavLabels() {
      document.querySelectorAll('.sx-navbar [data-i18n]').forEach(el => {
        const k = el.dataset.i18n;
        if (t[lang] && t[lang][k]) el.textContent = t[lang][k];
      });
      const langBtn = document.getElementById('lang-toggle') || document.getElementById('langToggleBtn');
      if (langBtn) langBtn.textContent = t[lang].lang;
      window.dispatchEvent(new Event('sx-lang'));
    }

    const langBtn = document.getElementById('lang-toggle') || document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        lang = lang === 'en' ? 'mm' : 'en';
        localStorage.setItem('spherex_lang', lang);
        updateNavLabels();
      });
      updateNavLabels();
    }
  }
});



