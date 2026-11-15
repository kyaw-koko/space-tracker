document.addEventListener("DOMContentLoaded", () => {
  // 1. Bidirectional Scroll Animation (Triggers on both Scroll Down and Scroll Up)
  const revealSections = document.querySelectorAll(".scroll-reveal");

  const observerOptions = {
    root: null,
    threshold: 0.25 // Triggers when 25% of the satellite section enters the viewport
  };

  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      } else {
        // Removing the class when out of view makes it animate again when scrolling back up!
        entry.target.classList.remove("is-visible");
      }
    });
  }, observerOptions);

  revealSections.forEach((section) => {
    scrollObserver.observe(section);
  });

  // 2. Hide the "Scroll" mouse indicator when the user reaches the bottom of the page
  const scrollIndicator = document.getElementById("scroll-indicator");
  window.addEventListener("scroll", () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 100;
    scrollIndicator.style.opacity = nearBottom ? "0" : "1";
  });

  // 3. ENG / MM Language Toggle
  const langToggle = document.getElementById("lang-toggle");
  const scrollLabel = document.getElementById("scroll-label");
  const translatableElements = document.querySelectorAll("[data-en]");

  let currentLang = "ENG";

  langToggle.addEventListener("click", (e) => {
    e.preventDefault();
    currentLang = currentLang === "ENG" ? "MM" : "ENG";

    if (currentLang === "MM") {
      scrollLabel.textContent = "အောက်သို့ဆွဲပါ";
      translatableElements.forEach((el) => {
        el.textContent = el.getAttribute("data-mm");
      });
    } else {
      scrollLabel.textContent = "Scroll";
      translatableElements.forEach((el) => {
        el.textContent = el.getAttribute("data-en");
      });
    }
  });
});