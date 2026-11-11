// Walk mode for the 3D campus map: a small low-poly student you steer around the campus.
// Desktop: WASD / arrows to move, Shift to run, Space to jump, drag the mouse to turn the camera, wheel to zoom,
// E to open info about the building you are next to, O to lock the mouse (mouse-look), Esc to leave.
// Zooming all the way in switches to a first-person view.
// Phones: on-screen joystick (push far to run), jump button, drag anywhere else to turn the camera.
// 1 / 2 / 3: walk, scooter, motorbike. On a bike: W/S throttle and brake, A/D steer, Space = horn.
// Collisions: the student is a 0.45 m circle pushed out of building footprints (2D, cheap and stable).
import * as THREE from 'three';
import { inside, bbox } from './map3d.js';

const SCALE = 0.76;          // student is ~1.65 m tall
let R = 0.34;                // collision radius (m); larger on a bike
const WALK = 3.6, RUN = 7.2; // m/s
const GRAVITY = 16, JUMP_V = 4.8;
const EYE = 1.2;

/** Low-poly student made from primitives (original design). */
function makeStudent() {
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const shirt = M(0x2f6bff), pants = M(0x26324a), skin = M(0xf1c7a1), hair = M(0x2b2018), bag = M(0xe5484d), shoe = M(0x1b1f2a), white = M(0xffffff);
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  add(new THREE.CapsuleGeometry(0.3, 0.42, 4, 10), shirt, 0, 1.28, 0);           // torso
  add(new THREE.BoxGeometry(0.5, 0.56, 0.22), bag, 0, 1.32, -0.3);              // backpack
  add(new THREE.BoxGeometry(0.36, 0.12, 0.06), M(0xc2313a), 0, 1.12, -0.43);    // bag pocket
  const head = add(new THREE.SphereGeometry(0.27, 14, 10), skin, 0, 1.94, 0);
  const cap = add(new THREE.SphereGeometry(0.285, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.97, -0.01);
  cap.scale.set(1, 0.9, 1);
  add(new THREE.SphereGeometry(0.035, 6, 6), shoe, -0.09, 1.97, 0.245);           // eyes
  add(new THREE.SphereGeometry(0.035, 6, 6), shoe, 0.09, 1.97, 0.245);
  add(new THREE.BoxGeometry(0.06, 0.02, 0.02), white, 0, 1.86, 0.26);           // smile hint

  const limb = (x, y, len, rad, mat, footMat) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot);
    add(new THREE.CapsuleGeometry(rad, len, 3, 8), mat, 0, -len / 2 - rad, 0, pivot);
    if (footMat) add(new THREE.BoxGeometry(0.2, 0.1, 0.3), footMat, 0, -len - rad * 2 + 0.03, 0.05, pivot);
    return pivot;
  };
  const legL = limb(-0.15, 0.9, 0.5, 0.11, pants, shoe), legR = limb(0.15, 0.9, 0.5, 0.11, pants, shoe);
  const armL = limb(-0.42, 1.58, 0.42, 0.085, shirt), armR = limb(0.42, 1.58, 0.42, 0.085, shirt);
  // hands
  for (const a of [armL, armR]) add(new THREE.SphereGeometry(0.09, 8, 6), skin, 0, -0.62, 0, a);

  // soft blob shadow so the student stays visible even outside the shadow map
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.4;
  blob.renderOrder = 1;
  return { group: g, legL, legR, armL, armR, head, blob };
}


