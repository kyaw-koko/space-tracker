/* object.js: one Three.js scene per row of object.html (three.js r128).
   One shared WebGLRenderer draws whichever rows are on screen and copies the result into
   each row's 2D canvas, so the page never runs out of WebGL contexts.
   Each builder returns { obj, fixed?, cam, spin, update(t, dt, camera) }:
   obj tilts and spins with the pointer, fixed stays facing the viewer (labels, light curves).
   All visuals are illustrations. Sizes, colors and distances are simplified. */
(function () {
  if (!window.THREE) return;
  var SIZE = 512;
  var R;
  try { R = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return; }
  R.setPixelRatio(1); R.setSize(SIZE, SIZE, false); R.setClearColor(0x000000, 0);

  var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
  function M(c, o) { return new THREE.MeshBasicMaterial({ color: c, transparent: o !== undefined && o < 1, opacity: o === undefined ? 1 : o, side: THREE.DoubleSide }); }
  function glowMat(c, o) { return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }); }
  function LM(c, o) { return new THREE.LineBasicMaterial({ color: c, transparent: o !== undefined, opacity: o === undefined ? 1 : o }); }
  function line(pts, c, o, loop) { return new (loop ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(pts), LM(c, o)); }
  function dyn(n, c, o) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    var l = new THREE.Line(g, LM(c, o)); l.frustumCulled = false; return l;
  }
  function setPts(l, pts) {
    var a = l.geometry.attributes.position;
    for (var i = 0; i < pts.length; i++) a.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    a.needsUpdate = true;
  }
  function canvasTex(w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    return { c: c, ctx: c.getContext("2d"), tex: new THREE.CanvasTexture(c) };
  }
  // Text label sprite. hgt = world height of the sprite; text shrinks to fit the canvas.
  function sprite(text, color, hgt) {
    var ct = canvasTex(1024, 96), x = ct.ctx, fs = 52, m;
    x.font = "bold " + fs + "px sans-serif";
    m = x.measureText(text);
    while (m && m.width > 1004 && fs > 18) { fs -= 2; x.font = "bold " + fs + "px sans-serif"; m = x.measureText(text); }
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = color; x.fillText(text, 512, 50); ct.tex.needsUpdate = true;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct.tex, transparent: true, depthTest: false }));
    s.scale.set(hgt * 1024 / 96, hgt, 1); return s;
  }
  function pointsFrom(arr, color, size, opacity) {
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: color, size: size, transparent: true, opacity: opacity, depthWrite: false }));
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function rnd() { return Math.random(); }
  function shellDir() { var u = rnd() * 2 - 1, t = rnd() * 6.2832, r = Math.sqrt(1 - u * u); return V(r * Math.cos(t), u, r * Math.sin(t)); }
  function kepler(Mn, e) { var E = Mn; for (var i = 0; i < 8; i++) E = Mn + e * Math.sin(E); return E; }

  var B = {};

  // 1. WISE 0855-0714: very cold brown dwarf, glows in infrared, ice clouds
  B.wise = function () {
    var g = new THREE.Group(), i;
    var ct = canvasTex(256, 128), x = ct.ctx;
    for (var y = 0; y < 128; y++) {
      var v = 0.5 + 0.5 * Math.sin(y * 0.21) + 0.25 * Math.sin(y * 0.57 + 1);
      x.fillStyle = "rgb(" + Math.round(45 + 65 * v) + "," + Math.round(8 + 20 * v) + "," + Math.round(50 + 55 * v) + ")";
      x.fillRect(0, y, 256, 1);
    }
    x.fillStyle = "rgba(200,220,255,0.13)";
    for (i = 0; i < 45; i++) { x.beginPath(); x.ellipse(rnd() * 256, rnd() * 128, 10 + rnd() * 26, 2 + rnd() * 3, 0, 0, 6.2832); x.fill(); }
    ct.tex.needsUpdate = true;
    var body = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 32), new THREE.MeshBasicMaterial({ map: ct.tex }));
    body.rotation.z = 0.3; g.add(body);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), glowMat(0xaa2266, 0.35)));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.9, 32, 24), glowMat(0xaa2266, 0.14)));
    var pa = new Float32Array(240 * 3);
    for (i = 0; i < 240; i++) { var d = shellDir().multiplyScalar(1.34 + rnd() * 0.18); pa.set([d.x, d.y, d.z], i * 3); }
    var ice = pointsFrom(pa, 0xdfeaff, 0.035, 0.85); g.add(ice);
    var rings = [];
    for (i = 0; i < 3; i++) {
      var rg = new THREE.RingGeometry(0.98, 1, 80); rg.rotateX(-Math.PI / 2);
      var rm = new THREE.Mesh(rg, M(0xff4d8d, 0.5)); g.add(rm); rings.push(rm);
    }
    g.rotation.x = 0.35;
    var fixed = new THREE.Group(), lab = sprite("\u2248 250 K  (\u221223 \u00b0C)", "#ff9fc4", 0.6); lab.position.y = -2.4; fixed.add(lab);
    return { obj: g, fixed: fixed, cam: [0, 0.2, 7.4], spin: true, update: function (t) {
      body.rotation.y = t * 0.35; ice.rotation.y = t * 0.5;
      rings.forEach(function (r, k) { var p = (t * 0.4 + k / 3) % 1; r.scale.setScalar(1.3 + p * 1.5); r.material.opacity = 0.5 * (1 - p); });
    } };
  };

  // 2. Barnard's Star: red dwarf, four tight planets, drifts against the background
  B.barnard = function () {
    var g = new THREE.Group(), i;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 24), M(0xff6a3a)));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 24), glowMat(0xff5a2a, 0.35)));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), glowMat(0xff5a2a, 0.12)));
    var spec = [[1.4, 2.34, 0xc9b79c], [1.85, 3.15, 0xb98f6a], [2.35, 4.12, 0xa9a29a], [2.95, 6.74, 0x9fb7c9]], planets = [];
    spec.forEach(function (s, k) {
      var pts = []; for (var a = 0; a < 80; a++) pts.push(V(s[0] * Math.cos(a / 80 * 6.2832), 0, s[0] * Math.sin(a / 80 * 6.2832)));
      g.add(line(pts, 0x6a4a3a, 0.8, true));
      var p = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), M(s[2])); g.add(p); planets.push({ m: p, r: s[0], P: s[1], ph: k * 1.7 });
    });
    var N = 140, bg = new Float32Array(N * 3), x0 = [], y0 = [], z0 = [];
    for (i = 0; i < N; i++) { x0.push(rnd() * 12 - 6); y0.push(rnd() * 8 - 4); z0.push(-2 - rnd() * 3); }
    var stars = pointsFrom(bg, 0xffffff, 0.05, 0.8); g.add(stars);
    g.rotation.x = 0.45;
    var fixed = new THREE.Group();
    fixed.add(line([V(-1.6, 2.75, 0), V(1.3, 2.75, 0)], 0xffd9a8, 0.9));
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 12), M(0xffd9a8)); cone.rotation.z = -Math.PI / 2; cone.position.set(1.4, 2.75, 0); fixed.add(cone);
    var l1 = sprite("proper motion: 10.3\u2033 / yr", "#ffd9a8", 0.55); l1.position.set(-0.1, 2.5, 0); fixed.add(l1);
    return { obj: g, fixed: fixed, cam: [0, 0.4, 8.6], spin: false, update: function (t) {
      planets.forEach(function (p) { var a = p.ph + t * 2.6 / p.P * 2; p.m.position.set(p.r * Math.cos(a), 0, p.r * Math.sin(a)); });
      var pos = stars.geometry.attributes.position;
      for (var i = 0; i < N; i++) { var xx = ((x0[i] - t * 0.35 + 6) % 12 + 12) % 12 - 6; pos.setXYZ(i, xx, y0[i], z0[i]); }
      pos.needsUpdate = true;
    } };
  };

  // 3. Epsilon Indi B: two brown dwarfs orbiting a shared center (e = 0.54, ~11 yr)
  B.epsilon = function () {
    var g = new THREE.Group(), e = 0.54, a = 2.6, m1 = 67, m2 = 53, Mt = m1 + m2;
    function rel(E) { return V(a * (Math.cos(E) - e), 0, a * Math.sqrt(1 - e * e) * Math.sin(E)); }
    var o1 = [], o2 = [];
    for (var k = 0; k <= 120; k++) { var r = rel(k / 120 * 6.2832); o1.push(r.clone().multiplyScalar(-m2 / Mt)); o2.push(r.clone().multiplyScalar(m1 / Mt)); }
    g.add(line(o1, 0xd98a4a, 0.6)); g.add(line(o2, 0xc060c0, 0.6));
    var ba = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), M(0xd9803a)), bb = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), M(0xa04ab0));
    ba.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), glowMat(0xff8a3d, 0.3)));
    bb.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), glowMat(0xc060ff, 0.3)));
    var la = sprite("Ba", "#ffc08a", 0.4), lb = sprite("Bb", "#e0a0ff", 0.4); la.position.y = 0.6; lb.position.y = 0.6; ba.add(la); bb.add(lb);
    g.add(ba, bb);
    var bc = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M(0xffffff)); g.add(bc);
    var sA = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), M(0xffa24a)); sA.position.set(-4.2, 0, 0);
    sA.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), glowMat(0xffa24a, 0.3))); g.add(sA);
    var dash = []; for (var d = -3.6; d < -1.6; d += 0.22) dash.push(V(d, 0, 0), V(d + 0.1, 0, 0));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dash), LM(0x8a7a6a, 0.8)));
    var ls = sprite("to \u03b5 Indi A (>1,400 AU)", "#c9b79c", 0.45); ls.position.set(-2.6, 0.55, 0); g.add(ls);
    g.rotation.x = 0.5;
    var fixed = new THREE.Group(), lab = sprite("Ba \u2248 67 MJ   Bb \u2248 53 MJ   P \u2248 11 yr", "#e6d3ff", 0.5); lab.position.y = -2.7; fixed.add(lab);
    return { obj: g, fixed: fixed, cam: [0, 0.4, 11], spin: false, update: function (t) {
      var Mn = t * 6.2832 / 8, E = kepler(Mn, e), r = rel(E);
      ba.position.copy(r.clone().multiplyScalar(-m2 / Mt)); bb.position.copy(r.clone().multiplyScalar(m1 / Mt));
    } };
  };

  // 4. RW Aurigae: tilted dust disk, companion, tidal stream, dust clumps that dim the star
  B.rwaur = function () {
    var g = new THREE.Group(), i, A = V(-1.0, 0.2, 0);
    var starA = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 20), M(0xffc46a)); starA.position.copy(A); g.add(starA);
    var glowA = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), glowMat(0xffb347, 0.32)); glowA.position.copy(A); g.add(glowA);
    var G = new THREE.Group(); G.position.copy(A); G.rotation.x = 1.15; g.add(G);
    var rg = new THREE.RingGeometry(0.8, 2.1, 72); G.add(new THREE.Mesh(rg, M(0x6b4a2a, 0.3)));
    var dp = new Float32Array(900 * 3);
    for (i = 0; i < 900; i++) { var r = 0.85 + rnd() * 1.25, th = rnd() * 6.2832; dp.set([r * Math.cos(th), r * Math.sin(th), (rnd() - 0.5) * 0.08], i * 3); }
    var dust = pointsFrom(dp, 0xb08a60, 0.03, 0.8); G.add(dust);
    var clumps = [[1.45, 0.9, 0.2], [1.9, 0.65, 2.2], [1.15, 1.2, 4.1]].map(function (c) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), M(0x2a1a10, 0.88)); G.add(m); return { m: m, r: c[0], w: c[1], ph: c[2] };
    });
    var B2 = V(2.7, -0.3, 0);
    var starB = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), M(0xffa24a)); starB.position.copy(B2); g.add(starB);
    var gb = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), glowMat(0xff9a3a, 0.28)); gb.position.copy(B2); g.add(gb);
    var sp = new Float32Array(180 * 3), P0 = V(0.95, 0.55, 0), P1 = V(1.8, 1.5, 0.2), P2 = V(2.45, -0.1, 0);
    for (i = 0; i < 180; i++) {
      var u = i / 179, w = 1 - u;
      sp.set([w * w * P0.x + 2 * w * u * P1.x + u * u * P2.x + (rnd() - 0.5) * 0.12, w * w * P0.y + 2 * w * u * P1.y + u * u * P2.y + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.12], i * 3);
    }
    g.add(pointsFrom(sp, 0xd8b890, 0.04, 0.8));
    var fixed = new THREE.Group(), N = 150, hist = [], curve = dyn(N, 0xffc46a), vw = V(0, 0, 0), sw = V(0, 0, 0), last = -1, cur = 1;
    fixed.add(curve);
    fixed.add(line([V(-2.6, -3.05, 0), V(2.6, -3.05, 0)], 0x3a4a78, 0.8));
    var ll = sprite("brightness over time", "#c9b79c", 0.4); ll.position.set(0, -3.4, 0); fixed.add(ll);
    for (i = 0; i < N; i++) hist.push(1);
    return { obj: g, fixed: fixed, cam: [0, 0.2, 9.6], spin: false, update: function (t, dt, cam) {
      dust.rotation.z = t * 0.12;
      var dim = 0; cam.updateMatrixWorld();
      starA.getWorldPosition(sw).applyMatrix4(cam.matrixWorldInverse);
      clumps.forEach(function (c) {
        var a = c.ph + t * c.w; c.m.position.set(c.r * Math.cos(a), c.r * Math.sin(a), 0);
        vw.copy(c.m.position); G.localToWorld(vw); vw.applyMatrix4(cam.matrixWorldInverse);
        if (vw.z > sw.z) { var dd = (vw.x - sw.x) * (vw.x - sw.x) + (vw.y - sw.y) * (vw.y - sw.y); dim = Math.max(dim, 0.88 * Math.exp(-dd / 0.14)); }
      });
      cur += (1 - dim - cur) * 0.25;
      starA.material.color.setRGB(1 * cur, 0.77 * cur, 0.42 * cur); glowA.material.opacity = 0.32 * cur;
      if (t - last > 0.05) { last = t; hist.push(cur); hist.shift(); }
      var p = []; for (var k = 0; k < N; k++) p.push(V(-2.6 + 5.2 * k / (N - 1), -3.05 + 0.65 * hist[k], 0));
      setPts(curve, p);
    } };
  };

  // 5. R Draconis: pulsating Mira giant shedding dust, visible vs infrared light curves
  B.rdra = function () {
    var g = new THREE.Group(), i, P = 5;
    var star = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), M(0xff4a24));
    var glow = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), glowMat(0xff6a3a, 0.3));
    g.add(star, glow);
    var N = 320, dirs = [], offs = [], da = new Float32Array(N * 3);
    for (i = 0; i < N; i++) { dirs.push(shellDir()); offs.push(rnd()); }
    var dust = pointsFrom(da, 0xcaa07a, 0.045, 0.7); g.add(dust);
    g.position.y = 0.6;
    var fixed = new THREE.Group(), NP = 140, lv = dyn(NP, 0x4de0ff), li = dyn(NP, 0xff8a3d);
    fixed.add(lv, li);
    fixed.add(line([V(-2.6, -2.95, 0), V(2.6, -2.95, 0)], 0x3a4a78, 0.8));
    var s1 = sprite("visible", "#4de0ff", 0.4), s2 = sprite("infrared", "#ff8a3d", 0.4); s1.position.set(-2.0, -2.45, 0); s2.position.set(2.0, -2.45, 0); fixed.add(s1, s2);
    var cool = new THREE.Color(0xff3b1f), hot = new THREE.Color(0xffa24a);
    function vis(ph) { return 0.03 + 0.97 * Math.pow(0.5 + 0.5 * Math.cos(ph), 3); }
    function ir(ph) { return 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(ph - 0.5)); }
    return { obj: g, fixed: fixed, cam: [0, 0.2, 9.6], spin: true, update: function (t) {
      var ph = t * 6.2832 / P, rad = 1.0 + 0.3 * Math.cos(ph + 3.1416), h = 0.5 + 0.5 * Math.cos(ph);
      star.scale.setScalar(rad); glow.scale.setScalar(rad * 1.3); glow.material.opacity = 0.18 + 0.2 * h;
      star.material.color.copy(cool).lerp(hot, h);
      var pos = dust.geometry.attributes.position;
      for (var i = 0; i < N; i++) { var d = dirs[i], rr = 1.45 + ((t * 0.12 + offs[i]) % 1) * 2.2; pos.setXYZ(i, d.x * rr, d.y * rr, d.z * rr); }
      pos.needsUpdate = true;
      var a = [], b = [];
      for (var k = 0; k < NP; k++) { var tt = t - (NP - 1 - k) * 0.07, p = tt * 6.2832 / P, x = -2.6 + 5.2 * k / (NP - 1); a.push(V(x, -2.95 + 0.85 * vis(p), 0)); b.push(V(x, -2.95 + 0.85 * ir(p), 0)); }
      setPts(lv, a); setPts(li, b);
    } };
  };

  // ---------- shared renderer, one scene per canvas ----------
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = [];
  document.querySelectorAll("canvas.part-canvas").forEach(function (cv) {
    var build = B[cv.getAttribute("data-m")];
    if (!build) return;
    var b = build(), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100), pivot = new THREE.Group();
    pivot.add(b.obj); scene.add(pivot);
    if (b.fixed) scene.add(b.fixed);
    cam.position.set(b.cam[0], b.cam[1], b.cam[2]); cam.lookAt(0, 0, 0);
    cv.width = cv.height = SIZE;
    var it = { cv: cv, ctx: cv.getContext("2d"), scene: scene, cam: cam, pivot: pivot, b: b, visible: false, spin: 0, dx: 0, dy: 0, drag: null };
    cv.addEventListener("pointerdown", function (e) { it.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", function (e) {
      if (!it.drag) return;
      it.dx += (e.clientX - it.drag.x) * 0.01; it.dy = clamp(it.dy + (e.clientY - it.drag.y) * 0.006, -0.8, 0.8);
      it.drag = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener("pointerup", function () { it.drag = null; });
    new IntersectionObserver(function (en) { it.visible = en[0].isIntersecting; }, { threshold: 0.05 }).observe(cv);
    items.push(it);
  });

  var last = performance.now(), T0 = last;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    var t = reduce ? 2.0 : (now - T0) / 1000;
    items.forEach(function (it) {
      if (!it.visible) return;
      if (it.b.spin && !it.drag && !reduce) it.spin += dt * 0.3;
      it.pivot.rotation.y = (it.b.spin ? it.spin : 0.3 * Math.sin(t * 0.4)) + it.dx;
      it.pivot.rotation.x = it.dy;
      it.pivot.updateMatrixWorld(true);
      it.b.update(t, dt, it.cam);
      R.render(it.scene, it.cam);
      it.ctx.clearRect(0, 0, SIZE, SIZE);
      it.ctx.drawImage(R.domElement, 0, 0, SIZE, SIZE);
    });
  }
  requestAnimationFrame(frame);
})();
