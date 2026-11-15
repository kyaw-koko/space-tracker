/* measurement.js: one Three.js scene per row of measurement.html (three.js r128).
   A single shared WebGLRenderer draws whichever rows are on screen and copies the result
   into each row's 2D canvas, so the page never runs out of WebGL contexts.
   Hover or drag a model to tilt it. All visuals are illustrations, not real SPHEREx data. */
(function () {
  if (!window.THREE) return;
  var SIZE = 512;
  var R;
  try { R = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return; }
  R.setPixelRatio(1); R.setSize(SIZE, SIZE, false); R.setClearColor(0x000000, 0);

  var C = { orange: 0xff8a3d, blue: 0x5aa8ff, cyan: 0x4de0ff, gold: 0xffd36a, green: 0x7dffb0, dim: 0x3a4a78, white: 0xffffff };
  var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
  function M(c, o) { return new THREE.MeshBasicMaterial({ color: c, transparent: o !== undefined && o < 1, opacity: o === undefined ? 1 : o, side: THREE.DoubleSide }); }
  function LM(c, o) { return new THREE.LineBasicMaterial({ color: c, transparent: o !== undefined, opacity: o === undefined ? 1 : o }); }
  function line(pts, c, o, loop) { return new (loop ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(pts), LM(c, o)); }
  function dyn(n, c) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    var l = new THREE.Line(g, LM(c)); l.frustumCulled = false; return l;
  }
  function setPts(l, pts) {
    var a = l.geometry.attributes.position;
    for (var i = 0; i < pts.length; i++) a.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    a.needsUpdate = true;
  }
  function edges(geo, c) { return new THREE.LineSegments(new THREE.EdgesGeometry(geo), LM(c)); }
  function canvasTex(w, h, nearest) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var t = new THREE.CanvasTexture(c);
    if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
    return { c: c, ctx: c.getContext("2d"), tex: t };
  }
  function sprite(text, color, w) {
    var ct = canvasTex(256, 96);
    ct.ctx.font = "bold 56px sans-serif"; ct.ctx.textAlign = "center"; ct.ctx.textBaseline = "middle";
    ct.ctx.fillStyle = color; ct.ctx.fillText(text, 128, 50); ct.tex.needsUpdate = true;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct.tex, transparent: true, depthTest: false }));
    s.scale.set(w, w * 96 / 256, 1); return s;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function rnd() { return Math.random(); }
  function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.73; }
  function hex(h, s, l) { return new THREE.Color().setHSL(h, s, l).getHex(); }

  var B = {};

  // 1. RA / DEC: celestial sphere with the two angles drawn out to a star
  B.coords = function () {
    var g = new THREE.Group(), r = 1.7, k, pts, a, d;
    function P(ra, dec, rr) { rr = rr || r; return V(rr * Math.cos(dec) * Math.cos(ra), rr * Math.sin(dec), -rr * Math.cos(dec) * Math.sin(ra)); }
    for (d = -60; d <= 60; d += 30) { pts = []; for (k = 0; k < 64; k++) pts.push(P(k / 64 * 6.2832, d * Math.PI / 180)); g.add(line(pts, d === 0 ? C.orange : C.dim, d === 0 ? 1 : 0.8, true)); }
    for (a = 0; a < 360; a += 30) { pts = []; for (k = 0; k <= 48; k++) pts.push(P(a * Math.PI / 180, -1.5708 + k / 48 * 3.1416)); g.add(line(pts, C.dim, 0.8)); }
    var star = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), M(C.gold)); g.add(star);
    var ver = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), M(C.orange)); ver.position.copy(P(0, 0)); g.add(ver);
    var a1 = dyn(48, C.orange), a2 = dyn(48, C.green); g.add(a1, a2);
    g.rotation.x = 0.4;
    return { obj: g, cam: [0, 0.4, 6.2], spin: true, update: function (t) {
      var ra = 2.2 + 0.9 * Math.sin(t * 0.5), dec = 0.15 + 0.55 * Math.sin(t * 0.37), p1 = [], p2 = [];
      star.position.copy(P(ra, dec));
      for (var i = 0; i < 48; i++) { p1.push(P(ra * i / 47, 0, r * 1.004)); p2.push(P(ra, dec * i / 47, r * 1.004)); }
      setPts(a1, p1); setPts(a2, p2);
    } };
  };

  // 2. 102 spectral bands vs 3 RGB bars
  B.bands = function () {
    var g = new THREE.Group(), rgb = [0xff3b3b, 0x3bff6a, 0x3b6aff], rb = [], bars = [], i;
    for (i = 0; i < 3; i++) { var m = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1, 0.46), M(rgb[i])); m.position.x = -2.9 + i * 0.55; g.add(m); rb.push(m); }
    for (i = 0; i < 102; i++) { var b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03), M(hex(0.66 - 0.66 * i / 101, 0.9, 0.58))); b.position.x = -1.2 + i * 0.04; g.add(b); bars.push(b); }
    g.add(line([V(-3.2, 0, 0), V(3.0, 0, 0)], C.dim));
    g.position.y = -0.7;
    return { obj: g, cam: [0, 0.5, 8.2], spin: false, update: function (t) {
      var i, h;
      for (i = 0; i < 3; i++) { h = 1.3 + 0.12 * Math.sin(t * 2 + i); rb[i].scale.y = h; rb[i].position.y = h / 2; }
      for (i = 0; i < 102; i++) { h = 0.25 + 1.2 * (0.5 + 0.5 * Math.sin(i * 0.17 + t * 2.2)) * (0.6 + 0.4 * Math.sin(i * 0.05)); bars[i].scale.y = h; bars[i].position.y = h / 2; }
    } };
  };

  // 3. Level 2 pipeline: noisy raw frame turns into a calibrated one as a sweep passes
  B.pipeline = function () {
    var N = 64, ct = canvasTex(N, N, true), img = ct.ctx.createImageData(N, N), base = new Float32Array(N * N), noise = new Float32Array(N * N), i, j;
    var stars = [[14, 18, 1], [40, 12, 0.8], [28, 40, 1.1], [50, 46, 0.7], [10, 50, 0.6], [54, 24, 0.9]];
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var v = 0.08 + 0.05 * i / N;
      for (var s = 0; s < stars.length; s++) v += stars[s][2] * Math.exp(-((i - stars[s][0]) * (i - stars[s][0]) + (j - stars[s][1]) * (j - stars[s][1])) / 5);
      base[j * N + i] = v;
    }
    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: ct.tex })));
    g.add(line([V(-1.8, -1.8, 0.01), V(1.8, -1.8, 0.01), V(1.8, 1.8, 0.01), V(-1.8, 1.8, 0.01)], C.blue, 1, true));
    var sw = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 3.6), M(C.cyan)); sw.position.z = 0.02; g.add(sw);
    var lastN = -1;
    return { obj: g, cam: [0, 0, 6.2], spin: false, update: function (t) {
      if (t - lastN > 0.09) { lastN = t; for (var q = 0; q < N * N; q++) noise[q] = (rnd() - 0.5) * 0.55 + (rnd() < 0.004 ? 0.8 : 0); }
      var edge = ((t * 0.22) % 1.25) * N, d = img.data;
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var k = y * N + x, v = base[k];
        if (x >= edge) v += noise[k] + (x % 9 === 0 ? 0.15 : 0);
        v = clamp(v, 0, 1); var o = k * 4;
        d[o] = 255 * Math.min(1, v * 1.7); d[o + 1] = 255 * Math.pow(v, 1.6); d[o + 2] = 205 * Math.pow(v, 2.4); d[o + 3] = 255;
      }
      ct.ctx.putImageData(img, 0, 0); ct.tex.needsUpdate = true;
      sw.position.x = (edge / N - 0.5) * 3.6; sw.visible = edge < N;
    } };
  };

  // 4. TAP table: query a database, matching exposures fly out to the target
  B.tap = function () {
    var g = new THREE.Group(), i, tgt = V(2.4, 0, 0);
    for (i = 0; i < 3; i++) {
      var cg = new THREE.CylinderGeometry(0.75, 0.75, 0.32, 32), cyl = new THREE.Mesh(cg, M(0x1b3a7a));
      cyl.position.set(-2.7, -0.5 + i * 0.42, 0); g.add(cyl);
      var ed = edges(cg, C.blue); ed.position.copy(cyl.position); g.add(ed);
    }
    var ts = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M(C.gold)); ts.position.copy(tgt); g.add(ts);
    var ring = []; for (i = 0; i < 48; i++) ring.push(V(tgt.x + 0.4 * Math.cos(i / 48 * 6.2832), 0.4 * Math.sin(i / 48 * 6.2832), 0));
    g.add(line(ring, C.gold, 0.8, true));
    var offs = [[-0.3, 0.25, 0.1], [0.25, 0.3, -0.2], [0.4, -0.2, 0.15], [-0.25, -0.35, -0.08], [0.05, 0, 0.3], [0.5, 0.1, -0.12]], ex = [];
    offs.forEach(function (o, n) {
      var pg = new THREE.PlaneGeometry(0.9, 0.9), pm = M(C.blue, 0.4), pe = LM(C.cyan, 1);
      var grp = new THREE.Group(); grp.add(new THREE.Mesh(pg, pm), new THREE.LineSegments(new THREE.EdgesGeometry(pg), pe));
      grp.rotation.z = o[2]; grp.position.z = n * 0.03; g.add(grp); ex.push({ g: grp, pm: pm, pe: pe, o: o });
    });
    var pulse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), M(C.white)); g.add(pulse);
    return { obj: g, cam: [0, 0.4, 9.3], spin: false, update: function (t) {
      var ph = (t * 0.28) % 1.5;
      ex.forEach(function (e, n) {
        var p = clamp((ph * 1.25 - n * 0.09) / 0.7, 0, 1), s = p * p * (3 - 2 * p);
        e.g.position.x = -2.7 + (tgt.x + e.o[0] + 2.7) * s; e.g.position.y = e.o[1] * s;
        e.pm.opacity = 0.45 * s; e.pe.opacity = s; e.pe.transparent = true;
      });
      pulse.position.set(-2.7 + 5.1 * ((t * 0.5) % 1), 0, 0.2);
    } };
  };

  // 5. WCS: tilted frame rotates onto a north-up grid
  B.wcs = function () {
    var g = new THREE.Group(), G = new THREE.Group(), i;
    G.add(new THREE.GridHelper(3, 6, C.orange, 0x6b4a2a));
    var sq = []; [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].forEach(function (p) { sq.push(V(p[0], 0.01, p[1])); });
    G.add(line(sq, C.orange, 1, true));
    var a1 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 12), M(C.orange)); a1.rotation.x = -Math.PI / 2; a1.position.set(0, 0, -1.7); G.add(a1);
    g.add(G);
    var ref = []; [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].forEach(function (p) { ref.push(V(p[0], 0.02, p[1])); });
    g.add(line(ref, C.cyan, 0.55, true));
    var a2 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 14), M(C.cyan)); a2.rotation.x = -Math.PI / 2; a2.position.set(0, 0, -2.15); g.add(a2);
    var n = sprite("N", "#4de0ff", 0.7); n.position.set(0, 0.1, -2.7); g.add(n);
    return { obj: g, cam: [0, 5.4, 4.2], spin: false, update: function (t) { G.rotation.y = 0.7 * (0.5 + 0.5 * Math.cos(t * 0.9)); } };
  };

  // 6. ZODI: zodiacal glow fades out, leaving faint stars and moving objects
  B.zodi = function () {
    var W = 256, H = 192, ct = canvasTex(W, H), i, st = [];
    for (i = 0; i < 46; i++) st.push([(i * 97.3) % W, (i * 61.7 + 13) % H, 0.6 + (i * 0.37 % 1.4), 0.35 + (i * 0.173 % 0.65)]);
    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.85), new THREE.MeshBasicMaterial({ map: ct.tex })));
    g.add(line([V(-1.9, -1.425, 0.01), V(1.9, -1.425, 0.01), V(1.9, 1.425, 0.01), V(-1.9, 1.425, 0.01)], C.blue, 1, true));
    return { obj: g, cam: [0, 0, 6.2], spin: false, update: function (t) {
      var x = ct.ctx, k = 0.5 + 0.5 * Math.cos(t * 0.7), s;
      x.fillStyle = "#05070d"; x.fillRect(0, 0, W, H);
      x.save(); x.translate(W / 2, H / 2); x.rotate(-0.45);
      var gr = x.createLinearGradient(0, -80, 0, 80);
      gr.addColorStop(0, "rgba(255,150,70,0)"); gr.addColorStop(0.5, "rgba(255,175,95," + (0.6 * k) + ")"); gr.addColorStop(1, "rgba(255,150,70,0)");
      x.fillStyle = gr; x.fillRect(-260, -80, 520, 160); x.restore();
      for (s = 0; s < st.length; s++) { x.fillStyle = "rgba(255,255,255," + st[s][3] + ")"; x.beginPath(); x.arc(st[s][0], st[s][1], st[s][2], 0, 6.2832); x.fill(); }
      for (s = 0; s < 3; s++) {
        var px = (40 + s * 80 + t * (6 + s * 3)) % W, py = 50 + s * 45;
        x.strokeStyle = "rgba(77,224,255,.5)"; x.beginPath(); x.moveTo(px - 12, py + 3); x.lineTo(px, py); x.stroke();
        x.fillStyle = "#4de0ff"; x.beginPath(); x.arc(px, py, 2, 0, 6.2832); x.fill();
      }
      ct.tex.needsUpdate = true;
    } };
  };

  // 7. Gaia: spiral star map with proper-motion vectors
  B.gaia = function () {
    var g = new THREE.Group(), n = 3600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color(), i, seg = [];
    for (i = 0; i < n; i++) {
      var arm = i % 3, r = 0.15 + Math.pow(rnd(), 0.75) * 2.7, th = r * 1.5 + arm * 2.094 + (rnd() - 0.5) * 0.7 * (0.4 + r * 0.2);
      pos[i * 3] = r * Math.cos(th); pos[i * 3 + 1] = (rnd() - 0.5) * 0.5 * Math.exp(-r * 0.4); pos[i * 3 + 2] = r * Math.sin(th);
      if (r < 0.8) c.setHSL(0.1, 0.7, 0.7); else c.setHSL(0.58 + rnd() * 0.08, 0.6, 0.62);
      col.set([c.r, c.g, c.b], i * 3);
      if (i % 55 === 0) { var tx = -Math.sin(th) * 0.28, tz = Math.cos(th) * 0.28; seg.push(V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), V(pos[i * 3] + tx, pos[i * 3 + 1], pos[i * 3 + 2] + tz)); }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.95 })));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), LM(C.gold, 0.9)));
    g.rotation.x = 0.55;
    return { obj: g, cam: [0, 1.2, 8], spin: true, update: function () {} };
  };

  // 8. Covered channels: 17 of 102 lit
  B.covered = function () {
    var g = new THREE.Group(), lit = {}, cnt = 0, seed = 7, i, cells = [];
    while (cnt < 17) { seed = (seed * 48271) % 2147483647; var k = seed % 102; if (!lit[k]) { lit[k] = 1; cnt++; } }
    for (i = 0; i < 102; i++) {
      var col = i % 17, row = Math.floor(i / 17), on = !!lit[i];
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.12), M(on ? hex(0.66 - 0.66 * col / 16, 0.9, 0.6) : 0x1c2542));
      m.position.set((col - 8) * 0.34, (2.5 - row) * 0.34, 0); g.add(m); cells.push({ m: m, on: on, ph: i * 0.7 });
    }
    return { obj: g, cam: [0, 0, 9], spin: false, update: function (t) {
      cells.forEach(function (c) { if (c.on) { var s = 1 + 0.35 * Math.sin(t * 3 + c.ph); c.m.scale.z = s * 2; c.m.position.z = 0.06 * s; } });
    } };
  };

  // 9. Peak flux: spectrum curve with the peak marked
  B.flux = function () {
    var g = new THREE.Group(), n = 102, i, pos = new Float32Array(n * 2 * 3), colr = new Float32Array(n * 2 * 3), idx = [];
    function f(x) { return 0.15 + 1.75 * Math.exp(-Math.pow((x - 0.7) / 0.85, 2)) + 0.12 * Math.exp(-Math.pow((x + 1.8) / 0.5, 2)); }
    var c = new THREE.Color();
    for (i = 0; i < n; i++) {
      var x = -3 + 6 * i / (n - 1);
      pos.set([x, 0, 0, x, f(x), 0], i * 6);
      colr.set([0.08, 0.12, 0.28], i * 6); c.setHSL(0.66 - 0.66 * i / (n - 1), 0.9, 0.6); colr.set([c.r, c.g, c.b], i * 6 + 3);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(colr, 3)); geo.setIndex(idx);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })));
    var pk = 62, px = -3 + 6 * pk / (n - 1), py = f(px);
    var mk = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), M(C.white)); mk.position.set(px, py, 0.05); g.add(mk);
    var dash = []; for (var y = 0; y < py; y += 0.13) dash.push(V(px, y, 0.02), V(px, Math.min(py, y + 0.07), 0.02));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dash), LM(C.white, 0.7)));
    g.add(line([V(-3.2, 0, 0), V(3.2, 0, 0)], C.dim)); g.add(line([V(-3.2, 0, 0), V(-3.2, 2.3, 0)], C.dim));
    g.position.y = -0.9;
    return { obj: g, cam: [0, 0.6, 8.8], spin: false, update: function (t) {
      mk.scale.setScalar(1 + 0.25 * Math.sin(t * 4));
      var a = geo.attributes.position;
      for (var i = 0; i < n; i++) { var x = -3 + 6 * i / (n - 1); a.setY(i * 2 + 1, f(x) + 0.03 * Math.sin(i * 0.7 + t * 3) * (i === pk ? 0 : 1)); }
      a.needsUpdate = true;
    } };
  };

  // 10. SNR: noisy signal with a peak near the 5-sigma threshold
  B.snr = function () {
    var g = new THREE.Group(), N = 140, u = 0.3, lineD = dyn(N, C.cyan), noise = new Float32Array(N), last = -1;
    g.add(lineD);
    var band = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2 * u), M(0x8896b8, 0.18)); g.add(band);
    var th = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.04), M(C.green, 0.9)); th.position.y = 5 * u; g.add(th);
    g.add(line([V(-3.2, 0, 0), V(3.2, 0, 0)], C.dim, 0.8));
    g.position.y = -0.55;
    return { obj: g, cam: [0, 0.3, 8.8], spin: false, update: function (t) {
      if (t - last > 0.07) { last = t; for (var i = 0; i < N; i++) noise[i] = gauss(); }
      var p = [];
      for (var j = 0; j < N; j++) { var x = -3.2 + 6.4 * j / (N - 1); p.push(V(x, (5.1 * Math.exp(-Math.pow(x / 0.45, 2)) + noise[j]) * u, 0)); }
      setPts(lineD, p);
    } };
  };

  // 11. Aperture: star profile over a pixel grid, circle of one pixel radius
  B.aperture = function () {
    var g = new THREE.Group(), i;
    g.add(new THREE.GridHelper(6, 6, 0x4a5a88, 0x2a3558));
    var pg = new THREE.PlaneGeometry(3.2, 3.2, 40, 40); pg.rotateX(-Math.PI / 2);
    var p = pg.attributes.position;
    for (i = 0; i < p.count; i++) { var x = p.getX(i), z = p.getZ(i); p.setY(i, 1.1 * Math.exp(-(x * x + z * z) / 0.3)); }
    g.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffb347, wireframe: true, transparent: true, opacity: 0.75 })));
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), M(C.gold)); core.position.y = 1.12; g.add(core);
    var disk = new THREE.Mesh(new THREE.CircleGeometry(1, 64), M(C.cyan, 0.12)); disk.rotation.x = -Math.PI / 2; disk.position.y = 0.01; g.add(disk);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), M(C.cyan)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    g.add(line([V(0, 0.03, 0), V(1, 0.03, 0)], C.white));
    var lab = sprite("6.2\u2033", "#ffffff", 0.9); lab.position.set(0.55, 0.3, 0.2); g.add(lab);
    [[2.3, -0.8], [-2.1, 1.5], [-1.6, -2.2], [1.9, 2.1]].forEach(function (s) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M(0xaad4ff)); m.position.set(s[0], 0.12, s[1]); g.add(m);
    });
    g.rotation.x = 0.1;
    return { obj: g, cam: [0, 4.6, 5.6], spin: true, update: function (t) { ring.scale.set(1 + 0.02 * Math.sin(t * 3), 1 + 0.02 * Math.sin(t * 3), 1); } };
  };

  // ---------- shared renderer, one scene per canvas ----------
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = [];
  document.querySelectorAll("canvas.part-canvas").forEach(function (cv) {
    var build = B[cv.getAttribute("data-m")];
    if (!build) return;
    var b = build(), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100), pivot = new THREE.Group();
    pivot.add(b.obj); scene.add(pivot);
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
    var t = reduce ? 1.5 : (now - T0) / 1000;
    items.forEach(function (it) {
      if (!it.visible) return;
      if (it.b.spin && !it.drag && !reduce) it.spin += dt * 0.3;
      it.pivot.rotation.y = (it.b.spin ? it.spin : 0.3 * Math.sin(t * 0.4)) + it.dx;
      it.pivot.rotation.x = it.dy;
      it.b.update(t, dt);
      R.render(it.scene, it.cam);
      it.ctx.clearRect(0, 0, SIZE, SIZE);
      it.ctx.drawImage(R.domElement, 0, 0, SIZE, SIZE);
    });
  }
  requestAnimationFrame(frame);
})();
