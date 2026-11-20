/* مشهد Three.js ثلاثي الأبعاد لتصميم حظيرة التسمين في مناخ الشرقية (بدون إضافات خارجية) */
window.BarnScene3D = (function () {
  let initialized = false;
  let running = false;
  let animId = null;
  let season = 'summer';

  let scene, camera, renderer, dirLight, hemiLight;
  let airflowGroup, fanBlades = [], sprayDrops = [], sprayMesh;
  let containerEl = null;

  // إحداثيات كروية للتحكم باللمس والماوس
  const camState = { theta: 0.72, phi: 1.04, radius: 19.5, dragging: false, lastX: 0, lastY: 0, pinchDist: 0 };
  const target = { x: 1.2, y: 1.4, z: 0 };

  function updateCamera() {
    if (!camera) return;
    camState.phi = Math.max(0.28, Math.min(1.42, camState.phi));
    camState.radius = Math.max(9, Math.min(34, camState.radius));
    camera.position.x = target.x + camState.radius * Math.sin(camState.phi) * Math.cos(camState.theta);
    camera.position.y = target.y + camState.radius * Math.cos(camState.phi);
    camera.position.z = target.z + camState.radius * Math.sin(camState.phi) * Math.sin(camState.theta);
    camera.lookAt(target.x, target.y, target.z);
  }

  function buildCalf(colorHex, x, z, rotY) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.8 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.72, 0.58), mat);
    body.position.y = 0.85;
    g.add(body);

    // بقعة خليط فريزيان
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.73, 0.59), whiteMat);
    patch.position.set(0.1, 0.85, 0);
    g.add(patch);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.34), mat);
    head.position.set(0.84, 1.02, 0);
    g.add(head);

    const legGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
    [[-0.48, -0.18], [-0.48, 0.18], [0.48, -0.18], [0.48, 0.18]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, 0.28, lz);
      g.add(leg);
    });

    g.position.set(x, 0.08, z);
    g.rotation.y = rotY;
    return g;
  }

  function buildBarn() {
    // 1. الأرضية العامة (تربة/رمل)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 34),
      new THREE.MeshStandardMaterial({ color: 0xd9ccb2, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 2. البلاطة الخرسانية للحظيرة شبه المغلقة (11م × 9م) بميل تصريف بصري
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(11.4, 0.16, 9.2),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.9 })
    );
    slab.position.set(-0.5, 0.08, 0);
    slab.rotation.x = 0.025; // ميل تصريف ~2.5% نحو المجرى
    scene.add(slab);

    // مجرى صرف خلفي
    const drain = new THREE.Mesh(
      new THREE.BoxGeometry(11.4, 0.06, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    drain.position.set(-0.5, 0.06, 4.75);
    scene.add(drain);

    // 3. أعمدة الحظيرة (ارتفاع 4.2 متر للتهوية)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 4.3, 8);
    [-6, -2.3, 1.4, 5.1].forEach((px) => {
      [-4.2, 4.2].forEach((pz) => {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, 2.15, pz);
        scene.add(post);
      });
    });

    // 4. السقف المظلل الموجه شرق–غرب مع شخشيخة تهوية علوية
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide });
    const roofNorth = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.1, 4.6), roofMat);
    roofNorth.position.set(-0.45, 4.45, -2.3);
    roofNorth.rotation.x = -0.18;
    scene.add(roofNorth);

    const roofSouth = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.1, 4.6), roofMat);
    roofSouth.position.set(-0.45, 4.45, 2.3);
    roofSouth.rotation.x = 0.18;
    scene.add(roofSouth);

    // الشخشيخة العلوية لخروج الهواء الساخن
    const ridgeCap = new THREE.Mesh(
      new THREE.BoxGeometry(12.2, 0.1, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.65 })
    );
    ridgeCap.position.set(-0.45, 5.25, 0);
    scene.add(ridgeCap);

    // 5. السياج المحيطي (مواسير مفتوحة للتهوية)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5 });
    [0.65, 1.25].forEach((ry) => {
      const sideWest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 8.4), railMat);
      sideWest.position.set(-6, ry, 0);
      scene.add(sideWest);
      const sideEast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 8.4), railMat);
      sideEast.position.set(5.1, ry, 0);
      scene.add(sideEast);
      const sideBack = new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.08, 0.08), railMat);
      sideBack.position.set(-0.45, ry, 4.2);
      scene.add(sideBack);
    });

    // 6. المعلف الطولي (11 مترًا على الواجهة الشمالية) + العليقة المخلوطة
    const bunk = new THREE.Mesh(
      new THREE.BoxGeometry(11.0, 0.62, 0.85),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.85 })
    );
    bunk.position.set(-0.45, 0.42, -4.35);
    scene.add(bunk);

    const feed = new THREE.Mesh(
      new THREE.BoxGeometry(10.6, 0.22, 0.56),
      new THREE.MeshStandardMaterial({ color: 0xd9a12b, roughness: 0.95 })
    );
    feed.position.set(-0.45, 0.72, -4.35);
    scene.add(feed);

    // 7. المشرب المظلل على بلاطة منفصلة بعيدًا عن المعلف
    const troughBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.24, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x64748b })
    );
    troughBase.position.set(-3.8, 0.18, 3.15);
    scene.add(troughBase);

    const trough = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.55, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.5 })
    );
    trough.position.set(-3.8, 0.56, 3.15);
    scene.add(trough);

    const waterSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(2.02, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.2 })
    );
    waterSurface.rotation.x = -Math.PI / 2;
    waterSurface.position.set(-3.8, 0.85, 3.15);
    scene.add(waterSurface);

    // 8. حظيرة العزل والحجر الصحي (منفصلة ناحية الشرق)
    const isoFloor = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, 0.16, 4.2),
      new THREE.MeshStandardMaterial({ color: 0xfecaca, roughness: 0.9 })
    );
    isoFloor.position.set(9.2, 0.08, -0.4);
    scene.add(isoFloor);

    const isoRoof = new THREE.Mesh(
      new THREE.BoxGeometry(4.3, 0.1, 4.5),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.7 })
    );
    isoRoof.position.set(9.2, 3.25, -0.4);
    scene.add(isoRoof);

    [[7.3, -2.3], [11.1, -2.3], [7.3, 1.5], [11.1, 1.5]].forEach(([x, z]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), postMat);
      p.position.set(x, 1.6, z);
      scene.add(p);
    });
    scene.add(buildCalf(0x7c2d12, 9.1, -0.4, 2.2));

    // 9. قطيع عجول خليط متوزع على المعلف وفي الظل
    const calves = [
      [0x292524, -4.4, -2.8, Math.PI / 2],
      [0x78350f, -2.6, -2.8, Math.PI / 2],
      [0x1c1917, -0.8, -2.8, Math.PI / 2],
      [0x92400e, 1.0, -2.8, Math.PI / 2],
      [0x292524, 2.8, -2.8, Math.PI / 2],
      [0x57534e, -1.6, 0.5, 0.4],
      [0x78350f, 1.5, 1.1, -0.7],
      [0x292524, 3.4, 1.8, 2.6]
    ];
    calves.forEach(([c, x, z, r]) => scene.add(buildCalf(c, x, z, r)));

    // 10. مراوح تبريد على خط المعلف (تعمل في وضع الصيف)
    fanBlades = [];
    [-3.2, 0.2, 3.2].forEach((fx) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.05, 8, 18),
        new THREE.MeshStandardMaterial({ color: 0x1e293b })
      );
      ring.position.set(fx, 3.1, -3.4);
      ring.rotation.x = 0.25;
      scene.add(ring);

      const bladeGroup = new THREE.Group();
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.1, 0.03), new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.03), new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
      bladeGroup.add(b1, b2);
      bladeGroup.position.copy(ring.position);
      bladeGroup.rotation.x = 0.25;
      scene.add(bladeGroup);
      fanBlades.push(bladeGroup);
    });

    // 11. رشاشات تبريد خشنة متقطعة فوق ممر الأكل فقط (بعيدة عن المشرب)
    const dropPositions = [];
    sprayDrops = [];
    for (let i = 0; i < 60; i++) {
      const x = -4.8 + Math.random() * 9.0;
      const y = 0.8 + Math.random() * 2.2;
      const z = -3.2 + Math.random() * 1.4;
      dropPositions.push(x, y, z);
      sprayDrops.push({ x, y, z, speed: 0.03 + Math.random() * 0.03 });
    }
    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute('position', new THREE.Float32BufferAttribute(dropPositions, 3));
    sprayMesh = new THREE.Points(
      sprayGeo,
      new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.14, transparent: true, opacity: 0.85 })
    );
    scene.add(sprayMesh);

    // 12. أسهم تيار الهواء الشمالي الغربي
    airflowGroup = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.82 });
    for (let i = 0; i < 10; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.65, 8), arrowMat);
      cone.rotation.x = Math.PI / 2;
      cone.userData = {
        baseX: -5 + (i % 5) * 2.3,
        phase: (i * 0.37) % 1,
        lane: i < 5 ? 'low' : 'ridge'
      };
      airflowGroup.add(cone);
    }
    scene.add(airflowGroup);
  }

  function applySeason(mode) {
    season = mode;
    if (!scene) return;
    const hud = document.getElementById('hud-season-text');
    if (mode === 'summer') {
      scene.background = new THREE.Color(0xdbeafe);
      dirLight.color.setHex(0xfff7ed);
      dirLight.intensity = 1.35;
      dirLight.position.set(5, 18, 4); // شمس صيفية عالية
      if (sprayMesh) sprayMesh.visible = true;
      if (hud) hud.textContent = '☀️ صيف الشرقية (THI > 84): المراوح + رشاشات ممر الأكل فعّالة، وتصريف الهواء الساخن من الشخشيخة';
    } else {
      scene.background = new THREE.Color(0xcbd5e1);
      dirLight.color.setHex(0xffe8c2);
      dirLight.intensity = 0.95;
      dirLight.position.set(10, 9, 12); // شمس شتوية مائلة دافئة
      if (sprayMesh) sprayMesh.visible = false;
      if (hud) hud.textContent = '❄️ شتاء الشرقية (صغرى 6–9°م): إيقاف الرشاشات والمراوح، تجفيف الفرشة، والاستفادة من شمس الجنوب';
    }
  }

  function animate() {
    if (!running) return;
    animId = requestAnimationFrame(animate);

    // حركة المراوح والرشاشات صيفًا
    if (season === 'summer') {
      fanBlades.forEach((b) => { b.rotation.z += 0.22; });
      if (sprayMesh) {
        const pos = sprayMesh.geometry.attributes.position.array;
        for (let i = 0; i < sprayDrops.length; i++) {
          sprayDrops[i].y -= sprayDrops[i].speed;
          if (sprayDrops[i].y < 0.7) sprayDrops[i].y = 3.0;
          pos[i * 3 + 1] = sprayDrops[i].y;
        }
        sprayMesh.geometry.attributes.position.needsUpdate = true;
      }
    }

    // حركة تيار الهواء الطبيعي
    if (airflowGroup) {
      airflowGroup.children.forEach((arrow) => {
        const u = arrow.userData;
        u.phase = (u.phase + (season === 'summer' ? 0.006 : 0.0035)) % 1;
        arrow.position.x = u.baseX + u.phase * 1.4;
        if (u.lane === 'low') {
          arrow.position.z = -5.5 + u.phase * 10.2;
          arrow.position.y = 2.0 + Math.sin(u.phase * Math.PI) * 0.4;
          arrow.rotation.x = Math.PI / 2;
        } else {
          arrow.position.z = -1.5 + u.phase * 2.2;
          arrow.position.y = 3.0 + u.phase * 2.6;
          arrow.rotation.x = 0.25;
        }
      });
    }

    renderer.render(scene, camera);
  }

  function bindPointerEvents(dom) {
    dom.addEventListener('pointerdown', (e) => {
      camState.dragging = true;
      camState.lastX = e.clientX;
      camState.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => { camState.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!camState.dragging || !running) return;
      const dx = e.clientX - camState.lastX;
      const dy = e.clientY - camState.lastY;
      camState.lastX = e.clientX;
      camState.lastY = e.clientY;
      camState.theta += dx * 0.008;
      camState.phi -= dy * 0.008;
      updateCamera();
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      camState.radius += e.deltaY * 0.015;
      updateCamera();
    }, { passive: false });

    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        camState.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && camState.pinchDist > 0) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        camState.radius -= (d - camState.pinchDist) * 0.04;
        camState.pinchDist = d;
        updateCamera();
      }
    }, { passive: true });
  }

  function init(container) {
    containerEl = container;
    const fallback = document.getElementById('scene3d-fallback');
    if (typeof window.THREE === 'undefined') {
      if (fallback) fallback.hidden = false;
      return false;
    }
    if (fallback) fallback.hidden = true;

    if (!initialized) {
      scene = new THREE.Scene();
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 420;
      camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 120);
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      container.insertBefore(renderer.domElement, container.firstChild);

      hemiLight = new THREE.HemisphereLight(0xffffff, 0x8d7b68, 0.85);
      scene.add(hemiLight);
      dirLight = new THREE.DirectionalLight(0xfff7ed, 1.25);
      scene.add(dirLight);

      buildBarn();
      bindPointerEvents(renderer.domElement);
      updateCamera();
      applySeason(season);

      window.addEventListener('resize', () => {
        if (!renderer || !containerEl || containerEl.offsetParent === null) return;
        const nw = containerEl.clientWidth;
        const nh = containerEl.clientHeight;
        if (nw > 0 && nh > 0) {
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
      });

      initialized = true;
    }
    start();
    return true;
  }

  function start() {
    if (!initialized || running) return;
    running = true;
    animate();
  }

  function stop() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
  }

  function resetCamera() {
    camState.theta = 0.72;
    camState.phi = 1.04;
    camState.radius = 19.5;
    updateCamera();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  return {
    init,
    start,
    stop,
    isRunning: () => running,
    setSeason: applySeason,
    resetCamera
  };
})();