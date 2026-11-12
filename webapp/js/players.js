// Other students in server mode: one low-poly avatar per player, moved smoothly towards the last position the
// server sent (positions arrive a few times per second), with the same walking / riding / sitting animation as
// your own, football kits and the football moves (kick, volley, header, bicycle kick, slide tackle, dribble burst).
// A player riding pillion (on the back seat of someone's scooter / motorbike) is drawn on that bike every frame.
import * as THREE from 'three';
import { makeStudent, disposeStudent, vehicleKit, limbPose, MOVE_T, SCALE, pillionPose } from './walk.js';

export const MODES = ['walk', 'scooter', 'moto']; // mode 3 = sitting on the stands, 4 = on someone's back seat
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createPlayers(scene) {
  const root = new THREE.Group();
  root.name = 'players';
  scene.add(root);
  const list = new Map(); // id -> player
  const pickables = [];
  let meId = null; // you (your bike is drawn by the walker, not here)

  function tagMeshes(p) {
    const meshes = [];
    p.rig.traverse((o) => { if (o.isMesh) { o.userData.playerId = p.id; meshes.push(o); } });
    p.meshes = meshes;
    rebuildPickables();
  }
  function rebuildPickables() {
    pickables.length = 0;
    for (const p of list.values()) pickables.push(...p.meshes);
  }

  function build(p, look, kit = p.kit) {
    if (p.s) { p.rig.remove(p.s.group); root.remove(p.s.blob); disposeStudent(p.s); }
    p.look = look; p.kit = kit;
    p.s = makeStudent(look, kit);
    p.s.group.scale.setScalar(SCALE);
    p.rig.add(p.s.group);
    root.add(p.s.blob);
    tagMeshes(p);
  }

  function add(id, look, pos) {
    if (list.has(id)) { setLook(id, look); if (pos) setPos(id, pos, true); return; }
    const p = { id, rig: new THREE.Group(), s: null, kit: null, x: 0, z: 0, y: 0, h: 0, mode: 0, speed: 0, phase: Math.random() * 6,
      tx: 0, tz: 0, ty: 0, th: 0, seen: false, ride: null, seated: false, wave: 0, kick: 0, volley: 0, slide: 0, bike: 0, head: 0, dash: 0, meshes: [], look: null, kit: null };
    root.add(p.rig);
    list.set(id, p);
    build(p, look);
    p.rig.visible = p.s.blob.visible = false;
    if (pos) setPos(id, pos, true);
  }
  function setLook(id, look) { const p = list.get(id); if (p) build(p, look); }
  /** Football kit on (or off with null). */
  function setKit(id, kit) {
    const p = list.get(id);
    if (!p || p.kit === kit) return;
    const visible = p.rig.visible;
    build(p, p.look, kit);
    p.s.blob.visible = visible;
  }
  function setPos(id, pos, snap = false) {
    const p = list.get(id); if (!p || !Array.isArray(pos)) return;
    [p.tx, p.tz, p.ty, p.th] = pos;
    const mode = Math.max(0, Math.min(4, pos[4] | 0));
    p.speed = pos[5] || 0;
    if (mode !== p.mode) setMode(p, mode);
    if (snap || !p.seen || Math.hypot(p.tx - p.x, p.tz - p.z) > 25) { p.x = p.tx; p.z = p.tz; p.y = p.ty; p.h = p.th; }
    p.seen = true;
    p.rig.visible = p.s.blob.visible = true;
  }
  function setMode(p, mode) {
    p.mode = mode;
    if ((mode === 1 || mode === 2) && !p.bikes) {
      p.bikes = vehicleKit();
      for (const v of Object.values(p.bikes)) { v.group.visible = false; p.rig.add(v.group); }
      tagMeshes(p);
    }
    if (p.bikes) for (const [k, v] of Object.entries(p.bikes)) v.group.visible = k === MODES[mode];
  }
  /** Player `id` sits on the back seat of `driver`'s bike (null: got off). */
  function setRide(id, driver) {
    const p = list.get(id); if (!p) return;
    p.ride = driver || null;
    if (!p.ride) { p.seated = false; p.s.blob.visible = p.rig.visible; p.x = p.tx; p.z = p.tz; p.y = p.ty; p.h = p.th; }
  }
  /** Puts a passenger on a bike at (x, y, z), heading h, leaning roll; mode 1 scooter / 2 motorbike. */
  function seat(p, x, y, z, h, roll, mode) {
    const s = p.s, P = pillionPose(mode);
    p.x = x; p.y = y; p.z = z; p.h = h; p.seated = true;
    p.rig.position.set(x, y, z);
    p.rig.rotation.set(0, h, roll);
    for (const [limb, a] of [[s.legL, P.legs], [s.legR, P.legs], [s.armL, P.arms], [s.armR, P.arms]]) { limb.rotation.x = a; limb.rotation.z = 0; }
    s.group.position.set(0, P.y, P.z);
    s.group.rotation.set(P.lean, 0, 0);
    s.blob.visible = false;
  }
  /** Passengers on your own bike, placed after your student moved this frame. Returns true if there were any. */
  function seatOnMe(x, y, z, h, roll, mode) {
    let any = false;
    for (const p of list.values()) if (p.ride && p.ride === meId && p.seen) { seat(p, x, y, z, h, roll, mode); any = true; }
    return any;
  }
  function remove(id) {
    const p = list.get(id); if (!p) return;
    root.remove(p.rig); root.remove(p.s.blob);
    disposeStudent(p.s);
    p.rig.traverse((o) => { o.geometry?.dispose(); });
    list.delete(id);
    rebuildPickables();
  }
  function clear() { for (const id of [...list.keys()]) remove(id); }
  function wave(id) { const p = list.get(id); if (p) p.wave = 2.2; }
  /** A football move seen from another player: kick | volley | header | bicycle | slide | dash. */
  function move(id, kind) {
    const p = list.get(id);
    if (!p) return;
    if (kind === 'kick') p.kick = MOVE_T.kick;
    else if (kind === 'volley') { p.kick = MOVE_T.kick; p.volley = MOVE_T.kick; }
    else if (kind === 'header') p.head = MOVE_T.head;
    else if (kind === 'bicycle') p.bike = MOVE_T.bike;
    else if (kind === 'slide') p.slide = MOVE_T.slide;
    else if (kind === 'dash') p.dash = MOVE_T.dash;
  }

  /** Moves everyone a little towards their latest position. Returns true while something is still moving. */
  function update(dt) {
    let busy = false;
    const k = 1 - Math.exp(-dt * 9);
    const passengers = [];
    for (const p of list.values()) {
      if (!p.seen) continue;
      if (p.ride) {
        const d = p.ride === meId ? null : list.get(p.ride);
        if (p.ride === meId || (d && d.seen && (d.mode === 1 || d.mode === 2))) { passengers.push([p, d]); busy = true; continue; }
      }
      p.seated = false;
      const dx = p.tx - p.x, dz = p.tz - p.z, dy = p.ty - p.y, dh = wrap(p.th - p.h);
      const moving = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 0.01 || Math.abs(dh) > 0.01 || p.speed > 0.2 || p.wave > 0 || p.kick > 0 || p.slide > 0 || p.bike > 0 || p.head > 0 || p.dash > 0;
      if (moving) busy = true;
      p.x += dx * k; p.z += dz * k; p.y += dy * k; p.h += dh * k;
      const s = p.s, ease = Math.min(1, dt * 12);
      p.phase += dt * (3 + p.speed * 1.9);
      p.rig.position.set(p.x, p.y, p.z);
      for (const k of ['kick', 'volley', 'slide', 'bike', 'head', 'dash']) p[k] = Math.max(0, p[k] - dt);
      if (p.mode === 3) { // sitting on the stands
        for (const [limb, target] of [[s.legL, -1.35], [s.legR, -1.35], [s.armL, -0.35], [s.armR, -0.35]]) limb.rotation.x += (target - limb.rotation.x) * ease;
        s.group.position.set(0, -0.5, 0);
        s.group.rotation.x = 0;
        p.rig.rotation.set(0, p.h, 0);
        s.blob.scale.setScalar(0.8);
      } else if (p.mode === 1 || p.mode === 2) {
        const V = p.bikes[MODES[p.mode]];
        for (const [limb, target] of [[s.legL, V.legs], [s.legR, V.legs], [s.armL, V.arms], [s.armR, V.arms]]) limb.rotation.x += (target - limb.rotation.x) * ease;
        s.group.position.set(0, V.seatY, -0.3);
        s.group.rotation.x = 0.12;
        for (const w of V.wheels) w.rotation.x += (p.speed * dt) / V.wheelR;
        p.rig.rotation.set(0, p.h, 0);
        s.blob.scale.set(1.1, 1.9, 1);
      } else {
        const air = p.y > 0.05 && p.ty > 0.05 ? 0.6 : 0;
        const swing = Math.sin(p.phase) * Math.min(0.95, 0.25 + Math.min(1, p.speed / 7.2) * 1.1) * (p.speed > 0.2 ? 1 : 0);
        p.wave = Math.max(0, p.wave - dt);
        const waveArm = p.wave > 0 ? -2.6 + Math.sin(p.wave * 12) * 0.35 : null;
        const P = limbPose(p, swing, air);
        const snap = p.kick > 0 || p.bike > 0;
        s.legL.rotation.x += (P.legL - s.legL.rotation.x) * ease;
        s.legR.rotation.x = snap ? P.legR : s.legR.rotation.x + (P.legR - s.legR.rotation.x) * ease;
        s.armL.rotation.x += (P.armL - s.armL.rotation.x) * ease;
        s.armR.rotation.x += ((waveArm ?? P.armR) - s.armR.rotation.x) * ease;
        s.armR.rotation.z += ((p.wave > 0 ? 0.35 : 0) - s.armR.rotation.z) * ease;
        s.group.position.set(0, P.y ?? (p.speed > 0.2 ? Math.abs(Math.sin(p.phase)) * 0.045 : 0), P.z);
        s.group.rotation.x = p.bike > 0 ? P.lean : s.group.rotation.x + (P.lean - s.group.rotation.x) * Math.min(1, dt * 18);
        s.group.rotation.z += (P.roll - s.group.rotation.z) * Math.min(1, dt * 18);
        // positions arrive only a few times a second: show the hop of a bicycle kick / header here
        const hop = p.bike > 0 ? 1.1 * Math.sin(Math.PI * (1 - p.bike / MOVE_T.bike)) : p.head > 0 ? 0.35 * Math.sin(Math.PI * (1 - p.head / MOVE_T.head)) : 0;
        if (hop) p.rig.position.y = p.y + hop;
        p.rig.rotation.set(0, p.h, 0);
        s.blob.scale.setScalar(0.8);
      }
      s.blob.position.set(p.x, p.y > 0.1 ? p.y + 0.03 : 0.4, p.z);
      s.blob.rotation.z = p.h;
    }
    // passengers go where their driver is drawn now (yours: seatOnMe, after your own student moved)
    for (const [p, d] of passengers) if (d) seat(p, d.x, d.y, d.z, d.h, 0, d.mode);
    return busy;
  }

  /** Head positions for name tags and chat bubbles. */
  function heads() {
    const out = [];
    for (const p of list.values()) if (p.seen) out.push({ id: p.id, x: p.x, y: p.y + (p.seated ? 2.1 : p.mode === 3 ? 1.38 : p.mode === 1 || p.mode === 2 ? 2.05 : 1.85), z: p.z });
    return out;
  }
  function get(id) { const p = list.get(id); return p && p.seen ? { x: p.x, z: p.z, y: p.y, h: p.h, speed: p.speed, phase: p.phase, mode: p.mode, ride: p.ride } : null; }

  return { add, setLook, setKit, setPos, setRide, seatOnMe, setMe(id) { meId = id; }, remove, clear, wave, move, update, heads, get, ids: () => [...list.keys()], pickables, dispose() { clear(); scene.remove(root); } };
}
