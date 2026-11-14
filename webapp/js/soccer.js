// Football on the stadium pitch, browser side (server mode of the 3D campus map).
// Draws the ball and the two goalkeepers, predicts the ball between server updates with the same physics as the
// world server (soccer-core.js), dresses players in their team kit, and turns keys / buttons into touches,
// shots, passes and slide tackles. The world server is the referee: it decides who has the ball, goals and score.
//   Desktop: run into the ball to take it · right mouse (hold for power) shoot · left mouse tap: push the ball ahead,
//            hold: lofted pass · a kick button held before the ball comes fires on the touch with the power so far
//            Space jump; in the air right mouse volley, left mouse header · hold a mouse button + Space = bicycle kick
//            E slide tackle · Q dribble burst · Shift sprint
//   Phones: buttons Sút / Chuyền / Nhảy / Xoạc / Lừa, push the joystick all the way to sprint
import * as THREE from 'three';
import {
  F, HL, HW, GOAL_W, BALL_R, KEEPER_U, STEP, STEP_MS, MATCH_MS, TEAM_SIZE, TEAM_NAMES, MAX_KICK,
  toLocal, toWorld, dirLocal, dirWorld, ballAtFeet, newSim, cloneSim, step, keeperHolds,
} from './soccer-core.js';
import { makeStudent, disposeStudent, SCALE, SOLE } from './walk.js';

export { TEAM_NAMES, TEAM_SIZE, MATCH_MS };
export const KITS = [
  { shirt: 0x2563eb, pants: 0xf8fafc, socks: 0x2563eb }, // Xanh
  { shirt: 0xf97316, pants: 0x1f2937, socks: 0xf97316 }, // Cam
];
export const TEAM_CSS = ['#2563eb', '#f97316'];
const KEEPER_KITS = [
  { shirt: 0x16a34a, pants: 0x14532d, socks: 0x16a34a, gloves: 0xfacc15 },
  { shirt: 0xfacc15, pants: 0x3f3f46, socks: 0xfacc15, gloves: 0x16a34a },
];
const TURF = 0;               // the pitch lies flat on the ground (y = 0)
const BALL_LOOK = 1.45;       // the ball is drawn bigger than its physics size so it reads on a phone
const RUN = 6.6, SPRINT = 9.2; // m/s in a match
const CHARGE_MS = 900;        // holding the shoot button this long = full power
const PLAYING = ['warm', 'count', 'play', 'wait'];
const IN_MATCH = ['kick', 'play', 'goal', 'wait'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Classic black-and-white ball: an icosphere with dark patches around the 12 icosahedron corners. */
function makeBall() {
  const geo = new THREE.IcosahedronGeometry(BALL_R * BALL_LOOK, 3);
  const pos = geo.getAttribute('position');
  const t = (1 + Math.sqrt(5)) / 2;
  const corners = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((c) => new THREE.Vector3(...c).normalize());
  const colors = new Float32Array(pos.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const m = a.add(b).add(c).normalize();
    const v = corners.some((q) => q.dot(m) > 0.945) ? 0.07 : 0.97;
    for (let j = 0; j < 3; j++) colors.set([v, v, v], (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * BALL_LOOK * 1.3, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;
  return { mesh, blob };
}

function makeKeeper(i, root) {
  const s = makeStudent({ skin: i ? 3 : 1, hair: i ? 0 : 2, hc: i ? 0 : 1, shirt: 0, pants: 0, bag: 0, glasses: 0 }, KEEPER_KITS[i]);
  s.group.scale.setScalar(SCALE);
  const rig = new THREE.Group();
  rig.add(s.group);
  root.add(rig, s.blob);
  const [dx, dz] = dirWorld(i ? -1 : 1, 0); // faces the pitch
  const heading = Math.atan2(dx, dz);
  // which way the keeper's own x axis points along v (to roll the right way when diving)
  const side = Math.sign(Math.cos(heading) * F.vx - Math.sin(heading) * F.vz) || 1;
  return { s, rig, heading, side, roll: 0, lastV: 0, phase: 0 };
}

/**
 * What the pitch shows on top of the players: the dotted path of the pass you are about to play (and where a
 * lofted one lands), a ring in the team colour under the player with the ball (a slide tackle has to go through
 * its middle) and, for spectators, a ball with an arrow over that player's head.
 */
function makeMarkers(root) {
  const flat = (geo) => geo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.95, 1.1, 48)), ringMat);
  const core = new THREE.Mesh(flat(new THREE.CircleGeometry(0.62, 32)), coreMat);
  ring.add(core);
  ring.renderOrder = core.renderOrder = 2;
  ring.visible = false;
  // ball + arrow pointing down: same size on screen at any distance
  const c = document.createElement('canvas');
  c.width = 128; c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.strokeStyle = '#111827'; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 62, 52, 0, Math.PI * 2); g.fill(); g.stroke();
  const pent = (cx, cy, r, rot) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = rot + (i * 2 * Math.PI) / 5; g[i ? 'lineTo' : 'moveTo'](cx + r * Math.sin(a), cy - r * Math.cos(a)); } g.closePath(); g.fill(); };
  g.fillStyle = '#111827';
  pent(64, 62, 18, 0);
  for (let i = 0; i < 5; i++) { const a = (i * 2 * Math.PI) / 5; pent(64 + 44 * Math.sin(a), 62 - 44 * Math.cos(a), 12, a + Math.PI); }
  g.save(); g.beginPath(); g.arc(64, 62, 49, 0, Math.PI * 2); g.restore();
  g.fillStyle = '#facc15'; g.strokeStyle = '#111827'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, 124); g.lineTo(88, 124); g.lineTo(64, 166); g.closePath(); g.fill(); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const pointer = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
  pointer.scale.set(0.045, 0.062, 1);
  pointer.renderOrder = 10;
  pointer.visible = false;
  // pass preview: dots every metre along the path, a ring where a lofted pass comes down
  const MAXD = 64;
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), dotMat, MAXD);
  dots.count = 0; dots.frustumCulled = false; dots.renderOrder = 3;
  const landMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const land = new THREE.Mesh(flat(new THREE.RingGeometry(0.42, 0.62, 32)), landMat);
  land.renderOrder = 3; land.visible = false;
  root.add(ring, pointer, dots, land);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
  let t = 0;
  return {
    show(p, team, spectator, dt) {
      t += dt;
      ring.visible = !!p && team >= 0;
      pointer.visible = ring.visible && spectator;
      if (!ring.visible) return;
      const col = KITS[team].shirt;
      ringMat.color.setHex(col); coreMat.color.setHex(col);
      ring.position.set(p.x, (p.y || 0) + 0.04, p.z);
      pointer.position.set(p.x, (p.y || 0) + 2.45 + Math.sin(t * 4) * 0.08, p.z);
    },
    path(r, lofted) {
      if (!r) { dots.count = 0; land.visible = false; return; }
      const n = Math.min(MAXD, r.pts.length);
      dotMat.color.setHex(lofted === 'l' ? 0xfde047 : lofted === 's' ? 0xff5a4f : 0xffffff);
      dotMat.opacity = lofted === 'p' ? 0.6 : 0.95;
      for (let i = 0; i < n; i++) {
        const [u, v, y] = r.pts[i], [x, z] = toWorld(u, v), s = 1 - (i / n) * 0.45;
        m4.compose(at.set(x, TURF + y, z), q, sc.set(s, s, s));
        dots.setMatrixAt(i, m4);
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
      land.visible = !!r.land;
      if (r.land) { const [x, z] = toWorld(r.land[0], r.land[1]); land.position.set(x, TURF + 0.04, z); }
    },
  };
}

