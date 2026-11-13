// Football on the big pitch of the 3D campus map (server mode).
// This file is shared: the browser (js/soccer.js) and the world server (world-server/src/soccer.js) run exactly
// the same ball and goalkeeper physics, so a browser can predict the ball smoothly between server updates.
// Pitch coordinates: u along the pitch, v across it, y up, in metres, origin at the centre spot.
// Team 0 (Xanh) defends the goal at u = -HL and attacks towards +u; team 1 (Cam) the other way round.
// The physics only uses + - * / and sqrt (no trig), so every JavaScript engine computes the same numbers.

// The pitch rectangle from OpenStreetMap (the big "pitch" area in data/campus.json; stadium.js draws it).
export const PITCH_PTS = [[155.1, -165.1], [131.6, -225.9], [226.8, -263.1], [250.2, -202.3]];

/** Centre, unit axes (u along the long side, v across) and size of a pitch rectangle. */
export function pitchFrame(pts) {
  let iL = 0, best = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    if (L > best) { best = L; iL = i; }
  }
  const a = pts[iL], b = pts[(iL + 1) % pts.length];
  const ux = (b[0] - a[0]) / best, uz = (b[1] - a[1]) / best, vx = -uz, vz = ux;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  let PW = 0;
  for (const p of pts) PW = Math.max(PW, Math.abs((p[0] - cx) * vx + (p[1] - cz) * vz) * 2);
  // the white lines sit 1.2 m inside the OSM outline
  return { cx, cz, ux, uz, vx, vz, PL: best, PW, HL: best / 2 - 1.2, HW: PW / 2 - 1.2 };
}

export const F = pitchFrame(PITCH_PTS);
export const HL = F.HL, HW = F.HW;              // half length / half width of the playing area (to the lines)
export const GOAL_W = 7.32 / 2, GOAL_H = 2.44, GOAL_D = 1.9;
export const BALL_R = 0.14;
export const KEEPER_U = [-HL + 0.75, HL - 0.75]; // goalkeepers stand just in front of their goal line
export const TEAM_SIZE = 5;
export const MATCH_MS = 5 * 60 * 1000;
export const TEAM_NAMES = ['Xanh', 'Cam'];
export const STEP = 1 / 60;                     // fixed physics step (s)
export const STEP_MS = 1000 / 60;
export const MAX_KICK = 32, MAX_LIFT = 16;      // fastest shot (m/s) and the most upward speed (a full lofted pass)
// Real ball (size 5: 0.43 kg, 22 cm): gravity 9.81 m/s², air drag K·v² (K = ρ·Cd·A / 2m ≈ 1.2·0.25·0.038 / 0.86
// ≈ 0.012 per metre: a 30 m/s shot loses about 11 m/s² to the air, a slow pass almost nothing), rolling on
// mown grass slows it by about 1.1 m/s² plus 0.1 per m/s of speed (a 16 m/s pass rolls ~60 m), and a bounce on grass keeps ~60 % of the
// vertical speed and ~70 % of the speed along the ground.
const GRAVITY = 9.81, AIR_K = 0.012;
const BOUNCE_UP = 0.6, BOUNCE_GROUND = 0.7, BOUNCE_MIN = 1.2;
const ROLL_A = 1.1, ROLL_C = 0.1;  // rolling on grass slows the ball by ROLL_A + ROLL_C * speed (m/s²)

/** How far a ball rolls on the grass while slowing from v0 to v1 (m/s). Used to aim passes. */
export function rollDistance(v0, v1) {
  return (v0 - v1) / ROLL_C - (ROLL_A / (ROLL_C * ROLL_C)) * Math.log((ROLL_A + ROLL_C * v0) / (ROLL_A + ROLL_C * v1));
}
/** Speed to kick a ball along the ground so it still has speed v1 after d metres. */
export function passSpeed(d, v1) {
  let lo = v1, hi = MAX_KICK;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (rollDistance(m, v1) < d) lo = m; else hi = m; }
  return hi;
}

