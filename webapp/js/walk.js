// Walk mode for the 3D campus map: a small low-poly student you steer around the campus.
// Desktop: WASD / arrows to move, Shift to run, Space to jump, drag the mouse to turn the camera, wheel to zoom,
// E to open info about the building you are next to, O to lock the mouse (mouse-look), Esc to leave.
// Zooming all the way in switches to a first-person view.
// Phones: on-screen joystick (push far to run), jump button, drag anywhere else to turn the camera.
// 1 / 2 / 3: walk, scooter, motorbike. On a bike: W/S throttle and brake, A/D steer, Space = horn.
// Server mode: you can also ride pillion on someone else's bike (carry): you just sit there and look around.
// Collisions: the student is a 0.45 m circle pushed out of building footprints (2D, cheap and stable).
import * as THREE from 'three';
import { inside, bbox } from './map3d.js';

export const SCALE = 0.76;         // student is ~1.65 m tall
export const SOLE = 0.16 * SCALE;  // the model's shoe soles are this far above its origin: standing poses drop by it
let R = 0.34;                // collision radius (m); larger on a bike
const WALK = 3.6, RUN = 7.2; // m/s
const GRAVITY = 16, JUMP_V = 4.8;
const EYE = 1.1;

// Character looks (server mode lets each student pick one). Indexes into these lists are what gets saved
// (Supabase user_metadata.campus_look) and sent to other players; the world server checks the ranges.
export const LOOK = {
  skin: [0xf6d3b3, 0xf1c7a1, 0xd9a47a, 0xb07a52, 0x7d5536],
  hair: ['Ngắn', 'Dài', 'Búi', 'Mũ lưỡi trai', 'Mũ bảo hiểm'],
  hc: [0x2b2018, 0x5a3a22, 0x9b6a3c, 0xd8b26a, 0x8f2f3a, 0x3d4f8f],
  shirt: [0x2f6bff, 0xffffff, 0xe5484d, 0x12b76a, 0xf5a524, 0x7c4dff, 0x1b1f2a, 0xff7eb6],
  pants: [0x26324a, 0x1b1f2a, 0x5a6b8a, 0xc9b28a, 0x6b4a32, 0xe9e5dc],
  bag: [0xe5484d, 0x2f6bff, 0x12b76a, 0x1b1f2a, 0xf5a524, 0xff7eb6],
  glasses: ['Không', 'Có'],
};
export const DEFAULT_LOOK = { skin: 1, hair: 0, hc: 0, shirt: 0, pants: 0, bag: 0, glasses: 0 };
const pick = (list, i) => list[Math.max(0, Math.min(list.length - 1, i | 0))];

/**
 * Low-poly student made from primitives (original design). `kit` dresses them for football instead:
 * { shirt, pants (shorts), socks?, gloves? } colours, and no backpack.
 */
export function makeStudent(look = DEFAULT_LOOK, kit = null) {
  const L = { ...DEFAULT_LOOK, ...(look || {}) };
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const shirt = M(kit ? kit.shirt : pick(LOOK.shirt, L.shirt)), pants = M(kit ? kit.pants : pick(LOOK.pants, L.pants)), skin = M(pick(LOOK.skin, L.skin)), hair = M(pick(LOOK.hc, L.hc));
  const bagC = pick(LOOK.bag, L.bag), bag = M(bagC), shoe = M(0x1b1f2a), white = M(0xffffff);
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  add(new THREE.CapsuleGeometry(0.3, 0.42, 4, 10), shirt, 0, 1.28, 0);           // torso
  if (!kit) {
    add(new THREE.BoxGeometry(0.5, 0.56, 0.22), bag, 0, 1.32, -0.3);              // backpack
    add(new THREE.BoxGeometry(0.36, 0.12, 0.06), M(new THREE.Color(bagC).multiplyScalar(0.8)), 0, 1.12, -0.43); // bag pocket
  }
  const head = add(new THREE.SphereGeometry(0.27, 14, 10), skin, 0, 1.94, 0);
  const style = L.hair | 0;
  if (style === 4) { // helmet (mũ bảo hiểm)
    const hm = add(new THREE.SphereGeometry(0.31, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.95, -0.01);
    hm.scale.set(1, 0.95, 1.05);
    add(new THREE.BoxGeometry(0.5, 0.03, 0.12), hair, 0, 1.97, 0.27);
  } else {
    const cap = add(new THREE.SphereGeometry(0.285, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), style === 3 ? shirt : hair, 0, 1.97, -0.01);
    cap.scale.set(1, 0.9, 1);
    if (style === 1) add(new THREE.BoxGeometry(0.5, 0.42, 0.14), hair, 0, 1.78, -0.17);                 // long hair
    if (style === 2) add(new THREE.SphereGeometry(0.12, 10, 8), hair, 0, 2.2, -0.12);                    // bun
    if (style === 3) { const brim = add(new THREE.BoxGeometry(0.34, 0.03, 0.22), shirt, 0, 1.99, 0.28); brim.rotation.x = 0.12; } // cap
    if (style !== 3) add(new THREE.BoxGeometry(0.46, 0.08, 0.1), hair, 0, 2.1, 0.17);                    // fringe
  }
  add(new THREE.SphereGeometry(0.035, 6, 6), shoe, -0.09, 1.97, 0.245);           // eyes
  add(new THREE.SphereGeometry(0.035, 6, 6), shoe, 0.09, 1.97, 0.245);
  if (L.glasses) {
    const fr = M(0x1b1f2a);
    for (const x of [-0.09, 0.09]) { const r = add(new THREE.TorusGeometry(0.06, 0.012, 6, 14), fr, x, 1.97, 0.255); r.castShadow = false; }
    add(new THREE.BoxGeometry(0.06, 0.012, 0.012), fr, 0, 1.97, 0.26);
  }
  add(new THREE.BoxGeometry(0.06, 0.02, 0.02), white, 0, 1.86, 0.26);           // smile hint

  const limb = (x, y, len, rad, mat, footMat) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot);
    add(new THREE.CapsuleGeometry(rad, len, 3, 8), mat, 0, -len / 2 - rad, 0, pivot);
    if (footMat) add(new THREE.BoxGeometry(0.2, 0.1, 0.3), footMat, 0, -len - rad * 2 + 0.03, 0.05, pivot);
    return pivot;
  };
  const legMat = kit ? M(kit.socks ?? kit.shirt) : pants;
  const legL = limb(-0.15, 0.9, 0.5, 0.11, legMat, shoe), legR = limb(0.15, 0.9, 0.5, 0.11, legMat, shoe);
  if (kit) for (const leg of [legL, legR]) add(new THREE.CylinderGeometry(0.15, 0.14, 0.3, 10), pants, 0, -0.13, 0, leg); // shorts
  const armL = limb(-0.42, 1.58, 0.42, 0.085, shirt), armR = limb(0.42, 1.58, 0.42, 0.085, shirt);
  // hands (goalkeeper gloves when the kit has them)
  const hand = kit?.gloves ? M(kit.gloves) : skin;
  for (const a of [armL, armR]) add(new THREE.SphereGeometry(kit?.gloves ? 0.11 : 0.09, 8, 6), hand, 0, -0.62, 0, a);

  // soft blob shadow so the student stays visible even outside the shadow map
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.4;
  blob.renderOrder = 1;
  return { group: g, legL, legR, armL, armR, head, blob };
}

