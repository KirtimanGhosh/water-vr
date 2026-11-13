/* Water VR — phases of water from a beaker down to molecules. Rendering, stereo, sensors, tour, narration. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wvr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wvr_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const cfg = {
    ipd: store.get('ipd', 63), sp: store.get('sp', 3), style: store.get('style', 0), hb: store.get('hb', true), trail: store.get('trail', true),
    lang: store.get('lang', 'en'), narr: store.get('narr', true), diag: store.get('diag', true),
  };
  const SPEEDS = [0, 0.25, 0.5, 1, 2, 4, 8, 16];
  const TOUR = window.TOUR, PH = window.PhaseEq;
  const msg = (t, ms) => { const m = $('msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; if (ms) setTimeout(() => { if (m.textContent === t) m.style.display = 'none'; }, ms); };
  window.addEventListener('error', (e) => msg('Error: ' + e.message, 6000));

  // ---------- renderer, scene, camera ----------
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const BG_MACRO = new THREE.Color(0x2a3644), BG_MOL = new THREE.Color(0x0a2440);
  scene.background = BG_MACRO.clone();
  scene.fog = new THREE.Fog(BG_MOL.clone(), 1000, 2000);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.004, 60);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x3a3226, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.6, 1.2, 0.4); scene.add(sun);
  const head = new THREE.DirectionalLight(0xffffff, 0.9); head.position.set(0.3, 0.4, 1); camera.add(head); camera.add(head.target);

  function label(text, w = 0.16, color = '#ffffff', bg = 'rgba(10,25,40,0.75)') {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
    c.fillStyle = bg; c.beginPath(); c.roundRect ? c.roundRect(4, 4, 504, 120, 24) : c.rect(4, 4, 504, 120); c.fill();
    c.fillStyle = color; c.font = '600 46px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 66);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    sp.scale.set(w, w / 4, 1); return sp;
  }

  // ---------- macro world: room, table and the apparatus for each phase ----------
  const macro = new THREE.Group(); scene.add(macro);
  const TY = -0.12, TZ = -0.33;            // table top height, apparatus distance
  {
    const floorY = TY - 0.76;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a40, roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.8), wood); top.position.set(0, TY - 0.015, -0.5); macro.add(top);
    for (const [lx, lz] of [[-0.65, -0.14], [0.65, -0.14], [-0.65, -0.86], [0.65, -0.86]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.73, 0.05), wood); leg.position.set(lx, floorY + 0.365, lz); macro.add(leg); }
    const wall = (c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), [wall(0xc9d3dc), wall(0xc9d3dc), wall(0xeef2f5), wall(0x5d6670), wall(0xb7c4cf), wall(0xb7c4cf)]);
    room.position.set(0, floorY + 1.5, 0); macro.add(room);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ color: 0xbfe3ff })); win.position.set(0, floorY + 1.7, -2.49); macro.add(win);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), new THREE.MeshStandardMaterial({ color: 0x23402f, roughness: 0.9 })); board.position.set(0, floorY + 1.5, 2.49); board.rotation.y = Math.PI; macro.add(board);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 1.4), new THREE.MeshStandardMaterial({ color: 0x8a6a4f })); shelf.position.set(-2.34, floorY + 0.9, 0); macro.add(shelf);
    const lamp = new THREE.PointLight(0xffffff, 6, 0, 1.4); lamp.position.set(0, floorY + 2.8, 0); macro.add(lamp);
  }
  const glassMat = new THREE.MeshPhongMaterial({ color: 0xdcecff, transparent: true, opacity: 0.2, shininess: 140, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  const SCENES = {};
  function addScene(name, focus) { const g = new THREE.Group(); g.visible = false; macro.add(g); SCENES[name] = { g, focus }; return g; }

  // beaker with real-time standing capillary–gravity waves
  const BK = { R: 0.04, H: 0.11, h: 0.08 };
  function besselJ(m, x) { let s = 0, term = Math.pow(x / 2, m); for (let k = 1; k <= m; k++) term /= k; for (let k = 0; k < 40; k++) { s += term; term *= -(x * x / 4) / ((k + 1) * (k + 1 + m)); if (Math.abs(term) < 1e-14) break; } return s; }
  const ROOTS = [[1, 1.8412], [2, 3.0542], [0, 3.8317], [3, 4.2012], [1, 5.3314], [4, 5.3176], [2, 6.7061], [0, 7.0156]];
  const modes = ROOTS.map(([m, j], i) => { const k = j / BK.R, w = Math.sqrt((9.81 * k + 0.0728 / 998 * k * k * k) * Math.tanh(k * BK.h)); return { m, k, w, beta: Math.sqrt(1e-6 * w / 2) / BK.R, psi: Math.random() * 6.283, phi: Math.random() * 6.283, A0: 0.00018 / (1 + 0.4 * i), At: 0, t0: 0 }; });
  function makeBeaker(withBubbles) {
    const g = new THREE.Group(); g.position.set(0, TY, TZ);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(BK.R + 0.0018, BK.R + 0.0018, BK.H, 64, 1, true), glassMat); glass.position.y = BK.H / 2; glass.renderOrder = 3; g.add(glass);
    const gb = new THREE.Mesh(new THREE.CircleGeometry(BK.R + 0.0018, 64), glassMat); gb.rotation.x = -Math.PI / 2; gb.position.y = 0.0004; g.add(gb);
    const p = [];
    for (let i = 1; i <= 10; i++) { const y = i * 0.01, a0 = Math.PI * 0.62, a1 = a0 + (i % 5 ? 0.18 : 0.32); for (let k = 0; k < 8; k++) { const t0 = a0 + (a1 - a0) * k / 8, t1 = a0 + (a1 - a0) * (k + 1) / 8, r = BK.R + 0.002; p.push(r * Math.cos(t0), y, r * Math.sin(t0), r * Math.cos(t1), y, r * Math.sin(t1)); } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
    const wm = new THREE.MeshPhongMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.5, shininess: 60, side: THREE.DoubleSide, depthWrite: false });
    const ws = new THREE.Mesh(new THREE.CylinderGeometry(BK.R, BK.R, BK.h, 64, 1, true), wm); ws.position.y = BK.h / 2; ws.renderOrder = 1; g.add(ws);
    // free surface
    const NRr = 22, NTt = 72, geo = new THREE.BufferGeometry(), pos = new Float32Array((1 + NRr * NTt) * 3), R = [0], Th = [0], idx = [];
    for (let i = 1; i <= NRr; i++) for (let j = 0; j < NTt; j++) { R.push(BK.R * 0.997 * i / NRr); Th.push(2 * Math.PI * j / NTt); }
    for (let j = 0; j < NTt; j++) idx.push(0, 1 + (j + 1) % NTt, 1 + j);
    for (let i = 1; i < NRr; i++) for (let j = 0; j < NTt; j++) { const a = 1 + (i - 1) * NTt + j, b = 1 + (i - 1) * NTt + (j + 1) % NTt, c = 1 + i * NTt + j, d = 1 + i * NTt + (j + 1) % NTt; idx.push(a, b, d, a, d, c); }
    geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (let v = 0; v < R.length; v++) { pos[3 * v] = R[v] * Math.cos(Th[v]); pos[3 * v + 2] = R[v] * Math.sin(Th[v]); }
    const basis = modes.map((md) => R.map((r, v) => besselJ(md.m, md.k * r) * Math.cos(md.m * Th[v] + md.psi)));
    const surf = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x6fb8ee, transparent: true, opacity: 0.78, shininess: 200, specular: 0xffffff, side: THREE.DoubleSide }));
    surf.renderOrder = 2; g.add(surf);
    g.userData.update = (t) => {
      const boost = withBubbles ? 4 : 1;
      const amp = modes.map((md) => boost * (md.A0 + md.At * Math.exp(-md.beta * (t - md.t0))) * Math.cos(md.w * t + md.phi));
      for (let v = 0; v < R.length; v++) { let e = 0; for (let i = 0; i < modes.length; i++) e += amp[i] * basis[i][v]; pos[3 * v + 1] = BK.h + e; }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    };
    if (withBubbles) {
      // vapour bubbles rising at an approximately constant terminal speed (drawn approximately)
      const NB = 70, bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, shininess: 120 }), NB);
      const bs = Array.from({ length: NB }, () => ({ x: (Math.random() - 0.5) * 1.4 * BK.R, z: (Math.random() - 0.5) * 1.4 * BK.R, y: Math.random() * BK.h, r: 0.0008 + Math.random() * 0.0022 }));
      g.add(bm); const M = new THREE.Matrix4();
      const heater = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 48), new THREE.MeshStandardMaterial({ color: 0x444a52, emissive: 0x551100 })); heater.position.y = -0.006; g.add(heater);
      g.position.y = TY + 0.012;
      const pc = document.createElement('canvas'); pc.width = pc.height = 64; const pctx = pc.getContext('2d'), grd = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); pctx.fillStyle = grd; pctx.fillRect(0, 0, 64, 64);
      const puff = new THREE.CanvasTexture(pc);
      const steam = []; for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false })); g.add(s); steam.push({ s, ph: Math.random() }); }
      const up0 = g.userData.update;
      g.userData.update = (t, dt) => {
        up0(t);
        bs.forEach((b, i) => { b.y += (0.18 + 60 * b.r) * dt; b.r *= 1 + 0.25 * dt; if (b.y > BK.h) { b.y = 0.002; b.r = 0.0008 + Math.random() * 0.0015; b.x = (Math.random() - 0.5) * 1.4 * BK.R; b.z = (Math.random() - 0.5) * 1.4 * BK.R; } M.makeScale(b.r, b.r, b.r).setPosition(b.x + 0.002 * Math.sin(20 * t + i), b.y, b.z); bm.setMatrixAt(i, M); });
        bm.instanceMatrix.needsUpdate = true;
        steam.forEach((o) => { const u = (t * 0.25 + o.ph) % 1; o.s.position.set(0.02 * Math.sin(o.ph * 40 + t), BK.H + 0.01 + u * 0.18, 0.02 * Math.cos(o.ph * 30)); const sz = 0.03 + u * 0.08; o.s.scale.set(sz, sz, 1); o.s.material.opacity = 0.35 * Math.sin(Math.PI * u); });
      };
    }
    return g;
  }
  { const g = addScene('beaker', new THREE.Vector3(0, TY + BK.h * 0.55, TZ)); g.add(makeBeaker(false)); }
  { const g = addScene('boiling', new THREE.Vector3(0, TY + BK.h * 0.85, TZ)); g.add(makeBeaker(true)); const l = label('100 °C · 1 atm'); l.position.set(0.1, TY + 0.15, TZ); g.add(l); }
  function iceBlock(white, size = 0.07) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshPhongMaterial({ color: white ? 0xf2f6fa : 0xcfe9ff, transparent: true, opacity: white ? 0.82 : 0.3, shininess: 160, specular: 0xffffff, depthWrite: false }));
    m.position.y = size / 2; g.add(m);
    const eg = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })); eg.position.y = size / 2; g.add(eg);
    if (white) { // many trapped air bubbles
      const n = 900, bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), n), M = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { const r = 0.0004 + Math.random() * 0.0009; M.makeScale(r, r, r).setPosition((Math.random() - 0.5) * size * 0.9, size * (0.05 + 0.9 * Math.random()), (Math.random() - 0.5) * size * 0.9); bm.setMatrixAt(i, M); }
      g.add(bm);
    }
    return g;
  }
  { const g = addScene('iceblock', new THREE.Vector3(0, TY + 0.035, TZ)); const b = iceBlock(false); b.position.set(0, TY, TZ); g.add(b); const l = label('ice Ih · −20 °C'); l.position.set(0.09, TY + 0.1, TZ); g.add(l); }
  {
    const g = addScene('twoblocks', new THREE.Vector3(0, TY + 0.035, TZ));
    const a = iceBlock(false); a.position.set(-0.06, TY, TZ); g.add(a); const b = iceBlock(true); b.position.set(0.06, TY, TZ); g.add(b);
    const l1 = label('clear: slow, one direction', 0.17); l1.position.set(-0.07, TY + 0.11, TZ); g.add(l1);
    const l2 = label('white: fast, air trapped', 0.17); l2.position.set(0.07, TY + 0.11, TZ); g.add(l2);
  }
  let dacLabel = null;
  {
    const g = addScene('dac', new THREE.Vector3(0, TY + 0.06, TZ));
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.8, roughness: 0.35 });
    const dia = new THREE.MeshPhongMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.55, shininess: 300, specular: 0xffffff, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 48), steel); base.position.set(0, TY + 0.015, TZ); g.add(base);
    const topc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 48), steel); topc.position.set(0, TY + 0.105, TZ); g.add(topc);
    for (const a of [0, 2.09, 4.19]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 12), steel); post.position.set(TZ * 0 + 0.036 * Math.cos(a), TY + 0.06, TZ + 0.036 * Math.sin(a)); g.add(post); }
    const d1 = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.016, 0.026, 8), dia); d1.position.set(0, TY + 0.043, TZ); g.add(d1);
    const d2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.003, 0.026, 8), dia); d2.position.set(0, TY + 0.077, TZ); g.add(d2);
    const gasket = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0025, 12, 32), steel); gasket.rotation.x = Math.PI / 2; gasket.position.set(0, TY + 0.06, TZ); g.add(gasket);
    const sample = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 24), new THREE.MeshBasicMaterial({ color: 0x8fd8ff })); sample.position.set(0, TY + 0.06, TZ); g.add(sample);
    dacLabel = label('300 MPa'); dacLabel.position.set(0.1, TY + 0.13, TZ); g.add(dacLabel);
    const l2 = label('diamond anvil cell (enlarged)', 0.2); l2.position.set(-0.1, TY + 0.15, TZ); g.add(l2);
  }
  {
    const g = addScene('belljar', new THREE.Vector3(0, TY + 0.03, TZ));
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 48), new THREE.MeshStandardMaterial({ color: 0x555d66, metalness: 0.6, roughness: 0.4 })); plate.position.set(0, TY + 0.004, TZ); g.add(plate);
    const jar = new THREE.Mesh(new THREE.SphereGeometry(0.08, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glassMat); jar.scale.y = 1.4; jar.position.set(0, TY + 0.008, TZ); g.add(jar);
    const b = iceBlock(false, 0.045); b.position.set(0, TY + 0.008, TZ); g.add(b);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x333333 })); pipe.rotation.z = Math.PI / 2; pipe.position.set(0.2, TY + 0.004, TZ); g.add(pipe);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: 0x2f6fa8 })); pump.position.set(0.36, TY + 0.045, TZ); g.add(pump);
    const l = label('50 Pa · −20 °C'); l.position.set(0, TY + 0.16, TZ); g.add(l);
  }
  {
    const g = addScene('vessel', new THREE.Vector3(0, TY + 0.06, TZ + 0.045));
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c949c, metalness: 0.85, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 48), steel); body.position.set(0, TY + 0.06, TZ); g.add(body);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 32), new THREE.MeshBasicMaterial({ color: 0xffb26b })); win.position.set(0, TY + 0.06, TZ + 0.0505); g.add(win);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.003, 12, 32), steel); ring.position.copy(win.position); g.add(ring);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 32), new THREE.MeshStandardMaterial({ color: 0xffffff })); gauge.rotation.x = Math.PI / 2; gauge.position.set(0.035, TY + 0.14, TZ); g.add(gauge);
    const l = label('400 °C · 25 MPa'); l.position.set(-0.11, TY + 0.13, TZ); g.add(l);
  }
  let macroName = 'beaker';
  function setMacro(name) { macroName = SCENES[name] ? name : 'beaker'; for (const k in SCENES) SCENES[k].g.visible = k === macroName; }
  setMacro('beaker');
  function tapBeaker() { const t = performance.now() / 1000; modes.forEach((md, i) => { const cur = md.At * Math.exp(-md.beta * (t - md.t0)); md.At = cur + (i < 3 ? 0.0016 : 0.0006) * (0.5 + Math.random()); md.t0 = t; }); }

  // ---------- molecular world ----------
  const mol = new THREE.Group(); mol.visible = false; scene.add(mol);
  const MAXM = 7000;  // molecules drawn at once (after distance culling)
  const matO = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 });
  const matH = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const matB = new THREE.MeshStandardMaterial({ color: 0xc9d1d8, roughness: 0.5 });
  const mk = (g, m, n) => { const x = new THREE.InstancedMesh(g, m, n); x.frustumCulled = false; x.instanceMatrix.setUsage(THREE.DynamicDrawUsage); x.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * n), 3); x.instanceColor.setUsage(THREE.DynamicDrawUsage); x.count = 0; mol.add(x); return x; };
  const mO = mk(new THREE.IcosahedronGeometry(1, 2), matO, MAXM), mH = mk(new THREE.IcosahedronGeometry(1, 1), matH, 2 * MAXM), mB = mk(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), matB, 2 * MAXM);
  const MAXHB = 9000, hbPos = new Float32Array(MAXHB * 6), hbDist = new Float32Array(MAXHB * 2), hbGeo = new THREE.BufferGeometry();
  hbGeo.setAttribute('position', new THREE.BufferAttribute(hbPos, 3).setUsage(THREE.DynamicDrawUsage));
  hbGeo.setAttribute('lineDistance', new THREE.BufferAttribute(hbDist, 1).setUsage(THREE.DynamicDrawUsage));
  const hbLines = new THREE.LineSegments(hbGeo, new THREE.LineDashedMaterial({ color: 0x6fe3ff, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.9 })); hbLines.frustumCulled = false; mol.add(hbLines);
  const TRN = 800, trPos = new Float32Array(TRN * 3), trGeo = new THREE.BufferGeometry(); trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3).setUsage(THREE.DynamicDrawUsage));
  const trail = new THREE.Line(trGeo, new THREE.LineBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85 })); trail.frustumCulled = false; mol.add(trail);
  const COL = { O: [0.886, 0.251, 0.173], H: [0.957, 0.957, 0.957], tagO: [1, 0.824, 0.227], tagH: [1, 0.95, 0.69], net1: [0.62, 0.36, 0.95], net1H: [0.88, 0.84, 1], ice: [0.55, 0.82, 1], iceH: [0.85, 0.95, 1] };

  // state catalogue: view scale (m per Å at full zoom), fog depth (Å beyond the comfort bubble), slab = vacuum along z
  const STATES = {
    liq298: {}, liq353: {}, liq277: {}, sc253: {},
    ice1h: { axisForward: 'y' }, ice3: {}, ice6: { net: true }, ice7: { net: true },
    vap373: { scale: 0.05, fog: 80, cull: 95, gas: true }, scf: { scale: 0.08, fog: 22, cull: 34 },
    iceslab: { slab: true, viewZ: 'top' },
    rec_melt: { rec: true, colorIce: true }, rec_evap: { rec: true, slab: true, viewZ: 'top' },
  };
  let cur = { name: null, def: {}, N: 0, box: [20, 20, 20], X: null, HB: null, net: null, recHB: false };
  let molScaleFull = 0.1, molScale = 0.1;
  const COMFORT = 0.55;
  const TAG = 0;
  const trU = []; let trPrev = null, trCur = [0, 0, 0];
  const qAxis = new THREE.Quaternion();
  const viewPt = new THREE.Vector3();   // viewer position in the box (Å, box frame)
  const viewOff = new THREE.Vector3();  // flight offset (Å)

  function radii() { return cfg.style ? { O: 1.25, H: 0.85, B: 0 } : { O: 0.42, H: 0.26, B: 0.11 }; }
  function wrapIn(v, L) { return v - L * Math.floor(v / L); }
  const tmpV = new THREE.Vector3();
  function updateMolecules(stage, u) {
    const X = cur.X; if (!X || !cur.N) { mO.count = mH.count = mB.count = 0; return; }
    const R = radii(), N = cur.N, [Lx, Ly, Lz] = cur.box, def = cur.def, slab = !!def.slab;
    // viewer position in the box frame (Å)
    mol.updateMatrixWorld(true); tmpV.set(0, 0, 0); mol.worldToLocal(tmpV);
    const vx = tmpV.x, vy = tmpV.y, vz = tmpV.z;
    const s = molScale, r0 = COMFORT / s, r1 = (COMFORT + 0.15) / s;
    const cull = u < 0.6 ? 1e9 : (def.cull || ((def.fog || 12) + 4)) + r0;
    const cull2 = cull * cull;
    const imgs = u < 0.55 ? [[0, 0, 0]] : IMGS(slab);
    const aO = mO.instanceMatrix.array, aH = mH.instanceMatrix.array, aB = mB.instanceMatrix.array, cO = mO.instanceColor.array, cH = mH.instanceColor.array;
    let n = 0;
    for (const [ix, iy, iz] of imgs) {
      const ox0 = ix * Lx, oy0 = iy * Ly, oz0 = iz * Lz;
      for (let m = 0; m < N && n < MAXM; m++) {
        const o = 9 * m;
        const px = X[o] + ox0, py = X[o + 1] + oy0, pz = X[o + 2] + oz0;
        const dx = px - vx, dy = py - vy, dz = pz - vz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > cull2) continue;
        let f = 1; if (d2 < r1 * r1) { if (d2 <= r0 * r0) continue; const t = (Math.sqrt(d2) - r0) / (r1 - r0); f = t * t * (3 - 2 * t); }
        writeS(aO, n, px, py, pz, R.O * f);
        let co = COL.O, ch = COL.H;
        if (m === TAG && cfg.trail && !def.rec) { co = COL.tagO; ch = COL.tagH; }
        else if (def.net && cur.net && cur.net[m] === 1) { co = COL.net1; ch = COL.net1H; }
        else if (def.colorIce && cur.iceLike && cur.iceLike[m]) { co = COL.ice; ch = COL.iceH; }
        cO[3 * n] = co[0]; cO[3 * n + 1] = co[1]; cO[3 * n + 2] = co[2];
        for (let k = 0; k < 2; k++) {
          const hx = X[o + 3 + 3 * k] + ox0, hy = X[o + 4 + 3 * k] + oy0, hz = X[o + 5 + 3 * k] + oz0, q = 2 * n + k;
          writeS(aH, q, hx, hy, hz, R.H * f);
          cH[3 * q] = ch[0]; cH[3 * q + 1] = ch[1]; cH[3 * q + 2] = ch[2];
          writeBond(aB, q, px, py, pz, hx, hy, hz, R.B * f);
        }
        n++;
      }
    }
    mO.count = n; mH.count = mB.count = 2 * n;
    mO.instanceMatrix.needsUpdate = mH.instanceMatrix.needsUpdate = mB.instanceMatrix.needsUpdate = true;
    mO.instanceColor.needsUpdate = mH.instanceColor.needsUpdate = true;
    mB.visible = !cfg.style;
    // hydrogen bonds
    let nh = 0;
    if (cfg.hb && cur.HB) {
      const HB = cur.HB, nb = HB.length / 3;
      for (let b = 0; b < nb; b++) {
        const d = HB[3 * b], hh = HB[3 * b + 1], a = HB[3 * b + 2];
        const px = X[9 * d + 3 * hh], py = X[9 * d + 3 * hh + 1], pz = X[9 * d + 3 * hh + 2];
        let qx = X[9 * a] - px, qy = X[9 * a + 1] - py, qz = X[9 * a + 2] - pz;
        qx -= Lx * Math.round(qx / Lx); qy -= Ly * Math.round(qy / Ly); if (!slab) qz -= Lz * Math.round(qz / Lz);
        const len = Math.hypot(qx, qy, qz);
        for (const [ix, iy, iz] of imgs) {
          if (nh >= MAXHB) break;
          const ax = px + ix * Lx, ay = py + iy * Ly, az = pz + iz * Lz;
          const mx = ax + qx / 2 - vx, my = ay + qy / 2 - vy, mz = az + qz / 2 - vz, md2 = mx * mx + my * my + mz * mz;
          if (md2 < r1 * r1 || md2 > cull2) continue;
          const o = 6 * nh;
          hbPos[o] = ax; hbPos[o + 1] = ay; hbPos[o + 2] = az; hbPos[o + 3] = ax + qx; hbPos[o + 4] = ay + qy; hbPos[o + 5] = az + qz;
          hbDist[2 * nh] = 0; hbDist[2 * nh + 1] = len; nh++;
        }
      }
    }
    hbGeo.setDrawRange(0, 2 * nh); hbGeo.attributes.position.needsUpdate = true; hbGeo.attributes.lineDistance.needsUpdate = true;
    // trail of the tagged molecule
    trail.visible = cfg.trail && !def.rec && trU.length > 1;
    if (trail.visible) {
      const last = trU[trU.length - 1];
      for (let i = 0; i < TRN; i++) { const p = trU[Math.max(0, trU.length - TRN + i)] || last; trPos[3 * i] = p[0] - last[0] + trCur[0]; trPos[3 * i + 1] = p[1] - last[1] + trCur[1]; trPos[3 * i + 2] = p[2] - last[2] + trCur[2]; }
      trGeo.attributes.position.needsUpdate = true;
    }
  }
  const IMG_ALL = [], IMG_XY = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { IMG_XY.push([i, j, 0]); for (let k = -1; k <= 1; k++) IMG_ALL.push([i, j, k]); }
  const IMGS = (slab) => (slab ? IMG_XY : IMG_ALL);
  function writeS(a, i, x, y, z, r) { const o = 16 * i; a[o] = r; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = r; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = r; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1; }
  function writeBond(a, q, ox, oy, oz, hx, hy, hz, rb) {
    let ux = hx - ox, uy = hy - oy, uz = hz - oz; const len = Math.hypot(ux, uy, uz) || 1; ux /= len; uy /= len; uz /= len;
    let wx = 1, wy = 0; if (Math.abs(ux) > 0.9) { wx = 0; wy = 1; }
    let ax = uy * 0 - uz * wy, ay = uz * wx - ux * 0, az = ux * wy - uy * wx; const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux, o = 16 * q;
    a[o] = ax * rb; a[o + 1] = ay * rb; a[o + 2] = az * rb; a[o + 3] = 0; a[o + 4] = ux * len; a[o + 5] = uy * len; a[o + 6] = uz * len; a[o + 7] = 0;
    a[o + 8] = bx * rb; a[o + 9] = by * rb; a[o + 10] = bz * rb; a[o + 11] = 0; a[o + 12] = (ox + hx) / 2; a[o + 13] = (oy + hy) / 2; a[o + 14] = (oz + hz) / 2; a[o + 15] = 1;
  }

  // ---------- live simulation (worker) ----------
  const worker = new Worker('md-worker.js');
  let busy = true, stepAcc = 0, loadToken = 0;
  const stat = { T: 0, U: 0, P: 0, rho: 0, nhb: 0, t: 0, Uavg: null, Pavg: null, Tavg: null, rhoAvg: null };
  const rate = { t0: performance.now(), s0: 0, val: 0 };
  const ema = (a, v, w) => (a === null ? v : a + w * (v - a));
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'error') { msg('Could not load simulation data: ' + d.msg, 5000); return; }
    if (d.type === 'loaded') { if (d.token !== loadToken) return; cur.net = d.net; cur.N = d.N; cur.box = d.box; cur.ready = true; trU.length = 0; trPrev = null; stat.Uavg = stat.Pavg = stat.Tavg = stat.rhoAvg = null; return; }
    if (cur.def.rec || !cur.ready) { busy = false; return; }
    cur.X = d.x; cur.HB = d.hb; cur.N = d.N; cur.box = d.box; busy = false;
    stat.T = d.T; stat.U = d.U; stat.P = d.P; stat.rho = d.rho; stat.nhb = d.nhb; stat.t = d.t;
    stat.Tavg = ema(stat.Tavg, d.T, 0.03); stat.Uavg = ema(stat.Uavg, d.U, 0.03); stat.Pavg = ema(stat.Pavg, d.P, 0.01); stat.rhoAvg = ema(stat.rhoAvg, d.rho, 0.02);
    const q = [cur.X[9 * TAG], cur.X[9 * TAG + 1], cur.X[9 * TAG + 2]];
    if (trPrev) { const u = trU[trU.length - 1].slice(); for (let c = 0; c < 3; c++) { let dd = q[c] - trPrev[c]; dd -= cur.box[c] * Math.round(dd / cur.box[c]); u[c] += dd; } trU.push(u); if (trU.length > TRN) trU.shift(); } else trU.push(q.slice());
    trPrev = q; trCur = q;
  };
  function pumpSim() {
    if (busy || cur.def.rec) return;
    stepAcc = Math.min(stepAcc + SPEEDS[cfg.sp], 16);
    const n = Math.floor(stepAcc);
    if (n >= 1) { stepAcc -= n; busy = true; worker.postMessage({ cmd: 'step', n }); }
  }

  // ---------- recorded trajectories ----------
  const recCache = {};
  async function getRec(name) {
    if (recCache[name]) return recCache[name];
    const h = await (await fetch('data/rec_' + name + '.json')).json();
    const b = new Int16Array(await (await fetch('data/rec_' + name + '.bin')).arrayBuffer());
    recCache[name] = { h, b }; return recCache[name];
  }
  const rec = { on: false, data: null, f: 0, fps: 6, X: null };
  function recFrame(dt) {
    const { h, b } = rec.data, N = h.N, S = 9 * N;
    if (cfg.sp > 0) rec.f += dt * rec.fps * (SPEEDS[cfg.sp] / 2);
    if (rec.f >= h.frames - 1) rec.f = 0;          // loop
    const f0 = Math.floor(rec.f), f1 = Math.min(f0 + 1, h.frames - 1), w = rec.f - f0;
    const box = h.boxes[f0], X = rec.X || (rec.X = new Float32Array(S));
    for (let m = 0; m < N; m++) {
      const o = f0 * S + 9 * m, p = f1 * S + 9 * m;
      for (let c = 0; c < 3; c++) {
        let d = (b[p + c] - b[o + c]) / 100; const L = box[c]; d -= L * Math.round(d / L);
        X[9 * m + c] = b[o + c] / 100 + w * d;
        for (let k = 1; k <= 2; k++) { const r0 = (b[o + 3 * k + c] - b[o + c]) / 100, r1 = (b[p + 3 * k + c] - b[p + c]) / 100; X[9 * m + 3 * k + c] = X[9 * m + c] + r0 + w * (r1 - r0); }
      }
    }
    cur.X = X; cur.box = box; cur.N = N;
    // crystal-like molecules: oxygen moved < 1.4 Å over the last 5 ps (20 frames)
    if (cur.def.colorIce) {
      const g = f0 >= 20 ? f0 - 20 : Math.min(h.frames - 1, f0 + 20), il = cur.iceLike || (cur.iceLike = new Uint8Array(N));
      for (let m = 0; m < N; m++) { let d2 = 0; for (let c = 0; c < 3; c++) { let d = (b[f0 * S + 9 * m + c] - b[g * S + 9 * m + c]) / 100; d -= box[c] * Math.round(d / box[c]); d2 += d * d; } il[m] = d2 < 1.96 ? 1 : 0; }
    }
    if (f0 !== rec.lastHB) { rec.lastHB = f0; cur.HB = findHB(X, N, box, !!cur.def.slab); }
    stat.t = rec.f * h.dtFrame; stat.T = h.T; stat.nhb = cur.HB.length / 3; stat.rho = 0;
  }
  function findHB(X, N, box, slab) { // Luzar–Chandler criterion
    const out = [], c30 = Math.cos(Math.PI / 6);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      let dx = X[9 * j] - X[9 * i], dy = X[9 * j + 1] - X[9 * i + 1], dz = X[9 * j + 2] - X[9 * i + 2];
      dx -= box[0] * Math.round(dx / box[0]); dy -= box[1] * Math.round(dy / box[1]); if (!slab) dz -= box[2] * Math.round(dz / box[2]);
      const r2 = dx * dx + dy * dy + dz * dz; if (r2 > 12.25) continue; const r = Math.sqrt(r2);
      for (let h = 1; h <= 2; h++) {
        const ax = X[9 * i + 3 * h] - X[9 * i], ay = X[9 * i + 3 * h + 1] - X[9 * i + 1], az = X[9 * i + 3 * h + 2] - X[9 * i + 2];
        if ((ax * dx + ay * dy + az * dz) / (r * 0.9572) > c30) out.push(i, h, j);
        const bx = X[9 * j + 3 * h] - X[9 * j], by = X[9 * j + 3 * h + 1] - X[9 * j + 1], bz = X[9 * j + 3 * h + 2] - X[9 * j + 2];
        if (-(bx * dx + by * dy + bz * dz) / (r * 0.9572) > c30) out.push(j, h, i);
      }
    }
    return Int32Array.from(out);
  }

  // load a molecular state or recording; sim settings for free mode
  let pendingLoad = null;
  async function loadState(name, opt = {}) {
    const def = STATES[name] || {};
    cur = { name, def, N: 0, box: [20, 20, 20], X: null, HB: null, net: null, ready: false };
    molScaleFull = def.scale || 0.1;
    rec.on = false; rec.X = null; rec.lastHB = -1;
    trU.length = 0; trPrev = null;
    if (def.rec) {
      rec.data = await getRec(name.slice(4)); rec.on = true; rec.f = 0; cur.ready = true;
      cur.box = rec.data.h.boxes[0]; recFrame(0);
    } else {
      loadToken++; busy = true;
      const isIce = /^ice\d/.test(name), isLiq = /^(liq|sc)/.test(name);
      worker.postMessage({ cmd: 'load', url: 'data/st_' + name + '.json', token: loadToken, T: opt.T, P: opt.P, baro: (isIce || isLiq) ? [1, 1, 1] : [0, 0, 0], iso: isIce || isLiq, gasP: opt.gasP });
    }
    pendingLoad = name;
  }
  function placeViewer() { // choose where in the box the viewer sits, and the crystal orientation
    const [Lx, Ly, Lz] = cur.box;
    viewPt.set(Lx / 2, Ly / 2, Lz / 2);
    if (cur.def.viewZ === 'top' && cur.X) { // just above the top surface of a slab
      const z = []; for (let m = 0; m < cur.N; m++) z.push(cur.X[9 * m + 2]); z.sort((a, b) => a - b);
      viewPt.z = z[Math.floor(z.length * 0.92)] + 6.5;
    }
    if (cur.def.axisForward === 'y') qAxis.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    else qAxis.identity();
  }

  // ---------- zoom: macro → molecules ----------
  let zoom = 0, zoomTarget = 0, zoomRate = 1 / 5;
  const S0 = 0.0035, CUBE_D = 0.42, S_MAX_F = 1.5, ZMAX = 1.4;
  const cubeDir = new THREE.Vector3(0, 0, -1);
  const camBase = new THREE.Vector3();
  let mag = 1, stage = 'macro', lastMolU = 0;
  const ease = (u) => u * u * (3 - 2 * u);
  function applyZoom() {
    const z = zoom; let fade = 0;
    const focus = SCENES[macroName].focus, D0 = focus.length(), DMIN = 0.004;
    if (z < 0.4) {
      stage = 'macro';
      const u = ease(z / 0.4), d = D0 * Math.pow(DMIN / D0, u);
      camBase.copy(focus).addScaledVector(focus.clone().normalize(), -d);
      mag = D0 / d; fade = z > 0.3 ? (z - 0.3) / 0.1 : 0;
    } else if (z < 0.6) {
      stage = 'fade'; fade = 1; camBase.set(0, 0, 0);
      const u = (z - 0.4) / 0.2; mag = Math.pow(10, Math.log10(D0 / DMIN) * (1 - u) + Math.log10(S0 * 1e10) * u);
    } else {
      stage = 'mol'; camBase.set(0, 0, 0);
      const u = ease(Math.min(1, (z - 0.6) / 0.4)); lastMolU = u;
      const extra = Math.pow(S_MAX_F, Math.max(0, z - 1) / (ZMAX - 1));
      const S1 = molScaleFull;
      molScale = S0 * Math.pow(S1 / S0, u) * extra;
      fade = z < 0.68 ? 1 - (z - 0.6) / 0.08 : 0;
      if (cur.ready && pendingLoad === cur.name && (cur.X)) { placeViewer(); pendingLoad = null; }
      mol.scale.setScalar(molScale);
      mol.quaternion.copy(qAxis);
      const C = cubeDir.clone().multiplyScalar(CUBE_D * (1 - u));
      // the box point under the viewer: viewPt + viewOff (wrapped for periodic axes); at u<1 aim at box centre
      const vp = tmpP.copy(viewPt).add(viewOff);
      if (u < 0.999) vp.lerp(tmpQ.set(cur.box[0] / 2, cur.box[1] / 2, cur.box[2] / 2), 1 - u);
      mol.position.copy(C).sub(vp.applyQuaternion(qAxis).multiplyScalar(molScale));
      const rb = COMFORT / molScale, dist = C.length(), fg = cur.def.fog || 12;
      scene.fog.near = dist + (rb + 3 + 40 * (1 - u)) * molScale; scene.fog.far = dist + (rb + fg + 60 * (1 - u)) * molScale;
      mag = molScale * 1e10;
    }
    camera.near = stage === 'mol' ? 0.05 : 0.004;
    macro.visible = stage === 'macro'; mol.visible = stage === 'mol';
    scene.background.copy(stage === 'mol' ? BG_MOL : BG_MACRO);
    if (stage !== 'mol') { scene.fog.near = 1000; scene.fog.far = 2000; }
    $('fade').style.opacity = fade.toFixed(3);
    const txt = fade > 0.05 ? `×${fmtMag(mag)}` : '';
    $('fadeL').textContent = txt; $('fadeR').textContent = txt;
    $('bDive').textContent = zoomTarget > 0.5 ? '◂ Out' : 'Dive ▸';
  }
  const tmpP = new THREE.Vector3(), tmpQ = new THREE.Vector3();
  function fmtMag(m) { if (m < 1000) return m.toFixed(m < 10 ? 1 : 0); const e = Math.floor(Math.log10(m)); return (m / Math.pow(10, e)).toFixed(1) + '×10' + sup(e); }
  function sup(n) { return String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁻'['0123456789-'.indexOf(c)] || c).join(''); }
  function goZoom(t) {
    if (t >= 0.6 && zoom < 0.6) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0; if (f.lengthSq() > 1e-4) cubeDir.copy(f.normalize()); viewOff.set(0, 0, 0); }
    zoomTarget = Math.max(0, Math.min(ZMAX, t));
  }
  const STOPS = [0, 0.14, 0.28, 0.75, 0.88, 1.0, 1.2, 1.4];
  function zoomStep(d) { const c = zoomTarget; if (d > 0) goZoom(STOPS.find((v) => v > c + 0.01) ?? ZMAX); else goZoom([...STOPS].reverse().find((v) => v < c - 0.01) ?? 0); }
  $('bDive').onclick = () => goZoom(zoomTarget > 0.5 ? 0 : 1);
  $('bTap').onclick = tapBeaker;

  // ---------- orientation: drag or motion sensor ----------
  let yaw = 0, pitch = 0, sensorOn = false, gotSensor = false, needCentre = true;
  const sensorQ = new THREE.Quaternion(), offQ = new THREE.Quaternion(), targetQ = new THREE.Quaternion();
  const euler = new THREE.Euler(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), q0 = new THREE.Quaternion(), zee = new THREE.Vector3(0, 0, 1);
  const deg = THREE.MathUtils.degToRad;
  function onOri(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    gotSensor = true;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    euler.set(deg(e.beta), deg(e.alpha), -deg(e.gamma), 'YXZ');
    sensorQ.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -deg(ang)));
    if (needCentre) { recentre(); needCentre = false; }
  }
  const oriEvt = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
  async function startSensor() {
    if (sensorOn) return;
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { msg('Motion sensor permission denied. Use drag instead.', 3000); return; } } } catch (e) { /* not needed */ }
    window.addEventListener(oriEvt, onOri); sensorOn = true; gotSensor = false; needCentre = true;
    $('bSensor').textContent = '📱 Drag';
    setTimeout(() => { if (sensorOn && !gotSensor) { msg('No motion sensor data. Use drag instead.', 3500); stopSensor(); } }, 1500);
  }
  function stopSensor() { window.removeEventListener(oriEvt, onOri); sensorOn = false; $('bSensor').textContent = '📱 Sensor'; }
  function recentre() {
    if (sensorOn && gotSensor) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(sensorQ); offQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(-f.x, -f.z)); }
    else { yaw = 0; pitch = 0; }
  }
  $('bSensor').onclick = () => (sensorOn ? stopSensor() : startSensor());
  $('bCentre').onclick = recentre;
  function updateOrientation() {
    if (sensorOn && gotSensor) { targetQ.copy(offQ).multiply(sensorQ); camera.quaternion.slerp(targetQ, 0.6); }
    else camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
  }

  // ---------- touch ----------
  const pts = new Map(); let downT = 0, moved = false, holdTimer = 0, flying = false, pinch0 = 0, zoom0 = 0;
  const dist2 = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (pts.size === 1) { downT = performance.now(); moved = false; clearTimeout(holdTimer); holdTimer = setTimeout(() => { if (!moved && stage === 'mol' && pts.size === 1) flying = true; }, 450); }
    if (pts.size === 2) { pinch0 = dist2(); zoom0 = zoom; moved = true; clearTimeout(holdTimer); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 10) moved = true;
    if (pts.size === 1 && !(sensorOn && gotSensor) && !flying) { const k = 1.6 / Math.max(innerHeight, 300) * (camera.fov / 70); yaw += dx * k; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * k)); }
    else if (pts.size === 2) zoom = zoomTarget = Math.max(0, Math.min(ZMAX, zoom0 + Math.log(dist2() / pinch0) * 0.35));
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); clearTimeout(holdTimer);
    if (pts.size === 0) { if (!moved && !flying && performance.now() - downT < 350 && vr) document.body.classList.toggle('showui'); flying = false; }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  // ---------- phase diagram (IAPWS) ----------
  const pdCv = document.createElement('canvas'); pdCv.width = 640; pdCv.height = 560;
  const pdTex = new THREE.CanvasTexture(pdCv);
  const pdPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3675), new THREE.MeshBasicMaterial({ map: pdTex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  pdPlane.position.set(-0.52, 0.2, -1.15); pdPlane.rotation.y = 0.35; pdPlane.renderOrder = 11; camera.add(pdPlane);
  const PD = { x0: 70, x1: 620, y0: 500, y1: 30, Tmin: 150, Tmax: 800, lpMin: -5, lpMax: 4.6 };
  const px = (T) => PD.x0 + (T - PD.Tmin) / (PD.Tmax - PD.Tmin) * (PD.x1 - PD.x0);
  const py = (pMPa) => PD.y0 - (Math.log10(pMPa) - PD.lpMin) / (PD.lpMax - PD.lpMin) * (PD.y0 - PD.y1);
  let pdMarker = { T: 298.15, P: 0.101325 }; const pdPath = [];
  function drawPD() {
    const c = pdCv.getContext('2d'); c.clearRect(0, 0, 640, 560);
    c.fillStyle = 'rgba(8,22,38,0.86)'; c.beginPath(); c.roundRect ? c.roundRect(2, 2, 636, 556, 24) : c.rect(2, 2, 636, 556); c.fill();
    c.strokeStyle = '#4b6378'; c.lineWidth = 1; c.font = '20px system-ui,sans-serif'; c.fillStyle = '#9db3c6';
    for (let lp = -4; lp <= 4; lp++) { const y = py(Math.pow(10, lp)); c.beginPath(); c.moveTo(PD.x0, y); c.lineTo(PD.x1, y); c.stroke(); const lab = lp <= -1 ? (Math.pow(10, lp + 6) >= 1 ? Math.pow(10, lp + 6).toFixed(0) + ' Pa' : '') : lp < 3 ? (Math.pow(10, lp)).toFixed(lp < 0 ? 1 : 0) + ' MPa' : (Math.pow(10, lp - 3)).toFixed(0) + ' GPa'; if (lab) c.fillText(lab, 4, y + 6); }
    for (let T = 200; T <= 800; T += 100) { const x = px(T); c.beginPath(); c.moveTo(x, PD.y0); c.lineTo(x, PD.y1); c.stroke(); c.fillText(T + ' K', x - 22, PD.y0 + 26); }
    const curve = (f, a, b, col) => { c.strokeStyle = col; c.lineWidth = 3.5; c.beginPath(); for (let i = 0; i <= 80; i++) { const T = a + (b - a) * i / 80, p = f(T); const X = px(T), Y = py(p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); } c.stroke(); };
    curve(PH.subl, 150, 273.16, '#e8f1f8'); curve(PH.sat, 273.16, 647.096, '#e8f1f8');
    curve(PH.meltIh, 251.165, 273.16, '#e8f1f8'); curve(PH.meltIII, 251.165, 256.164, '#e8f1f8'); curve(PH.meltV, 256.164, 273.31, '#e8f1f8'); curve(PH.meltVI, 273.31, 355, '#e8f1f8'); curve(PH.meltVII, 355, 715, '#e8f1f8');
    c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(px(647.096), py(22.064), 6, 0, 7); c.fill(); c.beginPath(); c.arc(px(273.16), py(611.657e-6), 6, 0, 7); c.fill();
    c.font = '600 22px system-ui,sans-serif'; c.fillStyle = '#cfe6ff';
    [['Ice Ih', 185, 0.02], ['Liquid', 380, 50], ['Vapour', 520, 0.0004], ['Supercritical', 655, 120], ['III', 222, 270], ['V', 236, 470], ['VI', 268, 1300], ['VII', 420, 9000]].forEach(([t, T, p]) => c.fillText(t, px(T), py(p)));
    c.font = '18px system-ui,sans-serif'; c.fillStyle = '#ffd23a'; c.fillText('critical point', px(560), py(40)); c.fillText('triple point', px(272), py(611.657e-6) + 26);
    if (pdPath.length > 1) { c.strokeStyle = 'rgba(255,210,58,0.6)'; c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); pdPath.forEach((q, i) => { const X = px(q.T), Y = py(q.P); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#ff4d4d'; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(px(pdMarker.T), py(pdMarker.P), 11, 0, 7); c.fill(); c.stroke();
    c.font = '600 22px system-ui,sans-serif'; c.fillStyle = '#ffffff';
    c.fillText(`${(pdMarker.T - 273.15).toFixed(0)} °C · ${fmtP(pdMarker.P)} · ${phaseName(PH.phase(pdMarker.T, pdMarker.P))}`, PD.x0, 26);
    pdTex.needsUpdate = true;
    const hc = $('pd2d'); if (hc) { const x = hc.getContext('2d'); x.clearRect(0, 0, hc.width, hc.height); x.drawImage(pdCv, 0, 0, hc.width, hc.height); }
  }
  function fmtP(p) { return p >= 1000 ? (p / 1000).toFixed(p >= 10000 ? 0 : 1) + ' GPa' : p >= 1 ? p.toFixed(p >= 100 ? 0 : 1) + ' MPa' : p >= 0.001 ? (p * 1000).toFixed(p >= 0.1 ? 0 : 1) + ' kPa' : (p * 1e6).toFixed(0) + ' Pa'; }
  function phaseName(ph) { return { Ih: 'ice Ih', III: 'ice III', V: 'ice V', VI: 'ice VI', VII: 'ice VII', liquid: 'liquid', vapour: 'vapour', supercritical: 'supercritical' }[ph] || ph; }
  function setMarker(TC, PMPa, addPath) { pdMarker = { T: TC + 273.15, P: PMPa }; if (addPath) pdPath.push({ ...pdMarker }); drawPD(); }
  drawPD();

  // ---------- narration (speechSynthesis) ----------
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; } };
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice(lang) {
    const prefs = TOUR.UI[lang].lang;
    for (const p of prefs) { const v = voices.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase() === p.toLowerCase()); if (v) return v; }
    for (const p of prefs) { const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(p.slice(0, 2))); if (v) return v; }
    return null;
  }
  const speech = { speaking: false, endT: 0, queue: [], sub: '', gen: 0 };
  function splitSentences(t) { return t.match(/[^.!?।]+[.!?।]*/g).map((s) => s.trim()).filter(Boolean); }
  function speak(text, onDone) {
    stopSpeech(); const gen = ++speech.gen;
    const parts = splitSentences(text), lang = cfg.lang, voice = pickVoice(lang);
    let i = 0;
    const next = () => {
      if (gen !== speech.gen) return;
      if (i >= parts.length) { speech.speaking = false; speech.endT = performance.now(); speech.sub = ''; onDone && onDone(); return; }
      const s = parts[i++]; speech.sub = s;
      if (cfg.narr && voice && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(s); u.voice = voice; u.lang = voice.lang; u.rate = lang === 'en' ? 0.95 : 0.9;
        let done = false; const fin = () => { if (!done) { done = true; next(); } };
        u.onend = fin; u.onerror = fin;
        setTimeout(fin, 2500 + s.length * 140);   // safety if the engine never fires onend
        speech.speaking = true; speechSynthesis.speak(u);
      } else {
        speech.speaking = cfg.narr; setTimeout(next, 1200 + s.length * (lang === 'en' ? 62 : 75));   // subtitles only
      }
    };
    if (cfg.narr && !voice) msg(TOUR.UI[lang].novoice, 5000);
    next();
  }
  function stopSpeech() { speech.gen++; speech.speaking = false; speech.sub = ''; try { speechSynthesis.cancel(); } catch (e) { /* none */ } }

  // ---------- tour ----------
  const tour = { on: false, i: 0, paused: false, timer: 0, ch: null };
  function chText(ch) { return ch[cfg.lang] || ch.en; }
  function chTitle(ch) { return (ch.title && (ch.title[cfg.lang] || ch.title.en)) || ''; }
  async function startChapter(i) {
    clearTimeout(tour.timer);
    tour.i = Math.max(0, Math.min(TOUR.CH.length - 1, i)); const ch = tour.ch = TOUR.CH[tour.i];
    setMarker(ch.T, ch.P, true);
    if (dacLabel && ch.macro === 'dac') { dacLabel.material.map.dispose(); const l = label(fmtP(ch.P)); dacLabel.material = l.material; }
    const target = ch.rec ? 'rec_' + ch.rec : ch.state;
    const inMol = zoom >= 0.6;
    speakChapter(ch);
    if (ch.macro && (ch.dive || !target)) {
      if (zoom > 0.01) { goZoom(0); await waitZoom(); }
      if (tour.ch !== ch) return;
      setMacro(ch.macro);
    } else if (ch.macro) setMacro(ch.macro);
    if (target) {
      if (tour.ch !== ch) return;
      if (ch.dive || !inMol) {
        await loadState(target);
        await sleep(ch.dive ? 4500 : 300);
        if (tour.ch === ch) goZoom(1);
      } else {
        swapFade(() => loadState(target));
      }
    }
  }
  function speakChapter(ch) {
    speak(chText(ch), () => { if (tour.on && tour.ch === ch && !tour.paused) tour.timer = setTimeout(() => { if (tour.i < TOUR.CH.length - 1) startChapter(tour.i + 1); else endTour(); }, 3000); });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitZoom = () => new Promise((r) => { const chk = () => (Math.abs(zoom - zoomTarget) < 1e-3 ? r() : setTimeout(chk, 100)); chk(); });
  async function swapFade(fn) { fadeOv = 1; await sleep(350); await fn(); await sleep(250); fadeOv = 0; }
  let fadeOv = 0, fadeOvCur = 0;
  function startTour() { tour.on = true; tour.paused = false; pdPath.length = 0; document.body.classList.add('touring'); $('bTour').textContent = '■ End tour'; startChapter(0); }
  function endTour() { tour.on = false; clearTimeout(tour.timer); stopSpeech(); document.body.classList.remove('touring'); $('bTour').textContent = '▶ Tour'; }
  function nextCh(d) { if (!tour.on) return; tour.paused = false; startChapter(tour.i + d); }
  function pauseTour() { if (!tour.on) return; tour.paused = !tour.paused; if (tour.paused) { clearTimeout(tour.timer); stopSpeech(); } else speakChapter(tour.ch); $('bPause').textContent = tour.paused ? '▶ Resume' : '❚❚ Pause'; }
  $('bTour').onclick = () => (tour.on ? endTour() : startTour());
  $('bNext').onclick = () => nextCh(1); $('bPrev').onclick = () => nextCh(-1); $('bPause').onclick = pauseTour;

  // ---------- free mode: any T and P; the IAPWS phase picks the simulation ----------
  function freeVals() { const TC = +$('sFT').value, lp = +$('sFP').value; return { TC, P: Math.pow(10, lp) / 1e6 }; }
  function freeUI() { const { TC, P } = freeVals(); $('vFT').textContent = TC; $('vFP').textContent = fmtP(P); const ph = PH.phase(TC + 273.15, P); $('vFPh').textContent = phaseName(ph); setMarker(TC, P, false); }
  $('sFT').oninput = freeUI; $('sFP').oninput = freeUI;
  $('bFree').onclick = async () => {
    if (tour.on) endTour();
    const { TC, P } = freeVals(), TK = TC + 273.15, ph = PH.phase(TK, P), Pbar = P * 10;
    let st = null, opt = { T: TK, P: Pbar };
    if (ph === 'liquid') st = TK < 273.15 ? 'sc253' : TK < 290 ? 'liq277' : TK < 330 ? 'liq298' : 'liq353';
    else if (ph === 'Ih') st = 'ice1h'; else if (ph === 'III') st = 'ice3'; else if (ph === 'VI') st = 'ice6'; else if (ph === 'VII') st = 'ice7';
    else if (ph === 'vapour') { st = 'vap373'; opt = { T: TK, gasP: Math.max(Pbar, 1e-4) }; }
    else if (ph === 'supercritical') { st = 'scf'; opt = { T: TK * 705 / 647.096 }; msg('Supercritical: simulated at the same T/Tc in the model (density kept at 0.16 g/cm³).', 4500); }
    else if (ph === 'V') { msg('Ice V (28 molecules per monoclinic cell) is not included in this app.', 4000); return; }
    setMacro(ph === 'vapour' ? 'boiling' : /^(Ih|III|V|VI|VII)$/.test(ph) ? (P > 100 ? 'dac' : 'iceblock') : ph === 'supercritical' ? 'vessel' : 'beaker');
    if (zoom >= 0.6) swapFade(() => loadState(st, opt)); else { await loadState(st, opt); goZoom(1); }
    $('panel').style.display = 'none';
  };

  // ---------- voice commands ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null, voiceOn = false, heard = '', heardT = 0, voiceFlyUntil = 0;
  function setSpeed(v) { cfg.sp = Math.max(0, Math.min(7, v)); syncUI(); }
  const COMMANDS = [
    [/end tour|stop tour|exit tour/, () => endTour(), true],
    [/^(stop|pause|wait)/, () => { if (tour.on && !tour.paused) pauseTour(); voiceFlyUntil = 0; flying = false; }, true],
    [/resume|continue|play/, () => { if (tour.on && tour.paused) pauseTour(); else setSpeed(cfg.sp || 3); }],
    [/next|skip/, () => nextCh(1)],
    [/previous|go back a chapter|last chapter/, () => nextCh(-1)],
    [/repeat|again/, () => { if (tour.on) startChapter(tour.i); }],
    [/start (the )?tour|begin tour|^tour/, () => { if (!tour.on) startTour(); }],
    [/back to (the )?beaker|show (the )?beaker/, () => goZoom(0)],
    [/zoom out|farther|further|move back|go back/, () => zoomStep(-1)],
    [/maximum|max zoom|closest/, () => goZoom(ZMAX)],
    [/zoom in|closer|nearer|magnify|zoom/, () => zoomStep(1)],
    [/dive|inside|molecule/, () => goZoom(1)],
    [/forward|go ahead|move|fly/, () => { voiceFlyUntil = performance.now() + 4000; }],
    [/faster|speed up/, () => setSpeed(cfg.sp + 1)],
    [/slower|slow down/, () => setSpeed(cfg.sp - 1)],
    [/diagram|map/, () => { cfg.diag = !cfg.diag; syncUI(); }],
    [/recent(re|er)|cent(re|er)/, () => recentre()],
    [/tap|ripple|wave/, () => tapBeaker()],
  ];
  function command(t) {
    const quiet = speech.speaking || performance.now() - speech.endT < 1500;   // ignore our own narration
    for (const [re, fn, always] of COMMANDS) if (re.test(t)) { if (quiet && !always) return false; fn(); heard = t.trim(); heardT = performance.now(); if (!vr) msg('🎤 ' + heard, 1500); return true; }
    return false;
  }
  function startVoice() {
    if (!SR) { msg('Voice commands are not supported in this browser (use Chrome).', 3500); return; }
    recog = new SR(); recog.lang = 'en-IN'; recog.continuous = true; recog.interimResults = false; recog.maxAlternatives = 3;
    recog.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) { if (!e.results[i].isFinal) continue; const alts = Array.from(e.results[i], (a) => a.transcript.toLowerCase()); if (!alts.some(command)) { heard = alts[0] + ' (?)'; heardT = performance.now(); } } };
    recog.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { msg('Microphone permission was not given. Voice commands are off.', 3500); stopVoice(); } };
    recog.onend = () => { if (voiceOn) setTimeout(() => { try { recog.start(); } catch (err) { /* running */ } }, 250); };
    voiceOn = true; $('bVoice').textContent = '🎤 on'; try { recog.start(); } catch (err) { /* ignore */ }
  }
  function stopVoice() { voiceOn = false; $('bVoice').textContent = '🎤 off'; try { recog && recog.stop(); } catch (err) { /* ignore */ } }
  $('bVoice').onclick = () => (voiceOn ? stopVoice() : startVoice());

  // ---------- headset ----------
  let vr = false, wakeLock = null;
  async function enterVR() {
    vr = true; document.body.classList.add('vr'); document.body.classList.remove('showui'); $('bVR').textContent = '👓 Exit'; $('fadeR').style.display = 'inline-block';
    try { await document.documentElement.requestFullscreen(); } catch (e) { /* optional */ }
    try { await screen.orientation.lock('landscape'); } catch (e) { /* optional */ }
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    if (!sensorOn) startSensor();
    onResize();
  }
  function exitVR() {
    vr = false; document.body.classList.remove('vr', 'showui'); $('bVR').textContent = '👓 Headset'; $('fadeR').style.display = 'none';
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
    try { screen.orientation.unlock(); } catch (e) { /* ignore */ }
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) { /* ignore */ }
    onResize();
  }
  $('bVR').onclick = () => (vr ? exitVR() : enterVR());
  document.addEventListener('visibilitychange', async () => { if (vr && document.visibilityState === 'visible' && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } } });

  // HUD inside the headset: title, science lines, subtitle, live numbers
  const hudCv = document.createElement('canvas'); hudCv.width = 1024; hudCv.height = 420;
  const hudCtx = hudCv.getContext('2d'), hudTex = new THREE.CanvasTexture(hudCv);
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.328), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  hud.position.set(0, -0.5, -1.1); hud.rotation.x = -0.42; hud.renderOrder = 10; camera.add(hud);
  const FONT = "system-ui,'Noto Sans Bengali','Noto Sans Devanagari','Noto Sans Oriya',sans-serif";
  function wrapText(c, text, maxW) { const words = text.split(' '), lines = []; let l = ''; for (const w of words) { const t = l ? l + ' ' + w : w; if (c.measureText(t).width > maxW && l) { lines.push(l); l = w; } else l = t; } if (l) lines.push(l); return lines; }

  function onResize() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    if (vr && innerHeight > innerWidth) msg('Turn the phone sideways'); else if ($('msg').textContent === 'Turn the phone sideways') msg('');
  }
  window.addEventListener('resize', onResize); onResize();

  const right = new THREE.Vector3();
  function render() {
    const w = innerWidth, h = innerHeight;
    hud.visible = vr; pdPlane.visible = cfg.diag && vr;
    if (!vr) { renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); camera.position.copy(camBase); renderer.render(scene, camera); return; }
    const half = w / 2; camera.aspect = half / h; camera.updateProjectionMatrix();
    const P = camera.projectionMatrix.clone(), sep = cfg.ipd * (160 / 25.4), shift = Math.max(-0.9, Math.min(0.9, (half - sep) / half));
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    renderer.setScissorTest(true);
    for (const eye of [-1, 1]) {
      const x0 = eye < 0 ? 0 : half;
      renderer.setScissor(x0, 0, half, h); renderer.setViewport(x0, 0, half, h);
      camera.projectionMatrix.copy(P); camera.projectionMatrix.elements[8] = eye < 0 ? -shift : shift; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.position.copy(camBase).addScaledVector(right, eye * cfg.ipd / 2000); camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    }
    camera.projectionMatrix.copy(P); camera.projectionMatrixInverse.copy(P).invert(); camera.position.copy(camBase); renderer.setScissorTest(false);
  }

  // ---------- settings ----------
  const SPLAB = ['paused', '0.5 fs / frame', '1 fs / frame', '2 fs / frame', '4 fs / frame', '8 fs / frame', '16 fs / frame', '32 fs / frame'];
  function syncUI() {
    $('sSp').value = cfg.sp; $('vSp').textContent = SPLAB[cfg.sp];
    $('sIPD').value = cfg.ipd; $('vIPD').textContent = cfg.ipd;
    $('bStyle').textContent = 'Style: ' + (cfg.style ? 'space-filling' : 'ball & stick');
    $('bHB').textContent = 'H-bonds: ' + (cfg.hb ? 'on' : 'off');
    $('bTrail').textContent = 'Trace one molecule: ' + (cfg.trail ? 'on' : 'off');
    $('bNarr').textContent = 'Narration: ' + (cfg.narr ? 'on' : 'off');
    $('bDiag').textContent = 'Phase diagram: ' + (cfg.diag ? 'on' : 'off');
    $('pd2d').style.display = cfg.diag && !vr ? 'block' : 'none';
    $('selLang').value = cfg.lang;
    for (const k in cfg) store.set(k, cfg[k]);
  }
  $('sSp').oninput = (e) => { cfg.sp = +e.target.value; syncUI(); };
  $('sIPD').oninput = (e) => { cfg.ipd = +e.target.value; syncUI(); };
  $('bStyle').onclick = () => { cfg.style ^= 1; syncUI(); };
  $('bHB').onclick = () => { cfg.hb = !cfg.hb; syncUI(); };
  $('bTrail').onclick = () => { cfg.trail = !cfg.trail; syncUI(); };
  $('bNarr').onclick = () => { cfg.narr = !cfg.narr; if (!cfg.narr) { try { speechSynthesis.cancel(); } catch (e) { /* none */ } } syncUI(); };
  $('bDiag').onclick = () => { cfg.diag = !cfg.diag; syncUI(); };
  $('selLang').onchange = (e) => { cfg.lang = e.target.value; syncUI(); if (tour.on && !tour.paused) speakChapter(tour.ch); };
  $('bSet').onclick = () => { const p = $('panel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; };
  $('bEq').onclick = () => { $('eq').style.display = 'block'; };
  $('bEqClose').onclick = () => { $('eq').style.display = 'none'; };
  $('stats').onclick = () => $('stats').classList.toggle('mini');
  syncUI(); freeUI(); setMarker(25, 0.101325, false);

  // ---------- stats, subtitles, HUD ----------
  function slowText() { if (rate.val <= 0) return 'paused'; const ps = rate.val * 1e-3; return `1 s on screen = ${ps < 1 ? (ps * 1000).toFixed(0) + ' fs' : ps.toFixed(2) + ' ps'} (≈${fmtMag(1 / (rate.val * 1e-15))}× slower)`; }
  function liveLine() {
    if (stage !== 'mol' || !cur.ready) return '';
    const hbm = cur.N ? 2 * stat.nhb / cur.N : 0;
    if (cur.def.rec) return `Recorded simulation · ${rec.data.h.T} K · t = ${(stat.t / 1000).toFixed(1)} ps · H-bonds/molecule ${hbm.toFixed(2)}`;
    return `Simulation: T ${stat.T.toFixed(0)} K · P ${stat.Pavg === null ? '…' : fmtBar(stat.Pavg)} · ρ ${(stat.rhoAvg || stat.rho).toFixed(cur.def.gas ? 5 : 3)} g/cm³ · H-bonds/molecule ${hbm.toFixed(2)}`;
  }
  function fmtBar(b) { const a = Math.abs(b); return a >= 10000 ? (b / 10000).toFixed(2) + ' GPa' : a >= 10 ? (b / 10).toFixed(0) + ' MPa' : b.toFixed(1) + ' bar'; }
  function updateStats() {
    const now = performance.now();
    if (now - rate.t0 > 1000) { rate.val = (stat.t - rate.s0) / ((now - rate.t0) / 1000); if (rate.val < 0) rate.val = 0; rate.t0 = now; rate.s0 = stat.t; }
    const ch = tour.on ? tour.ch : null;
    const title = ch ? chTitle(ch) : stage === 'mol' ? (cur.name || '') : 'Beaker of water';
    $('stats').innerHTML = `<b>${title}</b><br>Magnification ×${fmtMag(mag)}${stage === 'mol' ? ` · 1 Å looks like ${(molScale * 100).toFixed(1)} cm` : ''}<br>${liveLine() || 'Real-time surface waves'}<br>${stage === 'mol' && !cur.def.rec ? slowText() : ''}`;
    $('sci').innerHTML = ch ? ch.sci.map((s) => '<div>' + s + '</div>').join('') : '';
    $('sci').style.display = ch ? 'block' : 'none';
    $('sub').textContent = speech.sub; $('sub').style.display = speech.sub ? 'block' : 'none';
    // HUD
    const c = hudCtx; c.clearRect(0, 0, 1024, 420);
    c.fillStyle = 'rgba(8,22,38,0.78)'; c.beginPath(); c.roundRect ? c.roundRect(4, 4, 1016, 412, 28) : c.rect(4, 4, 1016, 412); c.fill();
    c.fillStyle = '#9fd3ff'; c.font = '600 34px ' + FONT; c.fillText(title, 28, 50);
    c.fillStyle = '#ffe9a6'; c.font = '24px ' + FONT; let y = 88;
    (ch ? ch.sci : [`Magnification ×${fmtMag(mag)}`]).forEach((s) => { wrapText(c, s, 960).slice(0, 2).forEach((l) => { c.fillText(l, 28, y); y += 30; }); });
    c.fillStyle = '#e8f1f8'; c.font = '30px ' + FONT;
    let ys = Math.max(y + 14, 236); wrapText(c, speech.sub || '', 960).slice(0, 3).forEach((l) => { c.fillText(l, 28, ys); ys += 38; });
    c.fillStyle = '#9db3c6'; c.font = '22px ' + FONT;
    c.fillText(now - heardT < 3000 ? '🎤 "' + heard + '"' : (liveLine() || 'Tap: buttons · Say "next", "pause", "zoom in"'), 28, 400);
    hudTex.needsUpdate = true;
  }

  // ---------- main loop ----------
  let last = performance.now(), statT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (Math.abs(zoomTarget - zoom) > 1e-4) { const s = Math.sign(zoomTarget - zoom); zoom += s * Math.min(Math.abs(zoomTarget - zoom), dt * zoomRate); }
    if ((flying || now < voiceFlyUntil) && stage === 'mol') { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).applyQuaternion(qAxis.clone().invert()); viewOff.addScaledVector(f, 3.0 * dt); }
    fadeOvCur += (fadeOv - fadeOvCur) * Math.min(1, dt * 8);
    updateOrientation(); applyZoom();
    if (fadeOvCur > 0.01) $('fade').style.opacity = Math.max(+$('fade').style.opacity, fadeOvCur).toFixed(3);
    if (macro.visible) { const sc = SCENES[macroName].g; sc.traverse((o) => { if (o.userData.update) o.userData.update(now / 1000, dt); }); }
    if (rec.on) recFrame(dt); else pumpSim();
    if (mol.visible) updateMolecules(stage, lastMolU);
    if (now - statT > 250) { updateStats(); statT = now; }
    render();
    requestAnimationFrame(frame);
  }
  loadState('liq298');
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  window.__wvr = { command, startTour, startChapter: (i) => { tour.on = true; startChapter(i); }, setView: (y, p) => { yaw = y; pitch = p; }, setZoom: (z) => { zoom = zoomTarget = z; }, loadState, enterVR, exitVR, stat, get stage() { return stage; }, get cur() { return cur; }, tour };
})();