/** World (x, z) -> pitch (u, v). */
export function toLocal(x, z) {
  const dx = x - F.cx, dz = z - F.cz;
  return [dx * F.ux + dz * F.uz, dx * F.vx + dz * F.vz];
}
/** Pitch (u, v) -> world (x, z). */
export function toWorld(u, v) {
  return [F.cx + F.ux * u + F.vx * v, F.cz + F.uz * u + F.vz * v];
}
/** A world direction (x, z) as a pitch direction (u, v). For a heading h the world direction is (sin h, cos h). */
export function dirLocal(x, z) {
  return [x * F.ux + z * F.uz, x * F.vx + z * F.vz];
}
/** A pitch direction (u, v) as a world direction (x, z). */
export function dirWorld(u, v) {
  return [F.ux * u + F.vx * v, F.uz * u + F.vz * v];
}
/** Where the ball sits while a player dribbles it: just in front of their feet. */
export function ballAtFeet(u, v, fu, fv) {
  return [u + fu * 0.62, v + fv * 0.62];
}
/** Kick-off spots in pitch coordinates for the first n players of a team. */
export function kickoffSpots(team, n, kickoffTeam) {
  const own = team === 0 ? -1 : 1; // sign of u in the team's own half
  const slots = team === kickoffTeam
    ? [[1.1, 0], [9, -14], [9, 14], [24, -8], [24, 8]]
    : [[11, 0], [12, -15], [12, 15], [26, -8], [26, 8]];
  return slots.slice(0, n).map(([d, v]) => [own * d, team === 0 ? v : -v]);
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const newKeeper = () => ({ v: 0, dive: 0, dd: 0, hold: 0, cd: 0, dec: 0 });

/** A fresh ball at the centre spot and both goalkeepers in the middle of their goals. */
export function newSim(seed) {
  return { b: { u: 0, v: 0, y: BALL_R, vu: 0, vv: 0, vy: 0, h: null }, k: [newKeeper(), newKeeper()], seed: seed >>> 0 };
}
export function resetBall(S) {
  Object.assign(S.b, { u: 0, v: 0, y: BALL_R, vu: 0, vv: 0, vy: 0, h: null });
  S.k[0] = newKeeper(); S.k[1] = newKeeper();
}
export function cloneSim(S) {
  return { b: { ...S.b }, k: S.k.map((k) => ({ ...k })), seed: S.seed };
}
/** Seeded random number in [0, 1) (mulberry32): the server and the browsers draw the same numbers. */
export function rand(S) {
  let t = (S.seed = (S.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const keeperHolds = (S) => S.b.h === 'k0' || S.b.h === 'k1';

/**
 * Advances the ball and both goalkeepers by dt seconds. A ball held by a player is left alone (the match code keeps
 * it at their feet). Events are pushed into ev: { e: 'goal', team } (team = who scored), { e: 'catch' | 'parry' | 'punt', k },
 * { e: 'post' }, { e: 'bounce' }.
 */
export function step(S, dt, ev) {
  keeper(S, 0, dt, ev);
  keeper(S, 1, dt, ev);
  const b = S.b;
  if (b.h != null) {
    if (keeperHolds(S)) {
      const i = b.h === 'k0' ? 0 : 1;
      b.u = KEEPER_U[i] + (i ? -0.45 : 0.45); b.v = S.k[i].v; b.y = 1.05; b.vu = b.vv = b.vy = 0;
    }
    return;
  }
  // flight, bounce, roll
  if (b.y > BALL_R + 0.001 || b.vy > 0) {
    const sp = Math.sqrt(b.vu * b.vu + b.vv * b.vv + b.vy * b.vy), drag = 1 - AIR_K * sp * dt;
    b.vu *= drag; b.vv *= drag; b.vy *= drag;
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= BALL_R) {
      b.y = BALL_R;
      if (b.vy < -BOUNCE_MIN) { b.vy = -b.vy * BOUNCE_UP; b.vu *= BOUNCE_GROUND; b.vv *= BOUNCE_GROUND; ev.push({ e: 'bounce' }); } else b.vy = 0;
    }
  } else {
    const sp = Math.sqrt(b.vu * b.vu + b.vv * b.vv);
    if (sp > 0) { const f = Math.max(0, sp - (ROLL_A + ROLL_C * sp) * dt) / sp; b.vu *= f; b.vv *= f; }
  }
  const pu = b.u, pv = b.v;
  b.u += b.vu * dt; b.v += b.vv * dt;
  const wasIn = pu > HL || pu < -HL; // already behind the goal line = inside a goal
  if (!wasIn && (b.u > HL || b.u < -HL)) {
    const side = b.u > 0 ? 1 : -1;
    const t = (side * HL - pu) / (b.u - pu), cv = pv + (b.v - pv) * t, acv = cv < 0 ? -cv : cv;
    if (acv < GOAL_W - BALL_R * 0.5 && b.y < GOAL_H - BALL_R * 0.5) {
      ev.push({ e: 'goal', team: side > 0 ? 0 : 1 });
    } else {
      // the frame of the goal (post or crossbar) or the boards along the goal line: back into play
      const frame = acv < GOAL_W + BALL_R && b.y < GOAL_H + BALL_R;
      b.u = side * (HL - 0.01);
      b.vu = -b.vu * (frame ? 0.7 : 0.5);
      if (frame) {
        if (acv >= GOAL_W - BALL_R * 0.5) b.vv += (cv > 0 ? 1 : -1) * 1.2; // off the post, outwards
        else b.vy = b.vy > 0 ? -b.vy * 0.4 : b.vy;                          // off the bar, downwards
        ev.push({ e: 'post' });
      }
    }
  } else if (wasIn) {
    // in the net: it stops the ball
    const side = pu > 0 ? 1 : -1, back = HL + GOAL_D - BALL_R, sw = GOAL_W - BALL_R;
    if (b.u * side > back) { b.u = side * back; b.vu = -b.vu * 0.1; }
    if (b.u * side < HL + 0.05) { b.u = side * (HL + 0.05); b.vu = 0; }
    if (b.v > sw) { b.v = sw; b.vv = -b.vv * 0.2; } else if (b.v < -sw) { b.v = -sw; b.vv = -b.vv * 0.2; }
    if (b.y > GOAL_H - BALL_R) { b.y = GOAL_H - BALL_R; if (b.vy > 0) b.vy = 0; }
    const net = 1 - 4 * dt;
    b.vu *= net; b.vv *= net;
  }
  // boards along the touchlines
  if (b.v > HW) { b.v = HW; b.vv = -b.vv * 0.55; } else if (b.v < -HW) { b.v = -HW; b.vv = -b.vv * 0.55; }
}

/** One goalkeeper: shuffles along the goal line, dives at shots, catches or parries, kicks the ball back out. */
function keeper(S, i, dt, ev) {
  const k = S.k[i], b = S.b, side = i ? 1 : -1, ku = KEEPER_U[i];
  if (k.cd > 0) k.cd -= dt;
  if (k.dive > 0) k.dive -= dt;
  if (b.h === 'k' + i) {
    k.hold -= dt;
    if (k.hold <= 0) { // long kick up the pitch, a little to one side
      const tv = (rand(S) * 2 - 1) * 16, du = -side * 32, dv = tv - k.v, L = Math.sqrt(du * du + dv * dv), sp = 19 + rand(S) * 4;
      b.h = null; b.u = ku - side * 1.1; b.v = k.v; b.y = 0.7;
      b.vu = (du / L) * sp; b.vv = (dv / L) * sp; b.vy = 9;
      k.cd = 0.9;
      ev.push({ e: 'punt', k: i });
    }
    return;
  }
  const free = b.h == null;
  const front = (ku - b.u) * side;                      // how far in front of him the ball is
  const incoming = free && b.vu * side > 2 && front > 0; // moving towards his goal
  let target = b.v * 0.35;
  if (incoming) { const t = (ku - b.u) / b.vu; if (t < 1.2) target = b.v + b.vv * t; }
  const lim = GOAL_W - 0.5;
  target = clamp(target, -lim, lim);
  const dv = target - k.v, maxStep = (k.dive > 0 ? 6.5 : 4) * dt;
  k.v += clamp(dv, -maxStep, maxStep);
  if (incoming && k.dive <= 0 && front < 10 && (dv > 0.8 || dv < -0.8)) { k.dive = 0.6; k.dd = dv > 0 ? 1 : -1; }
  if (!free || k.cd > 0) return;
  // the ball reaches him: save it or not (decided once per shot). Harder when the shot is hard, placed near
  // a post, or he is still far from it.
  if (front < 0.55 && front > -0.6 && !k.dec && b.vu * side > 0) {
    k.dec = 1;
    const d = Math.abs(b.v - k.v), av = Math.abs(b.v);
    if (b.y < 2.45 && d < 2.2 && av < GOAL_W + 0.3) {
      const sp = Math.sqrt(b.vu * b.vu + b.vv * b.vv + b.vy * b.vy);
      const pace = clamp(1.25 - sp / 32, 0.25, 0.95);
      const place = 1 - 0.55 * Math.min(1, (av / GOAL_W) * (av / GOAL_W));
      const reach = d < 1 ? 1 : 1 - (d - 1) * 0.35;
      if (rand(S) < pace * place * reach) { save(S, i, sp, ev); return; }
    }
  } else if (front > 1.6 || front < -1.5) k.dec = 0;
  // a slow ball right next to him: he picks it up
  if (front > -0.5 && front < 1.6 && Math.abs(b.v - k.v) < 1.1 && b.y < 1.6 && b.vu * b.vu + b.vv * b.vv < 36) {
    b.h = 'k' + i; k.hold = 1.2; b.vu = b.vv = b.vy = 0;
    ev.push({ e: 'catch', k: i });
  }
}

function save(S, i, sp, ev) {
  const b = S.b, k = S.k[i], side = i ? 1 : -1;
  if (sp < 18) {
    b.h = 'k' + i; k.hold = 1.2; b.vu = b.vv = b.vy = 0;
    ev.push({ e: 'catch', k: i });
  } else { // too hard to hold: pushed away to one side
    b.vu = -b.vu * 0.3;
    b.vv = b.vv * 0.25 + (rand(S) < 0.5 ? -1 : 1) * (3 + rand(S) * 3);
    b.vy = 2.5 + rand(S) * 2.5;
    b.u = KEEPER_U[i] - side * 0.6;
    k.cd = 0.6;
    ev.push({ e: 'parry', k: i });
  }
}