/** Low-poly scooter (xe tay ga) and motorbike (xe số), front along +z. Returns { group, wheels, fork }. */
function vehicleKit() {
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const make = () => {
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, p = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m; };
    const wheel = (parent, z, r, tire, rim) => {
      const w = new THREE.Group(); w.position.set(0, r, z); parent.add(w);
      add(new THREE.CylinderGeometry(r, r, 0.12, 18).rotateZ(Math.PI / 2), tire, 0, 0, 0, w);
      add(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.13, 10).rotateZ(Math.PI / 2), rim, 0, 0, 0, w);
      return w;
    };
    return { g, add, wheel };
  };
  const tire = M(0x151515), chrome = M(0xc9ced5), dark = M(0x1f2328), light = M(0xfff1b8), red = M(0xd8312b);

  function scooter() {
    const { g, add, wheel } = make();
    const body = M(0xeef3f6), accent = M(0x2f6bff);
    const fork = new THREE.Group(); fork.position.set(0, 0, 0.5); g.add(fork);
    const wheels = [wheel(g, -0.6, 0.23, tire, chrome), wheel(fork, 0.12, 0.23, tire, chrome)];
    add(new THREE.BoxGeometry(0.36, 0.1, 0.72), body, 0, 0.3, 0.02);                     // floorboard
    add(new THREE.BoxGeometry(0.44, 0.42, 0.8), body, 0, 0.53, -0.42);                   // rear body
    add(new THREE.BoxGeometry(0.46, 0.07, 0.62), accent, 0, 0.5, -0.42);                 // side stripe
    add(new THREE.BoxGeometry(0.34, 0.1, 0.72), dark, 0, 0.79, -0.38);                   // seat
    add(new THREE.BoxGeometry(0.2, 0.07, 0.05), red, 0, 0.63, -0.83);                    // tail light
    const shield = add(new THREE.BoxGeometry(0.44, 0.78, 0.14), body, 0, 0.64, 0.37);    // leg shield
    shield.rotation.x = -0.2;
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8), chrome, 0, 0.82, 0, fork);      // steering column
    add(new THREE.BoxGeometry(0.62, 0.05, 0.05), dark, 0, 1.08, -0.02, fork);            // handlebar
    add(new THREE.BoxGeometry(0.2, 0.16, 0.16), body, 0, 1.02, 0.04, fork);              // head cover
    add(new THREE.BoxGeometry(0.15, 0.08, 0.04), light, 0, 1.0, 0.13, fork);             // headlight
    add(new THREE.BoxGeometry(0.16, 0.06, 0.42), body, 0, 0.5, 0.14, fork);              // front fender
    for (const sx of [-0.24, 0.24]) add(new THREE.BoxGeometry(0.07, 0.05, 0.02), chrome, sx, 1.2, 0, fork); // mirrors
    return { group: g, wheels, wheelR: 0.23, fork, seatY: 0.2, legs: -1.05, arms: -1.2 };
  }

  function moto() {
    const { g, add, wheel } = make();
    const paint = M(0xc8202a);
    const fork = new THREE.Group(); fork.position.set(0, 0, 0.55); g.add(fork);
    const wheels = [wheel(g, -0.66, 0.3, tire, chrome), wheel(fork, 0.13, 0.3, tire, chrome)];
    add(new THREE.BoxGeometry(0.28, 0.24, 0.52), paint, 0, 0.78, 0.1);                   // tank
    add(new THREE.BoxGeometry(0.32, 0.3, 0.5), paint, 0, 0.64, -0.34);                   // side covers
    add(new THREE.BoxGeometry(0.3, 0.1, 0.78), dark, 0, 0.88, -0.32);                    // seat
    add(new THREE.BoxGeometry(0.28, 0.3, 0.36), M(0x4b5058), 0, 0.42, -0.02);             // engine
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.75, 8).rotateX(Math.PI / 2), chrome, 0.2, 0.34, -0.36); // exhaust
    add(new THREE.BoxGeometry(0.16, 0.05, 0.42), paint, 0, 0.72, -0.72);                 // rear fender
    add(new THREE.BoxGeometry(0.18, 0.07, 0.05), red, 0, 0.74, -0.94);                   // tail light
    add(new THREE.BoxGeometry(0.06, 0.06, 0.9), dark, 0, 0.58, -0.2);                    // frame
    for (const sx of [-0.09, 0.09]) { const f = add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), chrome, sx, 0.66, 0.02, fork); f.rotation.x = -0.32; }
    add(new THREE.BoxGeometry(0.68, 0.04, 0.04), dark, 0, 1.03, -0.08, fork);            // handlebar
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12).rotateX(Math.PI / 2), light, 0, 0.93, 0.08, fork); // headlight
    add(new THREE.BoxGeometry(0.16, 0.05, 0.36), paint, 0, 0.66, 0.15, fork);            // front fender
    for (const sx of [-0.26, 0.26]) add(new THREE.BoxGeometry(0.07, 0.05, 0.02), chrome, sx, 1.16, -0.08, fork);
    return { group: g, wheels, wheelR: 0.3, fork, seatY: 0.28, legs: -1.3, arms: -1.15 };
  }
  return { scooter: scooter(), moto: moto() };
}

