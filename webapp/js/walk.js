// Walk mode for the 3D campus map: a small low-poly student you steer around the campus.
// Desktop: WASD / arrows to move, Shift to run, Space to jump, drag the mouse to turn the camera, wheel to zoom,
// E to open info about the building you are next to, O to lock the mouse (mouse-look), Esc to leave.
// Zooming all the way in switches to a first-person view.
// Phones: on-screen joystick (push far to run), jump button, drag anywhere else to turn the camera.
// Collisions: the student is a 0.45 m circle pushed out of building footprints (2D, cheap and stable).
import * as THREE from 'three';
import { inside, bbox } from './map3d.js';

const R = 0.45;            // body radius (m)
const WALK = 4.2, RUN = 8.5; // m/s
const GRAVITY = 16, JUMP_V = 5.6;
const EYE = 1.55;

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

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createWalker({ scene, camera, el, data, pickables, extraSolids = [], limits, onNear, onInteract, onExit, onView }) {
  const s = makeStudent();
  s.group.visible = s.blob.visible = false;
  scene.add(s.group, s.blob);

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

  const emitView = () => onView?.({ fp: st.fp, locked: locked() });
  const minPitch = () => (st.fp ? -1.3 : 0.04);
  function turn(dx, dy) {
    st.yaw -= dx;
    st.pitch = THREE.MathUtils.clamp(st.pitch + dy, minPitch(), st.fp ? 1.3 : 1.2);
  }

  // O: lock the mouse to the view (pointer lock) -> moving the mouse turns the camera, no click needed
  const locked = () => document.pointerLockElement === el;
  let unlockedAt = 0;
  function toggleLock() {
    if (!st.on) return;
    if (locked()) { document.exitPointerLock(); return; }
    const fail = (e) => { console.warn('pointer lock', e); onView?.({ fp: st.fp, locked: false, lockError: true }); };
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
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
    const running = k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(st.joy.x, st.joy.y) > 0.92;
    const targetSpeed = mag > 0.05 ? (running ? RUN : WALK) * mag : 0;
    st.speed += (targetSpeed - st.speed) * Math.min(1, dt * 10);
    if (mag > 0.05) {
      const h = Math.atan2(mx, mz);
      st.heading += wrap(h - st.heading) * Math.min(1, dt * 12);
      const nx = st.x + (mx / mag) * st.speed * dt, nz = st.z + (mz / mag) * st.speed * dt;
      [st.x, st.z] = resolve(nx, nz);
    }
    // jump + gravity
    if (st.jumpReq && st.y <= 0.001) st.vy = JUMP_V;
    st.jumpReq = false;
    st.vy -= GRAVITY * dt;
    st.y = Math.max(0, st.y + st.vy * dt);
    if (st.y === 0 && st.vy < 0) st.vy = 0;

    // animate limbs
    const moving = st.speed / RUN;
    st.phase += dt * (3 + st.speed * 1.9);
    const swing = Math.sin(st.phase) * Math.min(0.95, 0.25 + moving * 1.1) * (st.speed > 0.2 ? 1 : 0);
    const air = st.y > 0.05 ? 0.6 : 0;
    s.legL.rotation.x += (swing + air - s.legL.rotation.x) * Math.min(1, dt * 14);
    s.legR.rotation.x += (-swing - air * 0.3 - s.legR.rotation.x) * Math.min(1, dt * 14);
    s.armL.rotation.x += (-swing * 0.85 - air - s.armL.rotation.x) * Math.min(1, dt * 14);
    s.armR.rotation.x += (swing * 0.85 - air - s.armR.rotation.x) * Math.min(1, dt * 14);
    const bob = st.speed > 0.2 && st.y === 0 ? Math.abs(Math.sin(st.phase)) * 0.06 : Math.sin(st.t * 2) * 0.012;
    s.group.position.set(st.x, st.y + bob, st.z);
    s.group.rotation.y = st.heading;
    s.group.rotation.x = 0;
    s.blob.position.set(st.x, 0.4, st.z);
    s.blob.scale.setScalar(1 - Math.min(0.5, st.y * 0.25));

    const near = st.fp ? 0.12 : 1;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    s.group.visible = s.blob.visible = !st.fp;
    if (st.fp) {
      // first person: camera sits in the head and looks where the mouse points
      setOccluders([]);
      camPitch += (st.pitch - camPitch) * Math.min(1, dt * 25);
      const cp = Math.cos(camPitch);
      dir.set(Math.sin(st.yaw) * cp, Math.sin(camPitch), Math.cos(st.yaw) * cp).normalize();
      look.set(st.x, st.y + 1.74 + (st.speed > 0.2 && st.y === 0 ? Math.sin(st.phase * 2) * 0.035 : 0), st.z);
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
    st.pitch = 0.32; st.dist = 8; camPitch = 0.32; st.fp = false;
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    s.group.visible = s.blob.visible = true;
    st.on = true;
    emitView();
  }
  function exit() {
    if (locked()) document.exitPointerLock();
    st.on = false;
    st.fp = false;
    if (camera.near !== 1) { camera.near = 1; camera.updateProjectionMatrix(); }
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    s.group.visible = s.blob.visible = false;
    setOccluders([]);
    onNear?.(null);
    st.nearIdx = -1;
  }
  function teleport(x, z, lookAt) {
    [st.x, st.z] = freeSpot(x, z);
    st.y = 0; st.vy = 0; st.t = 0.6; // short glide
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
