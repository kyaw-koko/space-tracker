document.addEventListener("DOMContentLoaded", () => {
  const bgVideo = document.getElementById("bg-video");
  const langToggle = document.getElementById("lang-toggle");
  const startBtn = document.getElementById("start-btn");
  const footerText = document.getElementById("footer-text");

  // Ensure video is muted for browser autoplay policy, start play, and loop at 5s mark
  if (bgVideo) {
    bgVideo.muted = true;
    bgVideo.play().catch((err) => {
      console.warn("Autoplay was delayed or blocked by browser policy:", err);
    });

    bgVideo.addEventListener("timeupdate", () => {
      if (bgVideo.currentTime >= 5) {
        bgVideo.currentTime = 0;
        bgVideo.play().catch(() => {});
      }
    });
  }

  // Elements to translate
  const heroSubtitle = document.getElementById("hero-subtitle");

  let currentLang = "ENG";

  // Toggle between English and Myanmar text
  langToggle.addEventListener("click", (e) => {
    e.preventDefault();

    if (currentLang === "ENG") {
      currentLang = "MM";
      heroSubtitle.textContent = "စကြဝဠာသမိုင်းကြောင်းနှင့် ရေခဲများကို စူးစမ်းလေ့လာမည့် အာကာသတယ်လီစကုပ်";
      startBtn.textContent = "စတင်လေ့လာမည်";
      footerText.textContent = "© ၂၀၂၆ SPHEREx မစ်ရှင် စူးစမ်းလေ့လာရေး။ မူပိုင်ခွင့်အားလုံး ရယူထားသည်။";
    } else {
      currentLang = "ENG";
      heroSubtitle.textContent = "Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer";
      startBtn.textContent = "Start Explore";
      footerText.textContent = "\u00a9 2026 SPHEREx Mission Explorer. All rights reserved.";
    }
  });

  // Navigation click handler for the Start Explore button
  startBtn.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "explore.html";
  });
});