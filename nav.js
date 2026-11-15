document.addEventListener('DOMContentLoaded', () => {
  const dd = document.querySelector('.sx-dropdown');
  if (dd) {
    const btn = dd.querySelector('.sx-drop-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', () => {
      dd.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  // Timeline is not implemented yet
  const tl = document.getElementById('nav-timeline');
  if (tl) tl.addEventListener('click', (e) => e.preventDefault());

  // Pages without shared.js (home, about) translate nav labels here
  if (typeof applyLanguage === 'undefined') {
    const t = {
      en: { 'nav_timeline': 'Timeline', 'nav_menu': 'Tools', 'nav_about': 'About', 'nav_explore': 'Explore', 'nav_track': 'Track', 'nav_catalog': 'Catalog', 'nav_spectrum': 'Spectrum', 'nav_comparison': 'Comparison', lang: 'ENG/MM' },
      mm: { 'nav_timeline': 'အချိန်ဇယား', 'nav_menu': 'ကိရိယာများ', 'nav_about': 'အကြောင်းအရာ', 'nav_explore': 'လေ့လာမည်', 'nav_track': 'ခြေရာခံရန်', 'nav_catalog': 'ကြယ်စာရင်း', 'nav_spectrum': 'ရောင်စဉ်ခွဲခြမ်းမှု', 'nav_comparison': 'နှိုင်းယှဉ်ချက်', lang: 'MM/ENG' }
    };
    let lang = 'en';
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.addEventListener('click', () => {
      lang = lang === 'en' ? 'mm' : 'en';
      document.querySelectorAll('.sx-navbar [data-i18n]').forEach(el => { el.textContent = t[lang][el.dataset.i18n]; });
      langBtn.textContent = t[lang].lang;
    });
  }
});