// ---------- little sound effects (Web Audio, no files) ----------
let actx = null, noiseBuf = null;
function audio() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return actx;
  } catch { return null; }
}
function noise(a, t, dur, type, freq, gain, attack = 0.005) {
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(a, t, freq, dur, gain, trill = 0) {
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.value = freq;
  if (trill) { // whistle pea: fast wobble
    const l = a.createOscillator(), lg = a.createGain();
    l.frequency.value = 28; lg.gain.value = trill;
    l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.setValueAtTime(gain, t + dur - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function sfx(kind, k = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  if (kind === 'kick') { noise(a, t, 0.09, 'lowpass', 500, 0.25 + 0.3 * k); tone(a, t, 95, 0.09, 0.12 + 0.12 * k); }
  else if (kind === 'catch') noise(a, t, 0.12, 'lowpass', 900, 0.25);
  else if (kind === 'post') { tone(a, t, 880, 0.35, 0.08); tone(a, t, 1320, 0.25, 0.05); }
  else if (kind === 'slide') noise(a, t, 0.3, 'bandpass', 1800, 0.08, 0.04);
  else if (kind === 'whistle') { tone(a, t, 2850, 0.16, 0.05, 140); tone(a, t + 0.22, 2850, 0.42, 0.05, 140); }
  else if (kind === 'final') { tone(a, t, 2850, 0.3, 0.05, 140); tone(a, t + 0.4, 2850, 0.3, 0.05, 140); tone(a, t + 0.8, 2850, 0.8, 0.05, 140); }
  else if (kind === 'goal') { noise(a, t, 2.6, 'bandpass', 900, 0.22, 0.35); noise(a, t + 0.1, 2.2, 'bandpass', 1500, 0.1, 0.3); }
  else if (kind === 'cheer') noise(a, t, 1.2, 'bandpass', 1000, 0.08, 0.2);
  else if (kind === 'deny') { tone(a, t, 220, 0.07, 0.06); tone(a, t + 0.09, 165, 0.1, 0.06); } // not ready yet
}

/**
 * Football client. map = the 3D campus API (scene, walker, players…), send(msg) to the world server,
 * serverNow() = server clock estimate (ms), myId() = your player id, onChange() = something on screen changed.
 */
export function createSoccer({ map, send, serverNow, myId, onChange }) {
  const { scene, walker, players } = map;
  const root = new THREE.Group();
  root.name = 'soccer';
  scene.add(root);
  const ball = makeBall();
  root.add(ball.mesh, ball.blob);
  const keepers = [makeKeeper(0, root), makeKeeper(1, root)];
  const marks = makeMarkers(root);

  let ms = { st: 'idle', teams: [[], []], score: [0, 0], goals: [], until: 0, endsAt: 0, rem: MATCH_MS, ko: 0, n: 0 };
  let sim = newSim(1), simAt = 0, have = false;
  let myTeam = -1, wantTeam = null;
  let stamina = 1, tired = false;
  let pending = 0, touchWait = 0, tackleWait = 0, kickedAt = -1e9;
  const off = { u: 0, v: 0, y: 0 };      // fades out the jump when a server update corrects the ball
  let shown = [0, 0, BALL_R];            // ball position drawn last frame (pitch coordinates)
  let banner = null, notice = null, lastN = null, uiAt = 0, flash = null, lastFb = 0, lastRejoin = 0;
  const ev = [];
  const q = new THREE.Quaternion(), axis = new THREE.Vector3();

  const teamOf = (id) => (ms.teams[0].includes(id) ? 0 : ms.teams[1].includes(id) ? 1 : -1);
  const canPlay = () => PLAYING.includes(ms.st);
  const me = () => myId();
  const mine = () => toLocal(walker.state.x, walker.state.z);
  const holding = () => have && (sim.b.h === me() || (pending > 0 && sim.b.h == null));
  function nearPitch(r) {
    const s = map.self();
    if (!s) return false;
    const dx = s[0] - F.cx, dz = s[1] - F.cz;
    return dx * dx + dz * dz < r * r;
  }
  function changed(now) {
    const t = performance.now();
    if (now || t - uiAt > 120) { uiAt = t; onChange?.(); }
  }

  // ---------- server messages ----------
  function handle(m) {
    if (m.t === 'fs') onState(m);
    else if (m.t === 'fb') onBall(m);
    else if (m.t === 'fe') onEvent(m);
    else if (m.t === 'fpos') map.teleport(m.x, m.z, [m.lx, m.lz]);
  }

  function onState(m) {
    const prev = ms;
    ms = m;
    const t = teamOf(me());
    if (t !== myTeam) {
      myTeam = t;
      hold.shoot = hold.pass = null; air = null; bike = null;
      map.setPicking(t < 0); // in a team, clicks on the pitch are for passing, not for opening cards
      if (t >= 0) walker.setView({ dist: 10, pitch: 0.42 });
    }
    applyKits();
    // a match just kicked off: tell students elsewhere on the campus (they can come and watch)
    if (lastN !== null && m.n !== lastN && m.st === 'kick' && myTeam < 0 && !nearPitch(130)) notice = { kind: 'start', at: performance.now() };
    if (lastN === null && IN_MATCH.includes(m.st) && myTeam < 0 && !nearPitch(130)) notice = { kind: 'live', at: performance.now() };
    lastN = m.n;
    if (m.st === 'end' && prev.st !== 'end') banner = { kind: 'final', score: m.score, until: performance.now() + 8000 };
    if (m.st === 'idle' || m.st === 'warm') notice = null;
    changed(true);
  }

  function onBall(m) {
    // sent before the server got our kick: it still has the ball at our feet; the next update has the kick
    if (m.s?.b?.h === me() && performance.now() - kickedAt < 600) return;
    const before = have ? shown : null;
    sim = m.s; simAt = m.at; have = true; lastFb = performance.now();
    advance(serverNow());
    if (sim.b.h != null) pending = 0; // the server gave it to us, or to someone else
    const after = freeBall();
    if (before && after) {
      const du = before[0] - after[0], dv = before[1] - after[1], dy = before[2] - after[2];
      if (du * du + dv * dv + dy * dy < 16) { off.u = du; off.v = dv; off.y = dy; } else off.u = off.v = off.y = 0;
    }
  }

  function onEvent(m) {
    const near = nearPitch(160) || myTeam >= 0, mine_ = m.id === me();
    switch (m.e) {
      case 'kick': case 'pass':
        if (!mine_) {
          players.move(m.id, { v: 'volley', h: 'header', b: 'bicycle' }[m.k] || 'kick');
          if (near) sfx('kick', m.e === 'pass' || m.k === 'p' ? 0.5 : m.k === 'h' ? 0.6 : 0.9);
        }
        break;
      case 'slide': if (!mine_) { players.move(m.id, 'slide'); if (near) sfx('slide'); } break;
      case 'dribble': if (!mine_) players.move(m.id, 'dash'); break;
      case 'dodged':
        if (m.id === me()) flash = { text: 'Lừa qua người!', until: performance.now() + 1300 };
        else if (m.by === me()) flash = { text: 'Bị lừa qua rồi!', until: performance.now() + 1300 };
        changed(true);
        break;
      case 'steal': // slide tackle right through the ball: the player who had it goes down for 3 s
        if (near) sfx('kick', 0.3);
        if (m.from === me()) { walker.fall(); hold.shoot = hold.pass = null; air = null; flash = { text: 'Bị xoạc ngã, mất bóng!', until: performance.now() + 1800 }; changed(true); }
        else players.move(m.from, 'fall');
        if (m.id === me()) { flash = { text: 'Xoạc trúng, cướp được bóng!', until: performance.now() + 1500 }; changed(true); }
        break;
      case 'catch': case 'parry': if (near) sfx('catch'); break;
      case 'punt': if (near) sfx('kick', 1); break;
      case 'post': if (near) sfx('post'); break;
      case 'whistle': if (near) sfx('whistle'); break;
      case 'final': if (near) sfx('final'); break;
      case 'goal':
        if (m.practice) banner = { kind: 'practice', team: m.team, name: m.name, until: performance.now() + 2200 };
        else { banner = { kind: 'goal', team: m.team, name: m.name, own: m.own, how: m.how, score: m.score, near, until: performance.now() + 4300 }; if (near) sfx('goal'); }
        if (near && m.practice) sfx('cheer');
        changed(true);
        break;
      default:
    }
  }

  // ---------- prediction ----------
  function advance(now) {
    if (!have) return;
    if (now - simAt > 3000) simAt = now - 3000; // far behind (tab was in the background): catch up 3 s at most
    while (simAt + STEP_MS <= now) { step(sim, STEP, ev); simAt += STEP_MS; }
    ev.length = 0;
  }
  /** The free ball (or one a goalkeeper holds) as the simulation has it, pitch coordinates. */
  function freeBall() {
    const b = sim.b;
    if (b.h != null && !keeperHolds(sim)) return null;
    return [b.u, b.v, b.y];
  }

  // ---------- your actions ----------
  // Kick buttons held right now: shoot (right mouse / Sút) and pass (left mouse / Chuyền), each { t, aim, moved }.
  // aim 'cam' = where the camera looks (mouse players), 'head' = where you face (phone buttons).
  const hold = { shoot: null, pass: null };
  let air = null;     // volley (v) / header (h) waiting in the air for the ball: { kind, aim }
  let bike = null;    // bicycle kick in progress: { dir, t0, done }
  let dribbleWait = 0;
  const HIGH_MS = 250; // holding pass longer than this = lofted pass
  const AIR_MS = 2000; // a volley / header pressed in the air waits this long for the ball
  const PRE_MS = 2000; // a kick button held before you have the ball fires on the touch within this time
  const HIT = 0.65;    // a slide tackle wins the ball when your feet pass this close to the middle of the ring
  const RECOVER_MS = 2000; // after a slide tackle or a dribble burst, 2 s before the next one
  let slideHit = null; // slide tackle in progress: { until, sent }

  function grabNear(r = 1.7) {
    const b = sim.b;
    if (!have || b.h != null || performance.now() < touchWait || b.y > 1.4) return false;
    const [mu, mv] = mine(), du = b.u - mu, dv = b.v - mv;
    if (du * du + dv * dv > r * r) return false;
    send({ t: 'ft', p: [walker.state.x, walker.state.z] });
    pending = performance.now();
    return true;
  }
  /** Kick direction in pitch coordinates: where the camera looks, or where you face. */
  function aimDir(aim) {
    const w = walker.state;
    const [u, v] = aim === 'cam' ? dirLocal(-Math.sin(w.yaw), -Math.cos(w.yaw)) : dirLocal(Math.sin(w.heading), Math.cos(w.heading));
    const L = Math.hypot(u, v) || 1;
    return [u / L, v / L];
  }
  /** A shot from (bu, bv) that would just miss the goal is bent inside the post. */
  function onTarget([fu, fv], bu, bv) {
    const goalU = myTeam === 0 ? HL : -HL;
    if ((goalU - bu) * fu > 0 && Math.abs(goalU - bu) < 40) {
      const cv = bv + fv * ((goalU - bu) / fu);
      if (Math.abs(cv) < GOAL_W + 4) {
        const tv = clamp(cv, -(GOAL_W - 0.45), GOAL_W - 0.45), du = goalU - bu, dv = tv - bv, L = Math.hypot(du, dv);
        return [du / L, dv / L];
      }
    }
    return [fu, fv];
  }
  const feet = () => {
    const w = walker.state, [mu, mv] = mine();
    const [fu, fv] = dirLocal(Math.sin(w.heading), Math.cos(w.heading));
    return ballAtFeet(mu, mv, fu, fv);
  };
  function predict(u, v, y, vel) { // show the kick right away (the server sends the same thing back)
    kickedAt = performance.now();
    Object.assign(sim.b, { u, v, y, vu: vel[0], vv: vel[1], vy: vel[2], h: null });
    simAt = serverNow();
    pending = 0; touchWait = performance.now() + 350;
    off.u = off.v = off.y = 0;
  }
  /** Kick the ball at your feet: shot s, low pass p, lofted pass l, bicycle kick b (flicked up to height y). */
  function kick([du, dv], sp, lift, kind, y = BALL_R) {
    const [bu, bv] = feet(), vel = [du * sp, dv * sp, lift];
    send({ t: 'fk', k: kind, p: [bu, bv, y], d: vel });
    predict(bu, bv, y, vel);
    if (kind !== 'b') { const [wx, wz] = dirWorld(du, dv); walker.face(Math.atan2(wx, wz)); walker.kick(); }
    sfx('kick', sp / 32);
  }
  /** Strike a free ball in the air: volley v, header h, bicycle kick b. */
  function strike(kind, [du, dv], sp, lift) {
    const b = sim.b, vel = [du * sp, dv * sp, lift];
    send({ t: 'fa', k: kind, p: [b.u, b.v, b.y], d: vel });
    predict(b.u, b.v, b.y, vel);
    if (kind !== 'b') { const [wx, wz] = dirWorld(du, dv); walker.face(Math.atan2(wx, wz)); }
    if (kind === 'v') walker.volley(); else if (kind === 'h') walker.header();
    flash = { text: { v: 'Vô lê!', h: 'Đánh đầu!', b: 'Xe đạp chổng ngược!' }[kind], until: performance.now() + 1300 };
    sfx('kick', kind === 'h' ? 0.6 : 1);
    changed(true);
  }
  /** Can a volley / header / bicycle kick reach the free ball now? (height measured from your feet) */
  function inReach(kind) {
    const b = sim.b, w = walker.state;
    if (!have || b.h != null) return false;
    const [mu, mv] = mine(), d = Math.hypot(b.u - mu, b.v - mv), y = b.y - w.y;
    // volley / header: any touch of the ball, on the grass (rolling or still) or in the air, up to head height
    if (kind === 'v') return d < 1.45 && y > -0.4 && y < 1.6;
    if (kind === 'h') return d < 1.2 && y > -0.4 && y < 2.35;
    return d < 1.9 && y > 0.25 && y < 2.8;
  }
  function fireAir(kind, aim) {
    const b = sim.b, dir = onTarget(aimDir(aim), b.u, b.v);
    if (kind === 'v') strike('v', dir, 27, 1.2);
    else strike('h', dir, 16, b.y > 1.7 ? -1.5 : 0.8); // a header from high up goes down into the grass
  }
  // What each kick does: { dir, sp (m/s along the grass), lift (m/s up), k }. The preview draws the same thing.
  // Tap (quick press of pass): a short push ahead along the grass, just far enough to run onto it again. Standing it
  // rolls about 4.6 m; running it stays a couple of metres in front of you (dribbling by touches).
  const lowPlan = (aim) => ({ dir: aimDir(aim), sp: 3.5 + walker.state.speed * 0.9, lift: 0, k: 'p' });
  // Lofted pass: the power decides how far. Weakest about 14 m (2.5 m high), full power about 50 m, i.e. from
  // your own goal line it comes down at the halfway line (about 8.5 m high at the top, 2.6 s in the air).
  const highPlan = (aim, p) => ({ dir: aimDir(aim), sp: 11.3 + p * 16.2, lift: 7.2 + p * 7.5, k: 'l' });
  const shotPlan = (aim, p) => { const [bu, bv] = feet(); return { dir: onTarget(aimDir(aim), bu, bv), sp: 14 + p * 18, lift: 0.6 + p * p * 5.2, k: 's' }; };
  function shoot(p, aim) {
    if (!holding() && !grabNear()) return;
    const P = shotPlan(aim, p);
    kick(P.dir, P.sp, P.lift, 's');
  }
  function lowPass(aim) {
    if (!holding() && !grabNear()) return;
    const P = lowPlan(aim);
    kick(P.dir, P.sp, P.lift, 'p');
  }
  function highPass(aim, p) {
    if (!holding() && !grabNear()) return;
    const P = highPlan(aim, p);
    kick(P.dir, P.sp, P.lift, 'l');
  }
  /** Path of the ball for a planned pass from your feet (pitch coordinates), and where a lofted one comes down. */
  const pathEv = [];
  function passPath(P) {
    const S = cloneSim(sim), [bu, bv] = feet();
    Object.assign(S.b, { u: bu, v: bv, y: BALL_R, vu: P.dir[0] * P.sp, vv: P.dir[1] * P.sp, vy: P.lift, h: null });
    const pts = [[bu, bv, BALL_R]];
    let last = pts[0], land = null;
    for (let t = 0; t < 4; t += STEP) {
      step(S, STEP, pathEv);
      const stop = pathEv.some((e) => e.e !== 'bounce') || S.b.h != null;
      pathEv.length = 0;
      const b = S.b, here = [b.u, b.v, b.y];
      if (Math.hypot(here[0] - last[0], here[1] - last[1], here[2] - last[2]) >= 1) { pts.push(here); last = here; }
      if (stop) break;
      if (P.k === 'l' && t > 0.15 && b.y <= BALL_R + 0.001) { land = here; pts.push(here); break; } // lofted: where it lands
      if (b.y <= BALL_R + 0.001 && b.vu * b.vu + b.vv * b.vv < 2.5) break;                         // rolled to a stop
      if (P.k !== 'l' && t > 1.8) break;
    }
    return { pts, land };
  }
  /** Bicycle kick: the ball goes where you aim (camera), or behind you (phones); you flip with your back to it. */
  function startBicycle(aim) {
    let dir = aimDir(aim);
    if (aim === 'head') dir = [-dir[0], -dir[1]];
    const [wx, wz] = dirWorld(-dir[0], -dir[1]);
    if (!walker.bicycle(Math.atan2(wx, wz))) return false;
    bike = { dir, t0: performance.now(), done: false };
    hold.shoot = hold.pass = null; air = null;
    sfx('slide');
    changed(true);
    return true;
  }
  function press(kind, aim) {
    if (myTeam < 0 || !canPlay()) return;
    if (walker.state.fall > 0) return;
    if (walker.airborne() && !holding() && !bike) {
      // in the air: volley (shoot) / header (pass). Pressed in the air, it stays ready for 2 s, landing included:
      // whenever the ball comes in reach in that time, you strike it.
      const k = kind === 'shoot' ? 'v' : 'h';
      if (inReach(k)) fireAir(k, aim); else { air = { kind: k, aim, until: performance.now() + AIR_MS }; changed(true); }
      return;
    }
    hold[kind] = { t: performance.now(), aim, moved: false, pre: !holding() }; // pre: pressed before having the ball
    changed(true);
  }
  function release(kind) {
    const h = hold[kind];
    hold[kind] = null;
    if (!h) return;
    changed(true);
    if (myTeam < 0 || !canPlay() || !have) return;
    const held = performance.now() - h.t;
    if (kind === 'shoot') shoot(Math.min(1, held / CHARGE_MS), h.aim);
    else if (!h.moved) { if (held < HIGH_MS) lowPass(h.aim); else highPass(h.aim, Math.min(1, (held - HIGH_MS) / CHARGE_MS)); }
  }
  /** Space / Nhảy with a kick button held = bicycle kick (returns true); otherwise false (a normal jump). */
  function jumpKick(aim) {
    return myTeam >= 0 && canPlay() && !!(hold.shoot || hold.pass) && startBicycle(aim);
  }
  function tackle() {
    if (myTeam < 0 || !canPlay() || holding() || walker.state.sit || walker.state.fall > 0) return;
    if (performance.now() < tackleWait) { sfx('deny'); return; } // still getting up from the last one
    tackleWait = performance.now() + RECOVER_MS;
    const w = walker.state;
    let hx = Math.sin(w.heading), hz = Math.cos(w.heading);
    const h = have ? sim.b.h : null;
    if (h && !keeperHolds(sim) && teamOf(h) === 1 - myTeam) { // aim at the opponent with the ball
      const p = players.get(h);
      if (p) { const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz); if (d > 0.05 && d < 5) { hx = dx / d; hz = dz / d; } }
    }
    walker.lunge(hx, hz);
    send({ t: 'fx', p: [w.x + hx * 1.2, w.z + hz * 1.2], d: [hx, hz] }); // the slide (everyone sees it)
    slideHit = { until: performance.now() + 950, sent: false };
    sfx('slide');
  }
  /** Dribble burst (Q / Lừa): a quick dash; with the ball, tackles miss you for a moment. */
  function dribble() {
    if (myTeam < 0 || !canPlay() || walker.state.fall > 0) return;
    if (performance.now() < dribbleWait) { sfx('deny'); return; }
    const w = walker.state;
    if (!walker.dash(Math.sin(w.heading), Math.cos(w.heading))) return;
    dribbleWait = performance.now() + RECOVER_MS;
    stamina = Math.max(0, stamina - 0.12);
    if (holding()) send({ t: 'fd' });
    sfx('slide');
  }
  function onKey(code, down, e) {
    if (myTeam < 0) return false;
    if (code === 'Space') return down && !e.repeat ? jumpKick('cam') : false; // else the normal jump
    if (code === 'KeyE') { if (down && !e.repeat) tackle(); return true; }
    if (code === 'KeyQ') { if (down && !e.repeat) dribble(); return true; }
    return /^(Digit|Numpad)[123]$/.test(code); // no bikes on the pitch
  }
  // Mouse: right button = shoot (hold for power), left button = pass (tap low, hold lofted). A left drag that
  // moves the mouse turns the camera instead. Phones use the on-screen buttons (touches also fire mouse events).
  const touchFirst = matchMedia('(pointer: coarse)').matches;
  let lastTouch = 0, downAt = null;
  const onView = (e) => !!document.pointerLockElement || !!e.target?.closest?.('.map-canvas');
  const mouseOk = (e) => !touchFirst && performance.now() - lastTouch > 1000 && myTeam >= 0;
  const tstart = () => { lastTouch = performance.now(); };
  const mdown = (e) => {
    if (!mouseOk(e) || !onView(e)) return;
    if (e.button === 2) press('shoot', 'cam');
    else if (e.button === 0) { downAt = [e.clientX, e.clientY]; press('pass', 'cam'); }
  };
  const mmove = (e) => {
    if (hold.pass && downAt && !document.pointerLockElement && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) hold.pass.moved = true;
  };
  const mup = (e) => { if (e.button === 2) release('shoot'); else if (e.button === 0) { release('pass'); downAt = null; } };
  const ctxmenu = (e) => { if (myTeam >= 0 && onView(e)) e.preventDefault(); };
  window.addEventListener('touchstart', tstart, { passive: true });
  window.addEventListener('mousedown', mdown);
  window.addEventListener('mousemove', mmove);
  window.addEventListener('mouseup', mup);
  window.addEventListener('contextmenu', ctxmenu);

  // stay on the pitch during a match
  const bounds = (x, z) => {
    const [u, v] = toLocal(x, z), cu = clamp(u, -HL - 3, HL + 3), cv = clamp(v, -HW - 3, HW + 3);
    return cu === u && cv === v ? [x, z] : toWorld(cu, cv);
  };
  function applyRules() {
    if (myTeam < 0) { walker.setPlay(null); return; }
    walker.setPlay({ run: RUN, sprint: SPRINT, factor: holding() ? 0.88 : 1, frozen: ms.st === 'kick', bounds: IN_MATCH.includes(ms.st) ? bounds : null,
      canSprint: !tired, walkOnly: true, onKey });
  }
  function applyKits() {
    for (const id of players.ids()) { const t = teamOf(id); players.setKit(id, t >= 0 ? KITS[t] : null); }
    const t = teamOf(me());
    map.setKit(t >= 0 ? KITS[t] : null);
  }

  // ---------- every frame ----------
  function update(dt) {
    const w = walker.state;
    advance(serverNow());
    // run into the free ball to take it
    if (myTeam >= 0 && have && w.on && canPlay() && sim.b.h == null && !pending && performance.now() > touchWait && !w.slide && !w.fall && !air && !bike && !w.bike) {
      const [mu, mv] = mine(), du = sim.b.u - mu, dv = sim.b.v - mv;
      if (du * du + dv * dv < 1.0 && sim.b.y < 1.4) { send({ t: 'ft', p: [w.x, w.z] }); pending = performance.now(); touchWait = pending + 300; }
    }
    // sliding into a free ball (or a ball flying into your feet): you take it
    if (myTeam >= 0 && have && w.slide > 0 && canPlay() && sim.b.h == null && !pending && performance.now() > touchWait) {
      const fx = w.x + w.slideX * 0.55, fz = w.z + w.slideZ * 0.55, [fu, fv] = toLocal(fx, fz);
      if (Math.hypot(sim.b.u - fu, sim.b.v - fv) < 1.0 && sim.b.y < 0.7) { send({ t: 'ft', p: [fx, fz] }); pending = performance.now(); touchWait = pending + 300; }
    }
    // slide tackle: it only wins the ball if your feet go through the middle of the ring of the player who has it
    if (slideHit && !slideHit.sent) {
      const h = have ? sim.b.h : null, p = h && h !== me() && !keeperHolds(sim) && teamOf(h) === 1 - myTeam ? players.get(h) : null;
      if (performance.now() > slideHit.until || !w.slide) slideHit = null;
      else if (p) {
        const fx = w.x + w.slideX * 0.55, fz = w.z + w.slideZ * 0.55;
        if (Math.hypot(p.x - fx, p.z - fz) < HIT) { send({ t: 'fxh', p: [fx, fz], d: [w.slideX, w.slideZ] }); slideHit.sent = true; }
      }
    }
    if (pending && performance.now() - pending > 450) pending = 0; // no answer: someone else got there first
    // kick button held before the ball came: the touch kicks it straight away with the power charged until now
    for (const k of ['shoot', 'pass']) {
      const h = hold[k];
      if (!h || !h.pre) continue;
      if (performance.now() - h.t > PRE_MS) h.pre = false;
      else if (holding() && canPlay() && !w.fall) release(k);
    }
    // bicycle kick: hit the ball when it comes in reach during the flip (or flick up the one you were dribbling)
    if (bike && !bike.done) {
      const bt = performance.now() - bike.t0;
      if (bt > 650 || !canPlay()) bike = null;
      else if (bt > 160) {
        if (sim.b.h === me() && bt > 220) { bike.done = true; kick(onTarget(bike.dir, ...feet()), 23, 2.2, 'b', 1.3); flash = { text: 'Xe đạp chổng ngược!', until: performance.now() + 1300 }; }
        else if (inReach('b')) { bike.done = true; strike('b', onTarget(bike.dir, sim.b.u, sim.b.v), 25, 2); }
      }
    } else if (bike && performance.now() - bike.t0 > 900) bike = null;
    // volley / header waiting in the air
    if (air) {
      if (performance.now() > air.until || !canPlay() || w.fall > 0) { air = null; changed(true); }
      else if (inReach(air.kind)) { const a = air; air = null; fireAir(a.kind, a.aim); }
    }
    // the server sends the ball at least once a second during a match; if that stops (the server restarted),
    // join the team again so the match picks up where it can
    const t = performance.now();
    if (myTeam >= 0 && t - lastFb > 5000 && t - lastRejoin > 5000) { lastRejoin = t; send({ t: 'fjoin', team: myTeam }); }
    if (myTeam >= 0) {
      stamina = w.sprinting ? Math.max(0, stamina - dt * 0.2) : Math.min(1, stamina + dt * (w.speed > 0.5 ? 0.1 : 0.18));
      if (stamina <= 0.02) tired = true; else if (tired && stamina > 0.3) tired = false;
    } else stamina = 1;
    applyRules();

    // the ball: at a dribbler's feet, in a goalkeeper's hands, or where the simulation has it
    const decay = Math.exp(-dt * 9);
    off.u *= decay; off.v *= decay; off.y *= decay;
    let holder = null;
    if (pending && sim.b.h == null) holder = me();
    else if (sim.b.h != null && !keeperHolds(sim)) holder = sim.b.h;
    let pos = null;
    if (holder) {
      const p = holder === me() ? { x: w.x, z: w.z, h: w.heading, speed: w.speed, phase: w.phase } : players.get(holder);
      if (p) {
        const [pu, pv] = toLocal(p.x, p.z), [fu, fv] = dirLocal(Math.sin(p.h), Math.cos(p.h));
        const wob = p.speed > 0.5 ? 0.1 * Math.sin((p.phase || 0) * 0.5) : 0; // little touches while dribbling
        pos = [...ballAtFeet(pu + fu * wob, pv + fv * wob, fu, fv), BALL_R];
      }
    }
    if (!pos) pos = [sim.b.u + off.u, sim.b.v + off.v, sim.b.y + off.y];
    const [x, z] = toWorld(pos[0], pos[1]), [px, pz] = toWorld(shown[0], shown[1]);
    const mx = x - px, mz = z - pz, moved = Math.hypot(mx, mz);
    if (moved > 1e-4 && moved < 3) { // roll
      axis.set(mz, 0, -mx).normalize();
      q.setFromAxisAngle(axis, moved / (BALL_R * BALL_LOOK));
      ball.mesh.quaternion.premultiply(q);
    }
    shown = pos;
    // ring under the player with the ball (everyone), ball pointer over their head (spectators only)
    const hp = holder ? (holder === me() ? { x: w.x, z: w.z, y: w.y } : players.get(holder)) : null;
    marks.show(hp, holder ? teamOf(holder) : -1, myTeam < 0, dt);
    // preview while you have the ball: the low pass (white) until you press something; holding pass shows the
    // lofted pass (yellow) and holding shoot the shot (red), both growing with the power you hold
    let plan = null;
    if (myTeam >= 0 && holder === me() && !bike && canPlay() && performance.now() > kickedAt + 500) {
      const now = performance.now(), aim = (hold.shoot || hold.pass)?.aim || (touchFirst ? 'head' : 'cam');
      const passHeld = hold.pass && !hold.pass.moved ? now - hold.pass.t : 0;
      if (hold.shoot) plan = shotPlan(aim, Math.min(1, (now - hold.shoot.t) / CHARGE_MS));
      else plan = passHeld > HIGH_MS ? highPlan(aim, Math.min(1, (passHeld - HIGH_MS) / CHARGE_MS)) : lowPlan(aim);
    }
    marks.path(plan ? passPath(plan) : null, plan?.k);
    ball.mesh.position.set(x, TURF + pos[2] + BALL_R * (BALL_LOOK - 1), z);
    ball.blob.position.set(x, TURF + 0.02, z);
    ball.blob.scale.setScalar(Math.max(0.4, 1 - pos[2] * 0.25));

    // goalkeepers
    for (let i = 0; i < 2; i++) {
      const K = keepers[i], k = sim.k[i], s = K.s;
      const [kx, kz] = toWorld(KEEPER_U[i], k.v);
      const lateral = Math.abs(k.v - K.lastV) / Math.max(dt, 1e-3);
      K.lastV = k.v;
      const dive = k.dive > 0 ? Math.min(1, (0.6 - k.dive) / 0.2) : 0;
      const hold = sim.b.h === 'k' + i;
      K.roll += ((dive ? -k.dd * K.side * 1.15 * dive : 0) - K.roll) * Math.min(1, dt * 14);
      K.rig.position.set(kx, -0.25 * Math.abs(K.roll) / 1.15, kz);
      K.rig.rotation.set(0, K.heading, K.roll);
      K.phase += dt * (3 + lateral * 2);
      const sw = Math.sin(K.phase) * Math.min(0.5, lateral * 0.12);
      const e = Math.min(1, dt * 12);
      const armT = hold ? -1.5 : dive ? -2.9 : -0.55, legT = dive ? 0 : 0.18;
      s.armL.rotation.x += (armT - s.armL.rotation.x) * e; s.armR.rotation.x += (armT - s.armR.rotation.x) * e;
      s.armL.rotation.z += ((hold ? 0.25 : -0.35) - s.armL.rotation.z) * e; s.armR.rotation.z += ((hold ? -0.25 : 0.35) - s.armR.rotation.z) * e;
      s.legL.rotation.x += (-legT + sw - s.legL.rotation.x) * e; s.legR.rotation.x += (-legT - sw - s.legR.rotation.x) * e;
      s.group.position.y = (dive ? 0 : -0.04) - SOLE; // soles on the turf; ready stance: knees a little bent
      s.blob.position.set(kx, 0.03, kz);
      s.blob.scale.setScalar(0.8);
    }

    if (banner && performance.now() > banner.until) { banner = null; changed(true); }
    if (notice && (performance.now() - notice.at > 25000 || nearPitch(120))) { notice = null; changed(true); } // came over, or not interested
    if (flash && performance.now() > flash.until) { flash = null; changed(true); }
    if (myTeam >= 0 || IN_MATCH.includes(ms.st) || ms.st === 'count') changed();
    return have && (sim.b.h != null || sim.b.vu !== 0 || sim.b.vv !== 0 || sim.b.vy !== 0 || Math.abs(off.u) + Math.abs(off.v) > 0.01 || sim.k.some((k) => k.dive > 0));
  }
  const unhook = map.addFrameHook(update);

  function clock() {
    if (ms.st === 'play') return Math.max(0, ms.endsAt - serverNow());
    if (ms.st === 'end') return 0;
    if (IN_MATCH.includes(ms.st)) return ms.rem;
    return MATCH_MS;
  }

  return {
    handle,
    /** everything the football UI shows */
    view() {
      return {
        st: ms.st, teams: ms.teams, score: ms.score, goals: ms.goals, n: ms.n, ko: ms.ko,
        clock: clock(), left: ms.until ? Math.max(0, ms.until - serverNow()) : 0,
        myTeam, holding: holding(), stamina, tired, banner, notice, flash, near: nearPitch(130), wantTeam,
        power: hold.shoot ? Math.min(1, (performance.now() - hold.shoot.t) / CHARGE_MS) : null,
        lob: hold.pass && !hold.pass.moved && performance.now() - hold.pass.t > HIGH_MS ? Math.min(1, (performance.now() - hold.pass.t - HIGH_MS) / CHARGE_MS) : null,
        armed: air ? air.kind : null, fallen: walker.state.fall > 0,
      };
    },
    join(team) { wantTeam = team; send({ t: 'fjoin', team }); notice = null; changed(true); },
    leave() { wantTeam = null; send({ t: 'fleave' }); changed(true); },
    watch() { notice = null; map.watchMatch(); changed(true); },
    dismiss() { notice = null; changed(true); },
    /** on-screen buttons: press / release 'shoot' | 'pass', jump (bicycle kick when a kick button is held), tackle, dribble */
    press: (kind) => press(kind, 'head'), release, tackle, dribble,
    jump() { if (!jumpKick('head')) walker.jump(); },
    /** after (re)connecting: back into the team you were in */
    onWelcome() { if (wantTeam != null) send({ t: 'fjoin', team: wantTeam }); },
    syncKits: applyKits,
    dispose() {
      unhook();
      window.removeEventListener('mousedown', mdown);
      window.removeEventListener('mousemove', mmove);
      window.removeEventListener('mouseup', mup);
      window.removeEventListener('contextmenu', ctxmenu);
      window.removeEventListener('touchstart', tstart);
      map.setPicking(true);
      walker.setPlay(null);
      map.setKit(null);
      for (const id of players.ids()) players.setKit(id, null);
      scene.remove(root);
      root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      for (const K of keepers) disposeStudent(K.s);
    },
  };
}