// Riding: top speed (m/s, ~32 and ~45 km/h), acceleration, Shift = a bit faster.
const RIDE = { scooter: { max: 9, accel: 5 }, moto: { max: 12.5, accel: 7 } };
let audio = null;
let lastHorn = 0;
function horn() {
  const now = performance.now();
  if (now - lastHorn < 450) return;
  lastHorn = now;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    for (const [s0, d] of [[0, 0.11], [0.16, 0.18]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = 415;
      g.gain.setValueAtTime(0.0001, t + s0);
      g.gain.exponentialRampToValueAtTime(0.09, t + s0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s0 + d);
      o.connect(g).connect(audio.destination);
      o.start(t + s0); o.stop(t + s0 + d + 0.05);
    }
  } catch { /* no audio */ }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createWalker({ scene, camera, el, data, pickables, extraSolids = [], limits, onNear, onInteract, onExit, onView }) {
  const s = makeStudent();
  s.group.scale.setScalar(SCALE);
  const rig = new THREE.Group(); // position + heading; holds the student and the vehicles
  rig.add(s.group);
  const kit = vehicleKit();
  for (const v of Object.values(kit)) { v.group.visible = false; rig.add(v.group); }
  rig.visible = s.blob.visible = false;
  scene.add(rig, s.blob);

  const solids = data.buildings.map((b, i) => ({ pts: b.pts, box: bbox([b.pts]), i }));
  for (const pts of extraSolids) solids.push({ pts, box: bbox([pts]), i: -1 }); // gate structures (no info card)
  // perimeter wall segments (thin, so only a distance check)
  const wallSegs = [];
  for (const w of data.walls || []) for (let i = 0; i < w.length - 1; i++) {
    const a = w[i], b = w[i + 1];
    wallSegs.push({ a, b, minX: Math.min(a[0], b[0]) - 1, maxX: Math.max(a[0], b[0]) + 1, minZ: Math.min(a[1], b[1]) - 1, maxZ: Math.max(a[1], b[1]) + 1 });
  }
  const st = {
    on: false, x: 0, z: 0, y: 0, vy: 0, heading: 0, yaw: 0, pitch: 0.3, dist: 8, phase: 0, speed: 0,
    keys: new Set(), joy: { x: 0, y: 0 }, jumpReq: false, t: 0, nearIdx: -1, nearTimer: 0, fp: false,
    mode: 'walk', v: 0, steer: 0, lastTurn: -9,
  };
  const FP_DIST = 2.2; // zooming closer than this switches to first person

  // ---------- collision ----------
  function nearestEdge(pts, x, z) {
    let best = Infinity, bx = 0, bz = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j][0], az = pts[j][1], dx = pts[i][0] - ax, dz = pts[i][1] - az;
      const L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
      const px = ax + dx * t, pz = az + dz * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; bx = px; bz = pz; }
    }
    return { d: Math.sqrt(best), bx, bz };
  }
  function resolve(x, z) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const b of solids) {
        if (x < b.box.minX - R || x > b.box.maxX + R || z < b.box.minZ - R || z > b.box.maxZ + R) continue;
        const ins = inside(b.pts, x, z);
        const { d, bx, bz } = nearestEdge(b.pts, x, z);
        if (ins) {
          const nx = (bx - x) / (d || 1), nz = (bz - z) / (d || 1);
          x = bx + nx * R; z = bz + nz * R; moved = true;
        } else if (d < R) {
          const nx = (x - bx) / (d || 1), nz = (z - bz) / (d || 1);
          x = bx + nx * R; z = bz + nz * R; moved = true;
        }
      }
      for (const s of wallSegs) {
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
        const { d, bx, bz } = nearestEdge([s.a, s.b], x, z);
        const r = R + 0.18;
        if (d < r) { const nx = (x - bx) / (d || 1), nz = (z - bz) / (d || 1); x = bx + nx * r; z = bz + nz * r; moved = true; }
      }
      if (!moved) break;
    }
    x = THREE.MathUtils.clamp(x, limits.minX, limits.maxX);
    z = THREE.MathUtils.clamp(z, limits.minZ, limits.maxZ);
    return [x, z];
  }
  const blocked = (x, z) => solids.some((b) => x > b.box.minX - R && x < b.box.maxX + R && z > b.box.minZ - R && z < b.box.maxZ + R
    && (inside(b.pts, x, z) || nearestEdge(b.pts, x, z).d < R + 0.3));
  /** Closest free spot to (x, z), searching outwards in rings. */
  function freeSpot(x, z) {
    if (!blocked(x, z)) return [x, z];
    for (let r = 2; r <= 90; r += 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!blocked(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  // ---------- input ----------
  const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
  function keydown(e) {
    if (!st.on || isTyping()) return;
    if (MOVE_KEYS.includes(e.code)) { st.keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Space') { st.jumpReq = true; e.preventDefault(); }
    if (e.code === 'Digit1' || e.code === 'Numpad1') setMode('walk');
    if (e.code === 'Digit2' || e.code === 'Numpad2') setMode('scooter');
    if (e.code === 'Digit3' || e.code === 'Numpad3') setMode('moto');
    if (e.code === 'KeyE' || e.code === 'Enter') onInteract?.(st.nearIdx >= 0 ? data.buildings[st.nearIdx] : null);
    if (e.code === 'KeyO') { toggleLock(); e.preventDefault(); }
    if (e.code === 'KeyF' || e.code === 'KeyV') setFirstPerson(!st.fp);
    // Esc first releases a locked mouse (the browser does that); only a separate Esc leaves walk mode.
    if (e.code === 'Escape' && !locked() && performance.now() - unlockedAt > 400) onExit?.();
  }
  function keyup(e) { st.keys.delete(e.code); }
  const blur = () => st.keys.clear();
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  const emitView = () => onView?.({ fp: st.fp, locked: locked(), mode: st.mode });
  const minPitch = () => (st.fp ? -1.3 : 0.04);
  function turn(dx, dy) {
    st.lastTurn = st.t;
    st.yaw -= dx;
    st.pitch = THREE.MathUtils.clamp(st.pitch + dy, minPitch(), st.fp ? 1.3 : 1.2);
  }

  // O: lock the mouse to the view (pointer lock) -> moving the mouse turns the camera, no click needed
  const locked = () => document.pointerLockElement === el;
  let unlockedAt = 0;
  function toggleLock() {
    if (!st.on) return;
    if (locked()) { document.exitPointerLock(); return; }
    const fail = (e) => { console.warn('pointer lock', e); onView?.({ fp: st.fp, locked: false, lockError: true, mode: st.mode }); };
    const fallback = () => {
      try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(fail); } catch (e) { fail(e); }
    };
    if (!el.requestPointerLock) return fail(new Error('unsupported'));
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fallback);
    } catch { fallback(); }
  }
  const lockChange = () => { if (!locked()) unlockedAt = performance.now(); drag = null; emitView(); };
  document.addEventListener('pointerlockchange', lockChange);
  const mousemove = (e) => { if (st.on && locked()) turn(e.movementX * 0.0024, e.movementY * 0.0021); };
  document.addEventListener('mousemove', mousemove);

  /** Walk / ride a scooter / ride a motorbike. */
  function setMode(m) {
    if (!st.on || m === st.mode || !(m === 'walk' || RIDE[m])) return;
    st.mode = m;
    st.v = 0; st.speed = 0; st.steer = 0; st.y = 0; st.vy = 0;
    R = m === 'walk' ? 0.34 : 0.62;
    [st.x, st.z] = freeSpot(st.x, st.z);
    for (const [k, v] of Object.entries(kit)) v.group.visible = k === m;
    s.group.position.set(0, 0, 0); s.group.rotation.set(0, 0, 0);
    if (!st.fp) st.dist = m === 'walk' ? 6.5 : 7.5;
    emitView();
  }

  // zoom; past FP_DIST the camera goes into the student's head (first person)
  function setFirstPerson(on) {
    if (on === st.fp) return;
    st.fp = on;
    if (on) { st.dist = FP_DIST; st.pitch = Math.min(st.pitch, 0.06); }
    else { st.dist = Math.max(st.dist, 3); st.pitch = Math.max(st.pitch, 0.12); }
    emitView();
  }
  function zoomBy(f) {
    if (!st.on) return;
    if (st.fp) { if (f > 1.0001) { setFirstPerson(false); st.dist = 3; } return; }
    const nd = st.dist * f;
    if (nd < FP_DIST) setFirstPerson(true);
    else st.dist = Math.min(26, nd);
  }

  // drag to turn the camera (when the mouse is not locked), wheel to zoom
  let drag = null;
  el.addEventListener('pointerdown', (e) => { if (st.on && !locked()) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; } });
  const pointermove = (e) => {
    if (!st.on || !drag || drag.id !== e.pointerId || locked()) return;
    turn((e.clientX - drag.x) * 0.0062, (e.clientY - drag.y) * 0.0042);
    drag.x = e.clientX; drag.y = e.clientY;
  };
  window.addEventListener('pointermove', pointermove);
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  el.addEventListener('wheel', (e) => { if (!st.on) return; e.preventDefault(); zoomBy(1 + THREE.MathUtils.clamp(e.deltaY, -120, 120) * 0.0012); }, { passive: false });
  // two-finger pinch zoom on phones
  const touches = new Map();
  let pinch = null;
  el.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) touches.set(t.identifier, t); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; drag = null; } }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) touches.set(t.identifier, t);
    if (st.on && pinch && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (d > 0) { zoomBy(pinch.d / d); pinch.d = d; } }
  }, { passive: true });
  const touchEnd = (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); if (touches.size < 2) pinch = null; };
  el.addEventListener('touchend', touchEnd, { passive: true });
  el.addEventListener('touchcancel', touchEnd, { passive: true });

  // ---------- camera ----------
  const look = new THREE.Vector3(), want = new THREE.Vector3(), dir = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  // A building between the camera and the student fades out (x-ray), so the camera never has to crowd in.
  const faded = new Set();
  function setOccluders(list) {
    for (const m of [...faded]) if (!list.includes(m)) { m.material = m.userData.solidMat; faded.delete(m); }
    for (const m of list) {
      if (faded.has(m)) continue;
      m.userData.solidMat ??= m.material;
      m.userData.fadeMat ??= m.userData.solidMat.map((x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.22; c.depthWrite = false; return c; });
      m.material = m.userData.fadeMat;
      faded.add(m);
    }
  }
  let camPitch = 0.3;
  function cameraTarget(dt) {
    look.set(st.x, st.y + EYE, st.z);
    camPitch += (st.pitch - camPitch) * Math.min(1, dt * 6);
    const cp = Math.cos(camPitch);
    dir.set(Math.sin(st.yaw) * cp, Math.sin(camPitch), Math.cos(st.yaw) * cp).normalize();
    ray.set(look, dir); ray.far = st.dist;
    const hits = ray.intersectObjects(pickables, false);
    setOccluders([...new Set(hits.map((h) => h.object))]);
    want.copy(look).addScaledVector(dir, st.dist);
    if (want.y < 0.6) want.y = 0.6;
  }

  // ---------- per-frame update ----------
  function update(dt) {
    dt = Math.min(dt, 0.05);
    st.t += dt;
    const k = st.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    f += st.joy.y; r += st.joy.x;
    const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);   // camera forward on the ground
    const rx = Math.cos(st.yaw), rz = -Math.sin(st.yaw);    // camera right
    const riding = st.mode !== 'walk';
    const boost = k.has('ShiftLeft') || k.has('ShiftRight');
    if (!riding) {
      let mx = fx * f + rx * r, mz = fz * f + rz * r;
      let mag = Math.hypot(mx, mz);
      if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
      const running = boost || Math.hypot(st.joy.x, st.joy.y) > 0.92;
      const targetSpeed = mag > 0.05 ? (running ? RUN : WALK) * mag : 0;
      st.speed += (targetSpeed - st.speed) * Math.min(1, dt * 10);
      if (mag > 0.05) {
        const h = Math.atan2(mx, mz);
        st.heading += wrap(h - st.heading) * Math.min(1, dt * 12);
        const nx = st.x + (mx / mag) * st.speed * dt, nz = st.z + (mz / mag) * st.speed * dt;
        [st.x, st.z] = resolve(nx, nz);
      }
    } else {
      // bike: throttle / brake on W-S (joystick up-down), steer with A-D (joystick left-right)
      const P = RIDE[st.mode];
      const thr = THREE.MathUtils.clamp(f, -1, 1), str = THREE.MathUtils.clamp(r, -1, 1);
      if (thr > 0.05) st.v += P.accel * thr * dt * (st.v < 0 ? 2.5 : 1);
      else if (thr < -0.05) st.v -= (st.v > 0.3 ? 11 : 3) * -thr * dt;
      else st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), 2.4 * dt);
      st.v = THREE.MathUtils.clamp(st.v, -2.5, P.max * (boost ? 1.3 : 1));
      st.steer += (str - st.steer) * Math.min(1, dt * 7);
      const grip = Math.min(1, Math.abs(st.v) / 3) * (st.v < 0 ? -1 : 1);
      st.heading -= st.steer * 1.8 * grip * dt;
      const sx = Math.sin(st.heading), sz = Math.cos(st.heading);
      const ox = st.x, oz = st.z;
      [st.x, st.z] = resolve(st.x + sx * st.v * dt, st.z + sz * st.v * dt);
      const moved = Math.hypot(st.x - ox, st.z - oz), want = Math.abs(st.v * dt);
      if (want > 0.02 && moved < want * 0.55) st.v *= 0.55; // bumped into something
      st.speed = Math.abs(st.v);
      // camera swings back behind the bike unless the player turned it recently
      if (st.t - st.lastTurn > 1.2 && st.speed > 0.6) st.yaw += wrap(st.heading + Math.PI - st.yaw) * Math.min(1, dt * 2.2);
      if (st.jumpReq) horn();
    }
    // jump + gravity (on foot only)
    if (st.jumpReq && st.y <= 0.001 && !riding) st.vy = JUMP_V;
    st.jumpReq = false;
    st.vy -= GRAVITY * dt;
    st.y = Math.max(0, st.y + st.vy * dt);
    if (st.y === 0 && st.vy < 0) st.vy = 0;

    // animate limbs (or the riding pose)
    const moving = Math.min(1, st.speed / RUN);
    st.phase += dt * (3 + st.speed * 1.9);
    const swing = Math.sin(st.phase) * Math.min(0.95, 0.25 + moving * 1.1) * (st.speed > 0.2 ? 1 : 0);
    const air = st.y > 0.05 ? 0.6 : 0;
    const ease = Math.min(1, dt * 14);
    if (riding) {
      const V = kit[st.mode];
      for (const [limb, target] of [[s.legL, V.legs], [s.legR, V.legs], [s.armL, V.arms], [s.armR, V.arms]]) limb.rotation.x += (target - limb.rotation.x) * ease;
      s.group.position.set(0, V.seatY, -0.3);
      s.group.rotation.x = 0.12;
      for (const w of V.wheels) w.rotation.x += (st.v * dt) / V.wheelR;
      V.fork.rotation.y = -st.steer * 0.38;
      rig.position.set(st.x, 0, st.z);
      rig.rotation.set(0, st.heading, st.steer * 0.2 * Math.min(1, st.speed / 6)); // lean into turns
      s.blob.scale.set(1.1, 1.9, 1);
    } else {
      s.legL.rotation.x += (swing + air - s.legL.rotation.x) * ease;
      s.legR.rotation.x += (-swing - air * 0.3 - s.legR.rotation.x) * ease;
      s.armL.rotation.x += (-swing * 0.85 - air - s.armL.rotation.x) * ease;
      s.armR.rotation.x += (swing * 0.85 - air - s.armR.rotation.x) * ease;
      const bob = st.speed > 0.2 && st.y === 0 ? Math.abs(Math.sin(st.phase)) * 0.045 : Math.sin(st.t * 2) * 0.01;
      s.group.position.set(0, bob, 0);
      s.group.rotation.x = 0;
      rig.position.set(st.x, st.y, st.z);
      rig.rotation.set(0, st.heading, 0);
      s.blob.scale.setScalar(0.8 * (1 - Math.min(0.5, st.y * 0.25)));
    }
    s.blob.position.set(st.x, 0.4, st.z);
    s.blob.rotation.z = st.heading;

    const near = st.fp ? 0.12 : 1;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    rig.visible = s.blob.visible = !st.fp;
    if (st.fp) {
      // first person: camera sits in the head and looks where the mouse points
      setOccluders([]);
      camPitch += (st.pitch - camPitch) * Math.min(1, dt * 25);
      const cp = Math.cos(camPitch);
      dir.set(Math.sin(st.yaw) * cp, Math.sin(camPitch), Math.cos(st.yaw) * cp).normalize();
      const head = riding ? kit[st.mode].seatY + 1.25 : 1.5;
      look.set(st.x, st.y + head + (!riding && st.speed > 0.2 && st.y === 0 ? Math.sin(st.phase * 2) * 0.03 : 0), st.z);
      camera.position.copy(look);
      want.copy(look).sub(dir);
      camera.lookAt(want);
    } else {
      // camera follows smoothly (slower right after entering, so it glides in from the overview)
      cameraTarget(dt);
      const follow = st.t < 1.4 ? 2.6 : 9;
      camera.position.lerp(want, 1 - Math.exp(-dt * follow));
      camera.lookAt(look);
    }

    // nearby building (checked a few times per second)
    st.nearTimer -= dt;
    if (st.nearTimer <= 0) {
      st.nearTimer = 0.2;
      let best = -1, bd = 6.5;
      for (const b of solids) {
        if (b.i < 0) continue;
        if (st.x < b.box.minX - bd || st.x > b.box.maxX + bd || st.z < b.box.minZ - bd || st.z > b.box.maxZ + bd) continue;
        const { d } = nearestEdge(b.pts, st.x, st.z);
        if (d < bd) { bd = d; best = b.i; }
      }
      if (best !== st.nearIdx) { st.nearIdx = best; onNear?.(best >= 0 ? data.buildings[best] : null); }
    }
    return look;
  }

  function enter({ x, z, facing }) {
    [st.x, st.z] = freeSpot(x, z);
    st.y = 0; st.vy = 0; st.speed = 0; st.t = 0; st.nearIdx = -1; st.nearTimer = 0;
    st.heading = facing ?? 0;
    st.yaw = st.heading + Math.PI; // camera behind the student
    st.pitch = 0.32; st.dist = 6.5; camPitch = 0.32; st.fp = false;
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    st.mode = 'walk'; st.v = 0; st.steer = 0; R = 0.34;
    for (const v of Object.values(kit)) v.group.visible = false;
    rig.visible = s.blob.visible = true;
    st.on = true;
    emitView();
  }
  function exit() {
    if (locked()) document.exitPointerLock();
    st.on = false;
    st.fp = false;
    if (camera.near !== 1) { camera.near = 1; camera.updateProjectionMatrix(); }
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    rig.visible = s.blob.visible = false;
    setOccluders([]);
    onNear?.(null);
    st.nearIdx = -1;
  }
  function teleport(x, z, lookAt) {
    [st.x, st.z] = freeSpot(x, z);
    st.y = 0; st.vy = 0; st.v = 0; st.t = 0.6; // short glide
    if (lookAt) {
      st.heading = Math.atan2(lookAt[0] - st.x, lookAt[1] - st.z);
      st.yaw = st.heading + Math.PI; // camera behind, looking at the building
      if (!st.fp) st.pitch = Math.max(st.pitch, 0.25);
    }
  }

  return {
    state: st,
    enter, exit, update, teleport, freeSpot,
    setJoy(x, y) { st.joy.x = x; st.joy.y = y; },
    jump() { st.jumpReq = true; },
    setMode,
    toggleLock, setFirstPerson, isLocked: locked,
    dispose() {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointermove', pointermove);
      window.removeEventListener('pointercancel', endDrag);
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('mousemove', mousemove);
      if (locked()) document.exitPointerLock();
    },
  };
}
