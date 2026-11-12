// Other students in server mode: one low-poly avatar per player, moved smoothly towards the last position the
// server sent (positions arrive a few times per second), with the same walking / riding animation as your own.
import * as THREE from 'three';
import { makeStudent, disposeStudent, vehicleKit, SCALE } from './walk.js';

export const MODES = ['walk', 'scooter', 'moto'];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createPlayers(scene) {
  const root = new THREE.Group();
  root.name = 'players';
  scene.add(root);
  const list = new Map(); // id -> player
  const pickables = [];

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

  function build(p, look) {
    if (p.s) { p.rig.remove(p.s.group); root.remove(p.s.blob); disposeStudent(p.s); }
    p.s = makeStudent(look);
    p.s.group.scale.setScalar(SCALE);
    p.rig.add(p.s.group);
    root.add(p.s.blob);
    tagMeshes(p);
  }

  function add(id, look, pos) {
    if (list.has(id)) { setLook(id, look); if (pos) setPos(id, pos, true); return; }
    const p = { id, rig: new THREE.Group(), s: null, kit: null, x: 0, z: 0, y: 0, h: 0, mode: 0, speed: 0, phase: Math.random() * 6,
      tx: 0, tz: 0, ty: 0, th: 0, seen: false, wave: 0, meshes: [] };
    root.add(p.rig);
    list.set(id, p);
    build(p, look);
    p.rig.visible = p.s.blob.visible = false;
    if (pos) setPos(id, pos, true);
  }
  function setLook(id, look) { const p = list.get(id); if (p) build(p, look); }
  function setPos(id, pos, snap = false) {
    const p = list.get(id); if (!p || !Array.isArray(pos)) return;
    [p.tx, p.tz, p.ty, p.th] = pos;
    const mode = Math.max(0, Math.min(2, pos[4] | 0));
    p.speed = pos[5] || 0;
    if (mode !== p.mode) setMode(p, mode);
    if (snap || !p.seen || Math.hypot(p.tx - p.x, p.tz - p.z) > 25) { p.x = p.tx; p.z = p.tz; p.y = p.ty; p.h = p.th; }
    p.seen = true;
    p.rig.visible = p.s.blob.visible = true;
  }
  function setMode(p, mode) {
    p.mode = mode;
    if (mode && !p.kit) {
      p.kit = vehicleKit();
      for (const v of Object.values(p.kit)) { v.group.visible = false; p.rig.add(v.group); }
      tagMeshes(p);
    }
    if (p.kit) for (const [k, v] of Object.entries(p.kit)) v.group.visible = k === MODES[mode];
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

  /** Moves everyone a little towards their latest position. Returns true while something is still moving. */
  function update(dt) {
    let busy = false;
    const k = 1 - Math.exp(-dt * 9);
    for (const p of list.values()) {
      if (!p.seen) continue;
      const dx = p.tx - p.x, dz = p.tz - p.z, dy = p.ty - p.y, dh = wrap(p.th - p.h);
      const moving = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 0.01 || Math.abs(dh) > 0.01 || p.speed > 0.2 || p.wave > 0;
      if (moving) busy = true;
      p.x += dx * k; p.z += dz * k; p.y += dy * k; p.h += dh * k;
      const s = p.s, ease = Math.min(1, dt * 12);
      p.phase += dt * (3 + p.speed * 1.9);
      p.rig.position.set(p.x, p.y, p.z);
      if (p.mode) {
        const V = p.kit[MODES[p.mode]];
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
        s.legL.rotation.x += (swing + air - s.legL.rotation.x) * ease;
        s.legR.rotation.x += (-swing - air * 0.3 - s.legR.rotation.x) * ease;
        s.armL.rotation.x += (-swing * 0.85 - air - s.armL.rotation.x) * ease;
        s.armR.rotation.x += ((waveArm ?? swing * 0.85 - air) - s.armR.rotation.x) * ease;
        s.armR.rotation.z += ((p.wave > 0 ? 0.35 : 0) - s.armR.rotation.z) * ease;
        s.group.position.set(0, p.speed > 0.2 ? Math.abs(Math.sin(p.phase)) * 0.045 : 0, 0);
        s.group.rotation.x = 0;
        p.rig.rotation.set(0, p.h, 0);
        s.blob.scale.setScalar(0.8);
      }
      s.blob.position.set(p.x, p.y > 0.1 ? p.y + 0.03 : 0.4, p.z);
      s.blob.rotation.z = p.h;
    }
    return busy;
  }

  /** Head positions for name tags and chat bubbles. */
  function heads() {
    const out = [];
    for (const p of list.values()) if (p.seen) out.push({ id: p.id, x: p.x, y: p.y + (p.mode ? 2.05 : 1.85), z: p.z });
    return out;
  }
  function get(id) { const p = list.get(id); return p && p.seen ? { x: p.x, z: p.z, y: p.y, h: p.h } : null; }

  return { add, setLook, setPos, remove, clear, wave, update, heads, get, pickables, dispose() { clear(); scene.remove(root); } };
}