/** Frees the geometries and materials of a student made by makeStudent. */
export function disposeStudent(s) {
  for (const root of [s.group, s.blob]) root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
}


/** Low-poly scooter (xe tay ga) and motorbike (xe số), front along +z. Returns { group, wheels, fork }. */
export function vehicleKit() {
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

/** Riding pillion on a scooter (mode 1) / motorbike (2): body offset and limb angles, hands on the driver's waist. */
export function pillionPose(mode) {
  return { y: (mode === 2 ? 0.28 : 0.2) + 0.04, z: -0.76, legs: mode === 2 ? -1.25 : -1.05, arms: -0.85, lean: 0.06 };
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

// Football moves: how long each one lasts (s)
// fall: knocked over by a slide tackle: face down on the grass for 2 s, then getting up (FALL_T in all)
export const MOVE_T = { kick: 0.32, slide: 0.78, bike: 0.8, head: 0.35, dash: 0.35, fall: 2.9 };
const KICK_T = MOVE_T.kick, SLIDE_T = MOVE_T.slide, BIKE_T = MOVE_T.bike, HEAD_T = MOVE_T.head, DASH_T = MOVE_T.dash, FALL_T = MOVE_T.fall;
const SLIDE_V = 12.5; // slide tackle: starts at this speed (m/s) and slows to 0, about 4.9 m in all

/** Walk / run cycle speed (radians of the step cycle per second). Football running takes long strides. */
export function gaitRate(speed, football) {
  return football && speed > 3 ? (Math.PI * speed) / (1.35 + 0.08 * speed) : 3 + speed * 1.9;
}
/** How much of the running style to use (0 = walking, 1 = running) for someone on the pitch. */
export const runBlend = (speed, football) => (football ? Math.min(1, Math.max(0, (speed - 3.8) / 2.5)) : 0);
const HIP = 0.9 * SCALE; // a bicycle kick turns the body around the hips

/**
 * Limb angles of a student (yours or another player's) from their move timers t = { slide, sit, kick, volley,
 * bike, head, dash }: walking / running, sitting, kicking, volley (kick with the body tilted), header,
 * bicycle kick (body flips back, right leg snaps over the head), slide tackle, dribble burst.
 * Returns { legL, legR, armL, armR, lean (x), roll (z), y, z (body offset; y null = normal bob) }.
 */
export function limbPose(t, swing, air, run = 0, s = 0) {
  if (t.fall > 0) { // knocked over: falls forward onto the chest, lies face down 2 s, pushes up onto the knees, stands
    const e = FALL_T - t.fall, mix = (a, b, k) => a + (b - a) * k;
    if (e < 0.3) { const k = e / 0.3; return { legL: 0.3 * k, legR: 0.15 * k, armL: -2.4 * k, armR: -2.2 * k, lean: 1.5 * k * k, roll: 0, y: 0.2 * k, z: 0 }; }
    if (e < 2.0) return { legL: 0.3, legR: 0.12, armL: -2.75, armR: -2.55, lean: 1.5, roll: 0, y: 0.2, z: 0 };
    if (e < 2.45) { const k = (e - 2.0) / 0.45; // push up: hands under the shoulders, hips back onto the knees
      return { legL: mix(0.3, 1.25, k), legR: mix(0.12, 1.15, k), armL: mix(-2.75, -0.9, k), armR: mix(-2.55, -0.9, k), lean: mix(1.5, 0.75, k), roll: 0, y: mix(0.2, -0.5, k), z: 0 };
    }
    const k = (e - 2.45) / 0.45; // one foot forward, then up
    return { legL: mix(1.25, 0, k), legR: mix(1.15, -0.7 * (1 - k), Math.min(1, k * 2)), armL: mix(-0.9, 0, k), armR: mix(-0.9, 0, k), lean: mix(0.75, 0, k), roll: 0, y: mix(-0.5, 0, k), z: 0 };
  }
  if (t.bike > 0) {
    const k = 1 - t.bike / BIKE_T, lean = -2.7 * Math.sin(Math.PI * Math.min(1, k * 1.15));
    const strike = k > 0.32 && k < 0.62;
    return { legL: -0.7, legR: strike ? -2.4 : -0.9, armL: -1.4, armR: -1.4, lean, roll: 0, y: HIP * (1 - Math.cos(lean)), z: -HIP * Math.sin(lean) };
  }
  if (t.slide > 0) return { legL: -1.3, legR: -1.15, armL: -0.7, armR: -0.4, lean: -1.0, roll: 0, y: 0.05, z: 0 };
  if (t.sit) return { legL: -1.35, legR: -1.35, armL: -0.35, armR: -0.35, lean: 0, roll: 0, y: -0.5, z: 0 };
  const P = { legL: swing + air, legR: -swing - air * 0.3, armL: -swing * 0.85 - air, armR: swing * 0.85 - air, lean: 0, roll: 0, y: null, z: 0 };
  if (run > 0 && !air) { // running (football): long strides, knees up, arms pumping in front, leaning into it
    const A = 0.75 + 0.3 * run, mix = (a, b) => a + (b - a) * run;
    P.legL = mix(P.legL, A * s - 0.12); P.legR = mix(P.legR, -A * s - 0.12);
    P.armL = mix(P.armL, -0.95 * s - 0.35); P.armR = mix(P.armR, 0.95 * s - 0.35);
    P.lean = 0.12 + 0.14 * run;
  }
  if (t.dash > 0) { P.lean = 0.3; P.armL = -0.9; P.armR = 0.9; }
  if (t.head > 0) { // nod through the ball
    const k = 1 - t.head / HEAD_T;
    P.lean = 0.55 * Math.sin(Math.PI * k); P.armL = 0.5; P.armR = 0.5;
  }
  if (t.kick > 0) { // wind up, then swing the right leg through the ball
    const k = 1 - t.kick / KICK_T;
    P.legR = k < 0.3 ? 0.9 * (k / 0.3) : 0.9 - 2.7 * Math.min(1, (k - 0.3) / 0.45);
    P.armL = -0.9; P.armR = 0.5; P.lean = k < 0.3 ? 0.08 : -0.12;
    if (t.volley > 0) { P.roll = -0.6 * Math.sin(Math.PI * k); P.armL = -1.6; } // volley: body tilted to the side
  }
  return P;
}
// Rules a game mode can put on the walk (football): frozen, its own run / sprint speeds, a speed factor, a
// bounds function (x, z) -> [x, z], whether sprinting is allowed, walk only (no bikes), and a key handler
// that can take keys over (it returns true for keys it used).
const PLAY0 = { frozen: false, run: 0, sprint: 0, factor: 1, bounds: null, canSprint: true, walkOnly: false, onKey: null };

export function createWalker({ scene, camera, el, data, pickables, extraSolids = [], extraWalls = [], surfaces = [], indoor = [], posts = [], water = [], limits, onNear, onInteract, onExit, onView }) {
  let s = makeStudent();
  let curLook = null, curKit = null;
  let play = { ...PLAY0 };
  s.group.scale.setScalar(SCALE);
  const rig = new THREE.Group(); // position + heading; holds the student and the vehicles
  rig.rotation.order = 'YXZ';    // heading, then pitch (bikes on the bridge ramps), then lean
  rig.add(s.group);
  const kit = vehicleKit();
  for (const v of Object.values(kit)) { v.group.visible = false; rig.add(v.group); }
  rig.visible = s.blob.visible = false;
  scene.add(rig, s.blob);

  const solids = data.buildings.map((b, i) => ({ pts: b.pts, box: bbox([b.pts]), i, hollow: !!b.hollow }));
  for (const pts of extraSolids) solids.push({ pts, box: bbox([pts]), i: -1 }); // gate structures (no info card)
  // perimeter wall segments (thin, so only a distance check)
  const wallSegs = [];
  for (const w of data.walls || []) for (let i = 0; i < w.length - 1; i++) {
    const a = w[i], b = w[i + 1];
    wallSegs.push({ a, b, minX: Math.min(a[0], b[0]) - 1, maxX: Math.max(a[0], b[0]) + 1, minZ: Math.min(a[1], b[1]) - 1, maxZ: Math.max(a[1], b[1]) + 1, y0: -9, y1: 99 });
  }
  // interior walls / railings only block at their own height (railings upstairs don't stop you downstairs)
  for (const w of extraWalls) wallSegs.push({ a: w.a, b: w.b, y0: w.y0, y1: w.y1, minX: Math.min(w.a[0], w.b[0]) - 1, maxX: Math.max(w.a[0], w.b[0]) + 1, minZ: Math.min(w.a[1], w.b[1]) - 1, maxZ: Math.max(w.a[1], w.b[1]) + 1 });
  // round obstacles: tree trunks, lamp posts, parked motorbikes, roof posts (grid for speed)
  const PCELL = 6, postGrid = new Map();
  for (const p of posts) {
    const k = Math.floor(p[0] / PCELL) + ',' + Math.floor(p[1] / PCELL);
    if (!postGrid.has(k)) postGrid.set(k, []);
    postGrid.get(k).push(p);
  }
  function postsNear(x, z) {
    const out = [], gx = Math.floor(x / PCELL), gz = Math.floor(z / PCELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = postGrid.get((gx + i) + ',' + (gz + j)); if (l) out.push(...l); }
    return out;
  }
  // walkable surfaces above the ground: 2nd-floor slabs and stairs (ramps)
  const surf = surfaces.map((s) => ({ ...s, box: bbox([s.pts]) }));
  const STEP = 0.6, HEAD = 1.75;
  // deep water (ponds): you cannot walk or ride into it from the bank, only over a bridge / pier / kerb above it.
  // Someone standing in it (an old spot, a teleport) can still move, but only towards the bank.
  const ponds = water.map((pts) => ({ pts, box: bbox([pts]) }));
  /** How far into a pond (x, z) is (distance to its bank), 0 when on dry land. */
  function wetDepth(x, z) {
    for (const p of ponds) {
      if (x < p.box.minX || x > p.box.maxX || z < p.box.minZ || z > p.box.maxZ || !inside(p.pts, x, z)) continue;
      return nearestEdge(p.pts, x, z).d;
    }
    return 0;
  }
  /** Ground height at (x, z) for someone standing at height y, and whether the spot is blocked (a step too high). */
  function groundAt(x, z, y) {
    let g = 0, blocked = false, lift = 0;
    for (const s of surf) {
      if (x < s.box.minX || x > s.box.maxX || z < s.box.minZ || z > s.box.maxZ || !inside(s.pts, x, z)) continue;
      let h = s.y, up = 0;
      if (s.ramp) {
        const t = THREE.MathUtils.clamp(((x - s.ramp.o[0]) * s.ramp.u[0] + (z - s.ramp.o[1]) * s.ramp.u[1]) / s.ramp.len, 0, 1);
        h = s.ramp.y0 + (s.ramp.y1 - s.ramp.y0) * t;
        // a staircase moves you along its slope, but you stand on the tread: `up` = tread above the slope here
        const n = s.ramp.steps;
        if (n) up = s.ramp.y0 + ((s.ramp.y1 - s.ramp.y0) * Math.min(n, Math.floor(t * n) + 1)) / n - h;
      }
      if (h <= y + STEP) { if (h >= g) { g = h; lift = up; } }
      else if (h < y + HEAD) blocked = true; // would walk into the stairs / slab edge
    }
    if (!blocked && g < 0.05 && ponds.length) {
      const d = wetDepth(x, z), here = d > 0 && st.y < 0.05 ? wetDepth(st.x, st.z) : 0;
      if (d > 0 && !(here > 0 && d <= here + 1e-3)) blocked = true;
    }
    return { g, blocked, lift };
  }
  /** Step to (qx, qz). Against an edge you cannot cross (a slab or stair edge, the water) slide along it instead
   *  of stopping dead: keep whichever part of the move is free. */
  function moveTo(qx, qz) {
    const free = (x, z) => {
      if (groundAt(x, z, st.y).blocked) return false;
      // keep the body (not just its centre) off the water: look a little ahead
      const dx = x - st.x, dz = z - st.z, L = Math.hypot(dx, dz);
      if (!ponds.length || L < 1e-6 || (st.y < 0.05 && wetDepth(st.x, st.z) > 0)) return true;
      const ax = x + (dx / L) * 0.22, az = z + (dz / L) * 0.22;
      return !(groundAt(ax, az, st.y).g < 0.05 && wetDepth(ax, az) > 0);
    };
    if (free(qx, qz)) { st.x = qx; st.z = qz; return; }
    const xFirst = Math.abs(qx - st.x) > Math.abs(qz - st.z);
    for (const [x, z] of xFirst ? [[qx, st.z], [st.x, qz]] : [[st.x, qz], [qx, st.z]]) {
      if (free(x, z)) { st.x = x; st.z = z; return; }
    }
  }
  /** Underside of the lowest slab above the head at (x, z) for someone at height y (bridge deck), or Infinity. */
  function ceilingAt(x, z, y) {
    let c = Infinity;
    for (const s of surf) {
      if (s.under == null || x < s.box.minX || x > s.box.maxX || z < s.box.minZ || z > s.box.maxZ || !inside(s.pts, x, z)) continue;
      let h = s.y;
      if (s.ramp) {
        const t = THREE.MathUtils.clamp(((x - s.ramp.o[0]) * s.ramp.u[0] + (z - s.ramp.o[1]) * s.ramp.u[1]) / s.ramp.len, 0, 1);
        h = s.ramp.y0 + (s.ramp.y1 - s.ramp.y0) * t;
      }
      if (h - s.under > y + 1.5) c = Math.min(c, h - s.under);
    }
    return c;
  }
  const st = {
    on: false, x: 0, z: 0, y: 0, vy: 0, heading: 0, yaw: 0, pitch: 0.3, dist: 8, phase: 0, speed: 0,
    keys: new Set(), joy: { x: 0, y: 0 }, jumpReq: false, t: 0, nearIdx: -1, nearTimer: 0, fp: false,
    mode: 'walk', v: 0, steer: 0, tilt: 0, lift: 0, lastTurn: -9, carry: null, // carry: () => the bike you sit on ({ x, z, y, h, speed, mode }) or null
    sit: false, kick: 0, volley: 0, slide: 0, slideX: 0, slideZ: 0, bike: 0, head: 0, dash: 0, dashX: 0, dashZ: 0, sprinting: false,
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
        if (b.hollow) continue;
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
        if (!(st.y + 0.15 < s.y1 && st.y + 1.5 > s.y0)) continue; // not at this wall's height
        const { d, bx, bz } = nearestEdge([s.a, s.b], x, z);
        const r = R + 0.18;
        if (d < r) { const nx = (x - bx) / (d || 1), nz = (z - bz) / (d || 1); x = bx + nx * r; z = bz + nz * r; moved = true; }
      }
      if (st.y < 2.5) for (const [px, pz, pr] of postsNear(x, z)) {
        const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz), rr = R + pr;
        if (d < rr) { const k = rr / (d || 1); x = px + (dx || 0.01) * k; z = pz + dz * k; moved = true; }
      }
      if (!moved) break;
    }
    x = THREE.MathUtils.clamp(x, limits.minX, limits.maxX);
    z = THREE.MathUtils.clamp(z, limits.minZ, limits.maxZ);
    return [x, z];
  }
  const blocked = (x, z) => (wetDepth(x, z) > 0 && groundAt(x, z, 99).g < 0.05) || postsNear(x, z).some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < R + pr + 0.2) || solids.some((b) => !b.hollow && x > b.box.minX - R && x < b.box.maxX + R && z > b.box.minZ - R && z < b.box.maxZ + R
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
  // typing in a field, or a dialog is open over the map: keys are not for walking
  const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.body.classList.contains('no-scroll');
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
  function keydown(e) {
    if (!st.on || isTyping()) return;
    if (play.onKey && play.onKey(e.code, true, e)) { e.preventDefault(); return; }
    if (MOVE_KEYS.includes(e.code)) { st.keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Space') { st.jumpReq = true; e.preventDefault(); }
    if (e.code === 'Digit1' || e.code === 'Numpad1') setMode('walk');
    if (e.code === 'Digit2' || e.code === 'Numpad2') setMode('scooter');
    if (e.code === 'Digit3' || e.code === 'Numpad3') setMode('moto');
    if (e.code === 'KeyE') onInteract?.(st.nearIdx >= 0 ? data.buildings[st.nearIdx] : null);
    if (e.code === 'KeyO') { toggleLock(); e.preventDefault(); }
    if (e.code === 'KeyF' || e.code === 'KeyV') setFirstPerson(!st.fp);
    // Esc first releases a locked mouse (the browser does that); only a separate Esc leaves walk mode.
    if (e.code === 'Escape' && !locked() && performance.now() - unlockedAt > 400) onExit?.();
  }
  function keyup(e) { st.keys.delete(e.code); play.onKey?.(e.code, false, e); }
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
    if (!st.on || st.carry || m === st.mode || !(m === 'walk' || RIDE[m]) || (m !== 'walk' && play.walkOnly)) return;
    st.sit = false;
    st.mode = m;
    st.v = 0; st.speed = 0; st.steer = 0; st.tilt = 0; st.vy = 0; st.air = false;
    st.y = groundAt(st.x, st.z, st.y).g; // stay on the bridge deck / the stands when getting on or off a bike
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
  // On a phone a second finger landing on the view does not take the camera from the finger already turning it, and
  // when that finger lifts, a finger still down on the view takes over (no need to lift and press again).
  let drag = null;
  const downs = new Set(); // pointers pressed on the 3D view and not released yet
  el.addEventListener('pointerdown', (e) => { downs.add(e.pointerId); if (st.on && !locked() && (!drag || drag.id === e.pointerId || e.pointerType !== 'touch')) drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  const pointermove = (e) => {
    if (st.on && !drag && downs.has(e.pointerId) && !pinch?.on && !locked()) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (!st.on || !drag || drag.id !== e.pointerId || locked()) return;
    turn((e.clientX - drag.x) * 0.0062, (e.clientY - drag.y) * 0.0042);
    drag.x = e.clientX; drag.y = e.clientY;
  };
  window.addEventListener('pointermove', pointermove);
  const endDrag = (e) => { downs.delete(e.pointerId); if (drag && drag.id === e.pointerId) drag = null; };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  el.addEventListener('wheel', (e) => { if (!st.on) return; e.preventDefault(); zoomBy(1 + THREE.MathUtils.clamp(e.deltaY, -120, 120) * 0.0012); }, { passive: false });
  // two-finger pinch zoom on phones. Only the fingers on the 3D view itself count (targetTouches: never the joystick
  // or a button, and no finger left over from a lost touchend), never while the joystick is held, and only once both
  // fingers have moved: a resting finger next to one that turns the camera is not a pinch. Leaving first person
  // needs a clear pinch out, not a wobble.
  let pinch = null;
  const pair = (e) => (e.targetTouches.length === 2 ? [e.targetTouches[0], e.targetTouches[1]] : null);
  const gap = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  el.addEventListener('touchstart', (e) => {
    const p = pair(e);
    pinch = p && !st.joyHeld ? { d: gap(p), at: p.map((t) => [t.identifier, t.clientX, t.clientY]), on: false, out: 1 } : null;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const p = pair(e);
    if (!st.on || !pinch || !p || st.joyHeld) return;
    if (!pinch.on) {
      const moved = (t) => { const a = pinch.at.find((q) => q[0] === t.identifier); return a && Math.hypot(t.clientX - a[1], t.clientY - a[2]) > 14; };
      if (!p.every(moved)) return;
      pinch.on = true; drag = null; pinch.d = gap(p); // both fingers travelled: it is a pinch from here on
      return;
    }
    const d = gap(p);
    if (d <= 0) return;
    const f = pinch.d / d;
    pinch.d = d;
    if (st.fp) { pinch.out *= f; if (pinch.out > 1.3) { zoomBy(pinch.out); pinch.out = 1; } }
    else zoomBy(f);
  }, { passive: true });
  const touchEnd = (e) => { if (e.targetTouches.length < 2) pinch = null; };
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
  let camPitch = 0.3, camDist = 6.5;
  function cameraTarget(dt) {
    look.set(st.x, st.y + EYE, st.z);
    // inside a room (canteen, roof hidden): come closer and look down from above the walls
    const inRoom = indoor.some((p) => inside(p, st.x, st.z));
    const wantPitch = inRoom ? Math.max(st.pitch, 1.05) : st.pitch;
    const wantDist = inRoom ? THREE.MathUtils.clamp(st.dist, 6, 9) : st.dist;
    camPitch += (wantPitch - camPitch) * Math.min(1, dt * 6);
    camDist += (wantDist - camDist) * Math.min(1, dt * 6);
    const cp = Math.cos(camPitch);
    dir.set(Math.sin(st.yaw) * cp, Math.sin(camPitch), Math.cos(st.yaw) * cp).normalize();
    want.copy(look).addScaledVector(dir, camDist);
    if (want.y < 0.6) want.y = 0.6;
    // under the bridge: the camera stays below the deck (you look around the space under it, not through it)
    const ceil = Math.min(ceilingAt(st.x, st.z, st.y), ceilingAt(want.x, want.z, st.y));
    if (want.y > ceil - 0.45) want.y = Math.max(look.y - 0.3, ceil - 0.45);
    dir.copy(want).sub(look);
    ray.far = dir.length();
    ray.set(look, dir.normalize());
    const hits = ray.intersectObjects(pickables, false);
    setOccluders([...new Set(hits.map((h) => h.object))]);
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
    // sitting on the stands: any move (or jump) stands you up
    if (st.sit && (Math.abs(f) + Math.abs(r) > 0.15 || st.jumpReq)) { st.sit = false; st.jumpReq = false; }
    st.kick = Math.max(0, st.kick - dt); st.volley = Math.max(0, st.volley - dt);
    st.head = Math.max(0, st.head - dt); st.bike = Math.max(0, st.bike - dt);
    st.sprinting = false;
    const ride = st.carry ? st.carry() : null;
    if (ride) {
      // on someone's back seat: the driver steers, you only turn the camera
      st.x = ride.x; st.z = ride.z; st.y = ride.y; st.vy = 0; st.air = false; st.jumpReq = false;
      if (st.t - st.lastTurn > 1.2 && ride.speed > 0.6) st.yaw += wrap(ride.h + Math.PI - st.yaw) * Math.min(1, dt * 2.2);
      st.heading = ride.h; st.speed = ride.speed;
    } else if (st.bike > 0) {
      st.speed = 0; // bicycle kick: up in the air on the spot (gravity below brings you down)
    } else if (st.fall > 0) {
      st.fall = Math.max(0, st.fall - dt); st.speed = 0; st.jumpReq = false; // on the ground, then getting up
    } else if (st.dash > 0) {
      // dribble burst: a quick dash with the ball that fades out
      st.dash = Math.max(0, st.dash - dt);
      const v = 11 * (0.45 + 0.55 * st.dash / DASH_T);
      let [qx, qz] = resolve(st.x + st.dashX * v * dt, st.z + st.dashZ * v * dt);
      if (play.bounds) [qx, qz] = play.bounds(qx, qz);
      if (!groundAt(qx, qz, st.y).blocked) { st.x = qx; st.z = qz; }
      st.heading += wrap(Math.atan2(st.dashX, st.dashZ) - st.heading) * Math.min(1, dt * 14);
      st.speed = v;
    } else if (st.slide > 0) {
      // slide tackle: a quick burst forward that fades out
      st.slide = Math.max(0, st.slide - dt);
      const v = SLIDE_V * (st.slide / SLIDE_T);
      let [qx, qz] = resolve(st.x + st.slideX * v * dt, st.z + st.slideZ * v * dt);
      if (play.bounds) [qx, qz] = play.bounds(qx, qz);
      if (!groundAt(qx, qz, st.y).blocked) { st.x = qx; st.z = qz; }
      st.speed = v;
    } else if (!riding && !st.sit) {
      let mx = fx * f + rx * r, mz = fz * f + rz * r;
      let mag = Math.hypot(mx, mz);
      if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
      if (play.frozen) mag = 0;
      const running = (boost || Math.hypot(st.joy.x, st.joy.y) > 0.92) && play.canSprint;
      st.sprinting = running && mag > 0.05;
      const pace = play.run ? (running ? play.sprint : play.run) : (running ? RUN : WALK);
      const targetSpeed = mag > 0.05 ? pace * mag * play.factor : 0;
      st.speed += (targetSpeed - st.speed) * Math.min(1, dt * 10);
      if (mag > 0.05) {
        const h = Math.atan2(mx, mz);
        st.heading += wrap(h - st.heading) * Math.min(1, dt * 12);
        const nx = st.x + (mx / mag) * st.speed * dt, nz = st.z + (mz / mag) * st.speed * dt;
        let [qx, qz] = resolve(nx, nz);
        if (play.bounds) [qx, qz] = play.bounds(qx, qz);
        moveTo(qx, qz);
      }
    } else if (st.sit) {
      st.speed = 0;
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
      const [qx, qz] = resolve(st.x + sx * st.v * dt, st.z + sz * st.v * dt);
      moveTo(qx, qz);
      const moved = Math.hypot(st.x - ox, st.z - oz), want = Math.abs(st.v * dt);
      if (want > 0.02 && moved < want * 0.55) st.v *= 0.55; // bumped into something
      st.speed = Math.abs(st.v);
      // camera swings back behind the bike unless the player turned it recently
      if (st.t - st.lastTurn > 1.2 && st.speed > 0.6) st.yaw += wrap(st.heading + Math.PI - st.yaw) * Math.min(1, dt * 2.2);
      if (st.jumpReq) horn();
    }
    // floors / stairs under the feet, jump + gravity
    const { g, lift = 0 } = ride ? { g: ride.y } : st.sit ? { g: st.y } : groundAt(st.x, st.z, st.y); // a seat holds you up
    st.ground = g;
    if (st.y < g) { st.y = g; st.vy = 0; st.air = false; } // stepped up (stairs)
    if (st.jumpReq && !st.air && st.y <= g + 0.001 && !riding && !play.frozen) { st.vy = JUMP_V; st.air = true; }
    st.jumpReq = false;
    if (st.y > g + 0.001 || st.vy > 0) {
      // walking down stairs: stay on the steps. Only while walking, never in the middle of a jump or a fall,
      // otherwise the student would be pulled down to the ground before the jump finishes.
      if (!st.air && st.vy <= 0 && st.y - g < 0.35) { st.y = g; st.vy = 0; }
      else {
        st.air = true;
        st.vy -= GRAVITY * dt;
        st.y = Math.max(g, st.y + st.vy * dt);
        if (st.y <= g + 0.001) { st.y = g; st.vy = 0; st.air = false; st.land = 1; } // landed
      }
    } else if (st.air) { st.y = g; st.vy = 0; st.air = false; } // came down within a millimetre of the ground

    // on stairs the body stands on the tread (drawn a little above the slope it moves along)
    st.lift += ((st.y <= g + 0.001 ? lift : 0) - st.lift) * Math.min(1, dt * 25);
    const bodyY = st.y + st.lift;
    // animate limbs (or the riding pose)
    const moving = Math.min(1, st.speed / RUN);
    const football = !!play.run, run = runBlend(st.speed, football) * (st.sprinting ? 1 : 0.85);
    st.phase += dt * gaitRate(st.speed, football);
    const swing = Math.sin(st.phase) * Math.min(0.95, 0.25 + moving * 1.1) * (st.speed > 0.2 ? 1 : 0);
    const air = st.y > (st.ground || 0) + 0.05 ? 0.6 : 0;
    const ease = Math.min(1, dt * 14);
    if (ride) {
      const P = pillionPose(ride.mode);
      for (const [limb, a] of [[s.legL, P.legs], [s.legR, P.legs], [s.armL, P.arms], [s.armR, P.arms]]) limb.rotation.x += (a - limb.rotation.x) * ease;
      s.group.position.set(0, P.y, P.z);
      s.group.rotation.set(P.lean, 0, 0);
      rig.position.set(st.x, st.y, st.z);
      rig.rotation.set(ride.tilt || 0, st.heading, 0);
    } else if (riding) {
      const V = kit[st.mode];
      for (const [limb, target] of [[s.legL, V.legs], [s.legR, V.legs], [s.armL, V.arms], [s.armR, V.arms]]) limb.rotation.x += (target - limb.rotation.x) * ease;
      s.group.position.set(0, V.seatY, -0.3);
      s.group.rotation.x = 0.12;
      for (const w of V.wheels) w.rotation.x += (st.v * dt) / V.wheelR;
      V.fork.rotation.y = -st.steer * 0.38;
      // on a slope (the bridge ramps) the bike pitches so both wheels stay on the road
      const hx = Math.sin(st.heading) * 0.62, hz = Math.cos(st.heading) * 0.62;
      const rise = st.air ? 0 : groundAt(st.x + hx, st.z + hz, st.y).g - groundAt(st.x - hx, st.z - hz, st.y).g;
      st.tilt += ((Math.abs(rise) < 0.4 ? -Math.atan2(rise, 1.24) : 0) - st.tilt) * Math.min(1, dt * 10);
      rig.position.set(st.x, bodyY, st.z);
      rig.rotation.set(st.tilt, st.heading, st.steer * 0.2 * Math.min(1, st.speed / 6)); // lean into turns
      s.blob.scale.set(1.1, 1.9, 1);
    } else {
      const P = limbPose(st, swing, air, run, Math.sin(st.phase));
      const snap = st.kick > 0 || st.bike > 0; // fast moves are not smoothed
      s.legL.rotation.x += (P.legL - s.legL.rotation.x) * ease;
      s.legR.rotation.x = snap ? P.legR : s.legR.rotation.x + (P.legR - s.legR.rotation.x) * ease;
      s.armL.rotation.x += (P.armL - s.armL.rotation.x) * ease;
      s.armR.rotation.x += (P.armR - s.armR.rotation.x) * ease;
      const bob = st.speed > 0.2 && st.y === (st.ground || 0) && !st.slide ? Math.abs(Math.sin(st.phase)) * (0.045 + 0.05 * run) : Math.sin(st.t * 2) * 0.01;
      s.group.rotation.y = run * 0.14 * Math.sin(st.phase); // shoulders turn with the stride
      st.land = Math.max(0, (st.land || 0) - dt * 6);                       // small knee bend on landing
      s.group.position.set(0, (P.y ?? bob - Math.sin(st.land * Math.PI) * 0.07) - (st.sit ? 0 : SOLE), P.z); // soles on the ground
      s.group.rotation.x = st.bike > 0 ? P.lean : s.group.rotation.x + (P.lean - s.group.rotation.x) * Math.min(1, dt * 18);
      s.group.rotation.z += (P.roll - s.group.rotation.z) * Math.min(1, dt * 18);
      rig.position.set(st.x, bodyY, st.z);
      rig.rotation.set(0, st.heading, 0);
      s.blob.scale.setScalar(0.8 * (1 - Math.min(0.5, st.y * 0.25)));
    }
    s.blob.position.set(st.x, (st.ground || 0) + st.lift + 0.03, st.z);
    s.blob.rotation.z = st.heading;

    const near = st.fp ? 0.12 : 1;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    rig.visible = s.blob.visible = !st.fp;
    if (ride) s.blob.visible = false; // the bike's shadow is the driver's
    if (st.fp) {
      // first person: camera sits in the head and looks where the mouse points
      setOccluders([]);
      camPitch += (st.pitch - camPitch) * Math.min(1, dt * 25);
      const cp = Math.cos(camPitch);
      dir.set(Math.sin(st.yaw) * cp, Math.sin(camPitch), Math.cos(st.yaw) * cp).normalize();
      const head = ride ? pillionPose(ride.mode).y + 1.25 : riding ? kit[st.mode].seatY + 1.25 : 1.5 - SOLE;
      look.set(st.x, bodyY + head + (!riding && st.speed > 0.2 && st.y === (st.ground || 0) ? Math.sin(st.phase * 2) * 0.03 : 0), st.z);
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
    st.carry = null; st.sit = false; st.kick = 0; st.slide = 0; st.bike = 0; st.head = 0; st.dash = 0; st.volley = 0; st.fall = 0;
    [st.x, st.z] = freeSpot(x, z);
    st.y = 0; st.vy = 0; st.air = false; st.speed = 0; st.t = 0; st.nearIdx = -1; st.nearTimer = 0;
    st.heading = facing ?? 0;
    st.yaw = st.heading + Math.PI; // camera behind the student
    st.pitch = 0.32; st.dist = 6.5; camPitch = 0.32; st.fp = false;
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    st.mode = 'walk'; st.v = 0; st.steer = 0; st.tilt = 0; R = 0.34;
    for (const v of Object.values(kit)) v.group.visible = false;
    rig.visible = s.blob.visible = true;
    st.on = true;
    emitView();
  }
  function exit() {
    if (locked()) document.exitPointerLock();
    st.on = false;
    st.carry = null;
    st.fp = false;
    if (camera.near !== 1) { camera.near = 1; camera.updateProjectionMatrix(); }
    st.keys.clear(); st.joy.x = st.joy.y = 0;
    rig.visible = s.blob.visible = false;
    setOccluders([]);
    onNear?.(null);
    st.nearIdx = -1;
  }
  /** Appear at (x, z), on the surface at about height y there (0 = the ground; e.g. next to someone on the bridge). */
  function teleport(x, z, lookAt, y = 0) {
    st.sit = false; st.slide = 0;
    [st.x, st.z] = freeSpot(x, z);
    st.y = groundAt(st.x, st.z, y).g; st.vy = 0; st.air = false; st.v = 0; st.t = 0.6; // short glide
    if (lookAt) {
      st.heading = Math.atan2(lookAt[0] - st.x, lookAt[1] - st.z);
      st.yaw = st.heading + Math.PI; // camera behind, looking at the building
      if (!st.fp) st.pitch = Math.max(st.pitch, 0.25);
    }
  }

  /** Sit on a seat of the stands ({ x, z, y, heading }), facing the pitch. */
  function sitAt(seat) {
    if (st.mode !== 'walk') setMode('walk');
    st.x = seat.x; st.z = seat.z; st.y = seat.y; st.vy = 0; st.air = false; st.speed = 0; st.slide = 0;
    st.heading = seat.heading;
    st.yaw = seat.heading + Math.PI;
    if (!st.fp) { st.pitch = Math.max(st.pitch, 0.5); st.dist = Math.min(Math.max(st.dist, 4), 5.5); } // look over the rows behind
    st.sit = true;
  }

  /** Swap the student's look (server mode character customizer), keeping the football kit if one is on. */
  function setLook(look, kit = curKit) {
    curLook = look; curKit = kit;
    const next = makeStudent(look, kit);
    next.group.scale.setScalar(SCALE);
    next.blob.visible = s.blob.visible;
    next.blob.position.copy(s.blob.position);
    next.blob.scale.copy(s.blob.scale);
    rig.remove(s.group); scene.remove(s.blob);
    disposeStudent(s);
    s = next;
    rig.add(s.group); scene.add(s.blob);

  }

  return {
    state: st,
    enter, exit, update, teleport, freeSpot, setLook,
    setKit(kit) { if (kit !== curKit) setLook(curLook, kit); },
    /** football rules on the walk (see PLAY0); null = normal walk */
    setPlay(p) { play = { ...PLAY0, ...(p || {}) }; if (play.walkOnly && st.mode !== 'walk') setMode('walk'); },
    kick() { st.kick = KICK_T; },
    volley() { st.kick = KICK_T; st.volley = KICK_T; },
    header() { st.head = HEAD_T; },
    /** knocked over (slide tackle): lie on the ground, then get up; no moving meanwhile */
    fall() { st.fall = FALL_T; st.slide = 0; st.dash = 0; st.kick = 0; st.head = 0; st.speed = 0; st.sit = false; },
    lunge(dx, dz) { if (st.mode !== 'walk' || st.slide > 0 || st.sit || st.bike > 0 || st.fall > 0) return; st.slide = SLIDE_T; st.slideX = dx; st.slideZ = dz; st.heading = Math.atan2(dx, dz); },
    /** dribble burst in a direction */
    dash(dx, dz) { if (st.mode !== 'walk' || st.sit || st.bike > 0 || st.slide > 0 || st.fall > 0) return false; st.dash = DASH_T; st.dashX = dx; st.dashZ = dz; return true; },
    /** bicycle kick: jump and flip back, facing heading h (your back to where the ball goes) */
    bicycle(h) {
      if (st.mode !== 'walk' || st.air || st.sit || st.bike > 0 || st.slide > 0 || st.fall > 0 || play.frozen) return false;
      st.heading = h; st.vy = 6.4; st.air = true; st.bike = BIKE_T; st.jumpReq = false; st.dash = 0;
      return true;
    },
    /** in the air (jumping) */
    airborne: () => st.air && st.y > (st.ground || 0) + 0.02,
    face(h) { st.heading = h; },
    sitAt, standUp() { st.sit = false; },
    /** Ride pillion: get = () => the bike to sit on ({ x, z, y, h, speed, mode }) or null; carry(null) gets off beside it. */
    carry(get) {
      if (get) {
        if (st.mode !== 'walk') setMode('walk');
        st.sit = false; st.slide = 0; st.dash = 0; st.bike = 0; st.v = 0;
        st.carry = get;
        if (!st.fp) st.dist = 7.5;
        return;
      }
      if (!st.carry) return;
      st.carry = null;
      s.group.position.set(0, 0, 0); s.group.rotation.set(0, 0, 0);
      [st.x, st.z] = freeSpot(st.x + Math.cos(st.heading) * 0.95, st.z - Math.sin(st.heading) * 0.95); // step off to the side
      st.y = Math.max(0, st.y - 0.2); st.vy = 0; st.speed = 0;
      if (!st.fp) st.dist = 6.5;
    },
    /** camera distance / pitch (e.g. a wider view of the pitch in a match) */
    setView({ dist, pitch }) { if (st.fp) return; if (dist) st.dist = dist; if (pitch) st.pitch = pitch; },
    /** held: a finger is on the joystick (no pinch zoom meanwhile, even with the knob in the middle) */
    setJoy(x, y, held = x !== 0 || y !== 0) { st.joy.x = x; st.joy.y = y; st.joyHeld = held; },
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
