document.addEventListener("DOMContentLoaded", () => {
  const bgVideo = document.getElementById("bg-video");
  const langToggle = document.getElementById("lang-toggle");
  const startBtn = document.getElementById("start-btn");

  // Loop background video infinitely at the 5-second mark
  if (bgVideo) {
    bgVideo.addEventListener("timeupdate", () => {
      if (bgVideo.currentTime >= 5) {
        bgVideo.currentTime = 0;
        bgVideo.play();
      }
    });
  }

  // Elements to translate
  const navAbout = document.getElementById("nav-about");
  const navExplore = document.getElementById("nav-explore");
  const navTrack = document.getElementById("nav-track");
  const heroSubtitle = document.getElementById("hero-subtitle");

  let currentLang = "ENG";

  // Toggle between English and Myanmar text
  langToggle.addEventListener("click", (e) => {
    e.preventDefault();

    if (currentLang === "ENG") {
      currentLang = "MM";
      navAbout.textContent = "အကြောင်းအရာ";
      navExplore.textContent = "စူးစမ်းလေ့လာရန်";
      navTrack.textContent = "ခြေရာခံရန်";
      heroSubtitle.textContent = "စကြဝဠာသမိုင်းကြောင်းနှင့် ရေခဲများကို စူးစမ်းလေ့လာမည့် အာကာသတယ်လီစကုပ်";
      startBtn.textContent = "စတင်လေ့လာမည်";
    } else {
      currentLang = "ENG";
      navAbout.textContent = "About";
      navExplore.textContent = "Explore";
      navTrack.textContent = "Track";
      heroSubtitle.textContent = "Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer";
      startBtn.textContent = "Start Explore";
    }
  });

  // Navigation click handler for the Start Explore button
  startBtn.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "explore.html";
  });
});