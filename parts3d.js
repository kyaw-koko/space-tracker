/* parts3d.js: procedural 3D models for the About page (needs three.js r128).
   Each <canvas class="part-canvas" data-part="detector|focal|shield"> gets a slowly
   rotating model. Hover or drag to tilt it. Rendering pauses when off screen. */
(function () {
  if (!window.THREE) return;

  function chipTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, "#14346d");
    grad.addColorStop(1, "#08162f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(143,168,255,.35)";
    g.lineWidth = 1;
    for (var i = 0; i <= 128; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    return new THREE.CanvasTexture(c);
  }

  var tex = chipTexture();
  var chipMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.35 });
  var gold = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.8, roughness: 0.35 });

  function chip(w, h, d, x, y, z) {
    var g = new THREE.Group();
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), chipMat);
    var e = new THREE.LineSegments(
      new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color: 0xd9b25a })
    );
    g.add(m, e);
    g.position.set(x, y, z);
    return g;
  }

  function tube(x1, y1, z1, x2, y2, z2, color) {
    var a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    var len = a.distanceTo(b);
    var m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, len, 8),
      new THREE.MeshBasicMaterial({ color: color })
    );
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }

  // Six 2K x 2K HgCdTe arrays on one board (3 columns x 2 rows)
  function buildDetector() {
    var g = new THREE.Group();
    var board = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 2.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a2236, metalness: 0.3, roughness: 0.6 })
    );
    board.position.z = -0.09;
    g.add(board);
    for (var r = 0; r < 2; r++)
      for (var c = 0; c < 3; c++) g.add(chip(0.95, 0.95, 0.06, (c - 1) * 1.1, (r - 0.5) * 1.1, 0));
    g.rotation.x = -0.5;
    return { group: g, cam: 6 };
  }

  // Two 1x3 mosaics split by a dichroic beam splitter
  function buildFocal() {
    var g = new THREE.Group();
    var split = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.04, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.35, metalness: 0.9, roughness: 0.1 })
    );
    split.rotation.z = Math.PI / 4; // acts like a "/" mirror
    g.add(split);
    g.add(tube(-3.2, 0, 0, 0, 0, 0, 0xffffff));   // incoming light
    g.add(tube(0, 0, 0, 0, 2.5, 0, 0x5aa8ff));    // short wavelengths reflect up
    g.add(tube(0, 0, 0, 2.7, 0, 0, 0xff6a3d));    // long wavelengths pass through
    for (var i = -1; i <= 1; i++) {
      g.add(chip(0.7, 0.06, 0.7, i * 0.8, 2.7, 0));  // mosaic A (top)
      g.add(chip(0.06, 0.7, 0.7, 2.9, 0, i * 0.8));  // mosaic B (right)
    }
    g.scale.setScalar(0.85);
    g.position.set(0, -1.2, 0);
    g.rotation.x = 0.35;
    return { group: g, cam: 8.5 };
  }

  // Three nested V-groove cones above the spacecraft bus
  function buildShield() {
    var g = new THREE.Group();
    var bus = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), gold);
    bus.position.y = -1.1;
    g.add(bus);
    var cols = [0xc9b08a, 0x9fb3d6, 0x6f8fd8];
    for (var i = 0; i < 3; i++) {
      var cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 1.9 - i * 0.28, 0.8, 56, 1, true),
        new THREE.MeshStandardMaterial({ color: cols[i], metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      cone.position.y = -0.55 + i * 0.5;
      g.add(cone);
    }
    var scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 1.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x0c1226, metalness: 0.6, roughness: 0.4 })
    );
    scope.position.y = 0.75;
    g.add(scope);
    var cap = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshBasicMaterial({ color: 0x5aa8ff }));
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 1.41;
    g.add(cap);
    g.position.y = 0.1;
    g.rotation.x = 0.25;
    return { group: g, cam: 7 };
  }

  var builders = { detector: buildDetector, focal: buildFocal, shield: buildShield };

  document.querySelectorAll("canvas.part-canvas").forEach(function (canvas) {
    var build = builders[canvas.dataset.part];
    if (!build) return;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    var built = build();
    camera.position.set(0, 0.6, built.cam);
    camera.lookAt(0, 0, 0);

    var pivot = new THREE.Group();
    pivot.add(built.group);
    scene.add(pivot);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
    var key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    var rim = new THREE.PointLight(0x5aa8ff, 1.2, 30);
    rim.position.set(-4, -2, 3);
    scene.add(rim);

    var drag = null, tiltX = 0, tiltY = 0, spin = 0, visible = false;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return;
      spin += (e.clientX - drag.x) * 0.01;
      tiltX = Math.max(-0.8, Math.min(0.8, tiltX + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", function () { drag = null; });

    function size() {
      var w = canvas.clientWidth || 480;
      renderer.setSize(w, w, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", size);
    size();

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(canvas);

    var last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible) return;
      if (!drag && !reduce) spin += dt * 0.4;
      pivot.rotation.y = spin;
      pivot.rotation.x = tiltX;
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  });
})();
