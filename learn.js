/* track.js: simulated SPHEREx orbit (three.js r128).
   Model: ~650 km sun-synchronous polar orbit, inclination 97.95 deg, period ~97.7 min,
   plane perpendicular to the Sun direction so the spacecraft rides the day/night line.
   Motion is simulated from those published numbers. It is NOT a live position. */
(function () {
  var T = {
    ENG: {
      title: "Track SPHEREx",
      intro: "SPHEREx rides a polar orbit along the line between day and night, so the Sun always shines on its solar panels and never into its telescope. Drag to look around.",
      alt: "altitude", per: "orbit period", inc: "inclination", lat: "latitude (simulated)", orb: "orbits completed",
      pause: "Pause", play: "Play", follow: "Follow satellite", free: "Free camera",
      note: "Simulated motion based on SPHEREx’s published orbit. This is not a live position."
    },
    MM: {
      title: "SPHEREx ကို ခြေရာခံပါ",
      intro: "SPHEREx သည် နေ့နှင့်ညကြား မျဉ်းတစ်လျှောက် ဝင်ရိုးစွန်းဖြတ်ပတ်လမ်းတွင် ပတ်နေသောကြောင့် နေရောင်သည် ၎င်း၏ နေရောင်ခြည်သုံးပြားများကို အမြဲထိုးပြီး တယ်လီစကုပ်ထဲ မဝင်ပါ။ ဆွဲ၍ ပတ်ကြည့်နိုင်သည်။",
      alt: "အမြင့်", per: "ပတ်လမ်းကာလ", inc: "ဦးတည်ထောင့်", lat: "လတ္တီကျု (သရုပ်ပြ)", orb: "ပတ်ပြီးသည့်အကြိမ်",
      pause: "ရပ်မည်", play: "ဆက်မည်", follow: "ဂြိုဟ်တုကို လိုက်ကြည့်မည်", free: "လွတ်လပ်စွာကြည့်မည်",
      note: "မူရင်းပတ်လမ်းအချက်အလက်အပေါ် အခြေခံသော သရုပ်ပြလှုပ်ရှားမှုသာ ဖြစ်ပြီး တိုက်ရိုက်တည်နေရာ မဟုတ်ပါ။"
    }
  };
  var $ = function (id) { return document.getElementById(id); };
  var playing = true, follow = false;

  function labels() {
    var t = T[window.SXLang ? window.SXLang.get() : "ENG"];
    document.querySelectorAll("[data-k]").forEach(function (el) { el.textContent = t[el.getAttribute("data-k")]; });
    $("play").textContent = playing ? t.pause : t.play;
    $("cam").textContent = follow ? t.free : t.follow;
  }
  window.addEventListener("sx-lang", labels);

  var canvas = $("scene");
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  // background stars
  var sp = new Float32Array(1800 * 3);
  for (var i = 0; i < 1800; i++) {
    var u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp.set([r * Math.cos(t) * 150, u * 150, r * Math.sin(t) * 150], i * 3);
  }
  var sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  // Sun is on +X. Light comes from there.
  var sunLight = new THREE.DirectionalLight(0xffffff, 1.5); sunLight.position.set(10, 0, 0); scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x1a2744, 0.55));
  var sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
  sunBall.position.set(22, 0, 0); scene.add(sunBall);
  var glow = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.copy(sunBall.position); scene.add(glow);
  var ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(3, 0, 0), new THREE.Vector3(20.5, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.25 }));
  scene.add(ray);

  // Earth (to scale with a 650 km altitude: radius 6371 km -> 2 units, so orbit radius ~2.2)
  var RE = 2, OR = RE * (6371 + 650) / 6371;
  var earth = new THREE.Mesh(new THREE.SphereGeometry(RE, 64, 40), new THREE.MeshPhongMaterial({ color: 0x1b4d8f, emissive: 0x030a16, shininess: 20 }));
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(RE * 1.004, 36, 22), new THREE.MeshBasicMaterial({ color: 0x3f9c6a, wireframe: true, transparent: true, opacity: 0.16 })));
  scene.add(earth);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(RE * 1.07, 40, 28), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));

  // The orbit sits a bit higher than real scale so it reads clearly.
  var OD = OR * 1.35;
  var inc = 97.95 * Math.PI / 180;
  var node = new THREE.Vector3(0, 0, 1);                        // ascending node (plane ⟂ Sun)
  var m = new THREE.Vector3(-1, 0, 0);
  var perp = m.clone().multiplyScalar(Math.cos(inc)).add(new THREE.Vector3(0, Math.sin(inc), 0));
  function orbitPoint(u, rad) { return node.clone().multiplyScalar(Math.cos(u) * rad).add(perp.clone().multiplyScalar(Math.sin(u) * rad)); }
  var normal = new THREE.Vector3().crossVectors(node, perp).normalize();

  var ring = [];
  for (var a = 0; a <= 160; a++) ring.push(orbitPoint(a / 160 * Math.PI * 2, OD));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.55 })));

  var sat = new THREE.Group();
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.16), new THREE.MeshPhongMaterial({ color: 0xd9b25a, shininess: 60 })));
  var pm = new THREE.MeshPhongMaterial({ color: 0x1c3b8a, emissive: 0x0a1a44 });
  [-1, 1].forEach(function (s) { var p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.13), pm); p.position.x = s * 0.24; sat.add(p); });
  sat.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(sat);

  var trail = [], trailLine = null, lastU = -1;
  function pushTrail(p, u) {
    if (Math.abs(u - lastU) < 0.05) return;
    lastU = u; trail.push(p.clone()); if (trail.length > 70) trail.shift();
    if (trailLine) { scene.remove(trailLine); trailLine.geometry.dispose(); }
    if (trail.length < 2) return;
    trailLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(trail), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    scene.add(trailLine);
  }

  // ---- controls ----
  var scales = [60, 300, 1200], scale = 300, simT = 0, PERIOD = 97.7 * 60;
  $("play").addEventListener("click", function () { playing = !playing; labels(); });
  $("spd").addEventListener("click", function () { scale = scales[(scales.indexOf(scale) + 1) % scales.length]; this.textContent = scale + "×"; });
  $("cam").addEventListener("click", function () { follow = !follow; labels(); });

  var th = 0.8, ph = 1.3, dist = 9, drag = null;
  canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", function (e) {
    if (!drag) return;
    th -= (e.clientX - drag.x) * 0.006;
    ph = Math.max(0.2, Math.min(Math.PI - 0.2, ph - (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", function () { drag = null; });
  canvas.addEventListener("wheel", function (e) { e.preventDefault(); dist = Math.max(4.5, Math.min(30, dist * (1 + e.deltaY * 0.001))); }, { passive: false });

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize(); labels();
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { playing = false; labels(); }

  var up = new THREE.Vector3(0, 1, 0), camPos = new THREE.Vector3(), last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (playing) simT += dt * scale;
    var u = (simT / PERIOD) * Math.PI * 2;
    var p = orbitPoint(u, OD);
    sat.position.copy(p);
    sat.quaternion.setFromUnitVectors(up, p.clone().normalize());
    if (playing) pushTrail(p, u);
    earth.rotation.y = simT * 2 * Math.PI / 86164;

    var lat = Math.asin(Math.sin(inc) * Math.sin(u)) * 180 / Math.PI;
    $("lat").textContent = Math.abs(lat).toFixed(1) + "° " + (lat >= 0 ? "N" : "S");
    $("orb").textContent = Math.floor(simT / PERIOD);

    var target;
    if (follow) {
      target = p.clone().normalize().multiplyScalar(OD + 2.2).add(normal.clone().multiplyScalar(1.6));
      camPos.lerp(target, 0.08); camera.position.copy(camPos); camera.lookAt(p);
    } else {
      camPos.set(dist * Math.sin(ph) * Math.cos(th), dist * Math.cos(ph), dist * Math.sin(ph) * Math.sin(th));
      camera.position.lerp(camPos, 0.2); camera.lookAt(0, 0, 0);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  camPos.set(dist * Math.sin(ph) * Math.cos(th), dist * Math.cos(ph), dist * Math.sin(ph) * Math.sin(th));
  camera.position.copy(camPos);
  requestAnimationFrame(frame);
})();
