// Khu F after the drone photos (Aug 2024) and photos from the fountain pond. The long 4-storey block keeps the normal
// building path (open-corridor facades, light grey metal roof), on the OSM outline without its east wing. That wing
// is Hội trường F and is built here, with what stands in front of it:
//  - the hall: a high main hall under a pale blue metal roof (two slopes, ridge along the middle), lower aisles each
//    side behind white vertical fins, a front porch with fins either side of the doors under a flat canopy;
//  - the stair tower where the hall meets the block: taller than the block, red tiled hip roof, a strip of glass
//    blocks and a white face carrying the school's cube: a cube turned 45 degrees with half of it standing out of
//    the wall, teal on top and the DUT logo (the blue square with the yellow P, cut from img/dut-logo.jpg, never
//    redrawn) on both sides;
//  - the stage in front of the hall: a low platform with stepped, rounded edges and three nested red squares;
//  - sân F, the paved square east of the hall: stone slabs on a 3.25 m grid, light slabs with a pink middle in rows
//    of three, and a big square with a compass rose (pink corners, a ring of 16 yellow and pink points).
// Distances are measured on the photos against the OSM outline (the hall is 19.3 m wide in both).
import * as THREE from 'three';
import { Builder, emblemTex } from './campus-details.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const V = (p, y) => [p[0], y, p[1]];

const HALL_H = 9.4, RIDGE = 10.25, AISLE_H = 6.2, MAIN_W = 7.65, AISLE_OUT = 9.2;
const PORCH = 3.4, CANOPY = 6.6;
const TOWER_D = 5.14, TOWER_V = [-5.0, 6.85], TOWER_H = 20.2, TOWER_RIDGE = 22.0;
const STAGE_D = 7.7, STAGE_W = 9.95, STEP_N = 4, STEP_T = 0.35, STEP_H = 0.12;
const CELL = 3.25;                                 // paving grid of the square
const PLAZA = { s0: -9, s1: 58, v0: -19, v1: 11 }; // paved area in the hall frame
const C = {
  wall: 0xefebe2, fin: 0xf8f7f3, win: 0x5a6b7e, aisleRoof: 0x80868c, roof: 0x9dcad0, roofEdge: 0x7fb2ba,
  tower: 0xf3f2ee, tile: 0xb3573f, tileEdge: 0x8e4532, glassBlock: 0x48535e, glassLine: 0xc9d0d6,
  teal: 0x2fae9a, tealLight: 0x82d3c1, cubeUnder: 0xd9dcdc,
  stage: 0x9ba0a6, stageSide: 0xb7babe, red: 0xb03a36, door: 0x3e4c5c, canopy: 0x8d9297,
};

export const isKhuF = (b) => b.zone === 'F' && (b.fullPts || b.pts)?.length === 24;

/** Hall frame: s outwards from its front (towards the square), v to the north, origin in the middle of the front. */
function frame(P) {
  const p1 = P[1], p2 = P[2], f = unit(sub(p2, p1));
  const u = [f[1], -f[0]], n = [-f[0], -f[1]], o = lerp2(p1, p2, 0.5);
  const at = (s, v) => [o[0] + u[0] * s + n[0] * v, o[1] + u[1] * s + n[1] * v];
  const loc = (p) => { const d = sub(p, o); return [dot(d, u), dot(d, n)]; };
  const back = loc(P[4])[0]; // the long block's east face behind the hall
  return { o, u, n, at, loc, back, hw: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2 };
}
/** Where "go to Khu F" puts you: on the square in front of the hall's stage, facing the hall doors. */
export function khuFFront(P) { const F = frame(P); return { spot: F.at(STAGE_D + 7, 0), door: F.at(0, 0) }; }
/** The OSM outline split into the long block (built as a normal building) and the hall wing (built here). */
export function khuFSplit(P) {
  const F = frame(P), s0 = F.loc(P[0])[0];
  const A = lerp2(P[1], P[0], F.back / s0); // on the hall's north wall, level with the block's east face
  return { spine: [P[18], P[19], P[20], P[21], P[22], P[23], P[0], A, ...P.slice(4, 18)], hall: [A, P[0], P[1], P[2], P[3], P[4]] };
}

function prism(B, ring, y0, y1, side, top = side) { B.color(side).band(ring, y0, y1); B.color(top).cap(ring, y1); }
function rounded(s1, vh, r, k = 6) { // stage step: square back on the hall, rounded front corners
  const pts = [[0, -vh], [s1 - r, -vh]];
  for (let i = 1; i < k; i++) { const a = -Math.PI / 2 + (i / k) * (Math.PI / 2); pts.push([s1 - r + Math.cos(a) * r, -vh + r + Math.sin(a) * r]); }
  pts.push([s1, -vh + r], [s1, vh - r]);
  for (let i = 1; i < k; i++) { const a = (i / k) * (Math.PI / 2); pts.push([s1 - r + Math.cos(a) * r, vh - r + Math.sin(a) * r]); }
  pts.push([s1 - r, vh], [0, vh]);
  return pts;
}

/** Sân F drawn on a canvas, in the hall frame: x along s (PLAZA.s0 -> s1), y along v (north at the top). */
function plazaTexture(K = 24) {
  const W = Math.round((PLAZA.s1 - PLAZA.s0) * K), H = Math.round((PLAZA.v1 - PLAZA.v0) * K);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (s) => (s - PLAZA.s0) * K, Y = (v) => (PLAZA.v1 - v) * K;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // stone slabs, each a little lighter or darker, darker joints
  const s0 = STAGE_D; // the grid starts at the front of the stage, centred on the axis across
  for (let s = s0 - Math.ceil((s0 - PLAZA.s0) / CELL) * CELL; s < PLAZA.s1; s += CELL) {
    for (let v = -CELL / 2 - Math.ceil(-PLAZA.v0 / CELL) * CELL; v < PLAZA.v1; v += CELL) {
      const k = 150 + Math.round((rnd() - 0.5) * 22);
      g.fillStyle = `rgb(${k},${k + 2},${k + 6})`;
      g.fillRect(X(s), Y(v + CELL), CELL * K, CELL * K);
      for (let i = 0; i < 5; i++) { // weathering blotches
        g.fillStyle = `rgba(70,74,80,${0.05 + rnd() * 0.08})`;
        g.beginPath(); g.ellipse(X(s + rnd() * CELL), Y(v + rnd() * CELL), (0.2 + rnd() * 0.6) * K, (0.15 + rnd() * 0.4) * K, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(80,84,90,0.55)'; g.lineWidth = Math.max(1, 0.05 * K);
      g.strokeRect(X(s), Y(v + CELL), CELL * K, CELL * K);
    }
  }
  // light slabs with a pink middle: rows 1, 3 and 11 of the grid, three across (axis and two cells each side)
  const light = (sc, vc) => {
    const h = CELL / 2 - 0.08;
    g.fillStyle = '#e4e1dc'; g.fillRect(X(sc - h), Y(vc + h), 2 * h * K, 2 * h * K);
    const m = h - 0.3; g.fillStyle = '#c6c4c3'; g.fillRect(X(sc - m), Y(vc + m), 2 * m * K, 2 * m * K);
    const q = 0.6; g.fillStyle = '#d495a0'; g.fillRect(X(sc - q), Y(vc + q), 2 * q * K, 2 * q * K);
  };
  for (const row of [1, 3, 11]) for (const vc of [-2 * CELL, 0, 2 * CELL]) light(s0 + (row + 0.5) * CELL, vc);
  // the compass square: rows 5-9, five cells across
  const q0 = s0 + 5 * CELL, q1 = s0 + 10 * CELL, half = 2.5 * CELL, cs = (q0 + q1) / 2;
  g.fillStyle = '#c3c5cb'; g.fillRect(X(q0), Y(half), (q1 - q0) * K, 2 * half * K);
  const leg = 4.2;
  g.fillStyle = '#c495aa';
  for (const [a, b, da, db] of [[q0, half, 1, -1], [q1, half, -1, -1], [q0, -half, 1, 1], [q1, -half, -1, 1]]) {
    g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(a + da * leg), Y(b)); g.lineTo(X(a), Y(b + db * leg)); g.closePath(); g.fill();
  }
  const cx = X(cs), cy = Y(0), R = 4.8 * K, Ri = 3.35 * K;
  g.fillStyle = '#bd7f99'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 16; i++) { // 16 points round the ring, yellow and deep pink in turn
    const a = (i / 16) * Math.PI * 2, w = Math.PI / 16;
    g.fillStyle = i % 2 ? '#a95a7c' : '#e2b45c';
    g.beginPath(); g.moveTo(cx + Math.cos(a - w) * Ri, cy + Math.sin(a - w) * Ri);
    g.lineTo(cx + Math.cos(a) * (R - 0.08 * K), cy + Math.sin(a) * (R - 0.08 * K));
    g.lineTo(cx + Math.cos(a + w) * Ri, cy + Math.sin(a + w) * Ri); g.closePath(); g.fill();
  }
  g.fillStyle = '#d8ccd2'; g.beginPath(); g.arc(cx, cy, Ri, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c99aae'; g.beginPath(); g.arc(cx, cy, Ri - 0.35 * K, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 16; i++) { // eight-pointed star in the middle, facets in two pinks
    const a = (i / 16) * Math.PI * 2, r = (i % 2 ? 1.25 : 2.85) * K, a2 = ((i + 1) / 16) * Math.PI * 2, r2 = ((i + 1) % 2 ? 1.25 : 2.85) * K;
    g.fillStyle = i % 2 ? '#b0708d' : '#d9a7b9';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(90,60,75,0.5)'; g.lineWidth = Math.max(1, 0.04 * K);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.strokeRect(X(q0), Y(half), (q1 - q0) * K, 2 * half * K);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const fadeable = (geo, mat) => { // the camera fades meshes in the way (walk.js wants a material array)
  geo.clearGroups(); geo.addGroup(0, geo.getAttribute('position').count, 0);
  const m = new THREE.Mesh(geo, [mat]); m.castShadow = m.receiveShadow = true; return m;
};

/**
 * Hall, tower, cube logo, stage and square of Khu F `b` (b.fullPts = the OSM outline). Returns { group, meshes (fade
 * when in the way; a click on them is a click on Khu F), solids, surfaces (the stage steps), ground (meshes to paint
 * with the ground layers), clear (keep trees and lamps off the square), setNight }.
 */
export function buildKhuF(b) {
  const P = b.fullPts || b.pts, F = frame(P), { at, back, hw } = F;
  const rect = (s0, s1, v0, v1) => [at(s0, v0), at(s1, v0), at(s1, v1), at(s0, v1)];
  const group = new THREE.Group(), B = new Builder(), surfaces = [];
  const box = (s0, s1, v0, v1, y0, y1, side, top = side) => prism(B, rect(s0, s1, v0, v1), y0, y1, side, top);
  const quadS = (s, v0, v1, y0, y1) => B.quad(V(at(s, v0), y0), V(at(s, v1), y0), V(at(s, v1), y1), V(at(s, v0), y1));
  const quadV = (v, s0, s1, y0, y1) => B.quad(V(at(s0, v), y0), V(at(s1, v), y0), V(at(s1, v), y1), V(at(s0, v), y1));

  // ---- the hall: main volume, aisles behind white fins, roof ----
  const sF = -PORCH;
  box(back, sF, -MAIN_W, MAIN_W, 0, HALL_H, C.wall);
  for (const sd of [-1, 1]) {
    box(back, sF, Math.min(sd * MAIN_W, sd * AISLE_OUT), Math.max(sd * MAIN_W, sd * AISLE_OUT), 0, AISLE_H, C.wall, C.aisleRoof);
    B.color(C.win);
    for (let s = back + 2.6; s < sF - 1; s += 2.4) {
      quadV(sd * (AISLE_OUT + 0.02), s - 0.7, s + 0.7, 1.0, 5.2);  // tall windows between the fins
      quadV(sd * (MAIN_W + 0.02), s - 0.8, s + 0.8, 7.0, 8.6);     // clerestory over the aisle roof
    }
    for (let s = back + 1.4; s <= sF + 0.01; s += 2.4) box(s - 0.11, s + 0.11, Math.min(sd * AISLE_OUT, sd * (hw - 0.02)), Math.max(sd * AISLE_OUT, sd * (hw - 0.02)), 0, AISLE_H + 0.6, C.fin);
  }
  const r1 = sF + 0.3, rv = MAIN_W + 0.35;
  B.color(C.roof);
  for (const sd of [-1, 1]) B.quad(V(at(back, sd * rv), HALL_H), V(at(r1, sd * rv), HALL_H), V(at(r1, 0), RIDGE), V(at(back, 0), RIDGE));
  B.color(C.roofEdge).quad(V(at(back, -0.07), RIDGE + 0.01), V(at(r1, -0.07), RIDGE + 0.01), V(at(r1, 0.07), RIDGE + 0.01), V(at(back, 0.07), RIDGE + 0.01));
  B.color(C.wall).tri(V(at(sF + 0.01, -MAIN_W), HALL_H), V(at(sF + 0.01, MAIN_W), HALL_H), V(at(sF + 0.01, 0), RIDGE - 0.05));
  // front: doors in the middle, windows over them, canopy on fins either side
  B.color(C.door); quadS(sF + 0.02, -3.25, 3.25, 0, 3.6);
  B.color(C.win); for (const v of [-2.2, 0, 2.2]) quadS(sF + 0.02, v - 0.9, v + 0.9, 4.3, 5.9);
  box(sF, 0.25, -hw, hw, CANOPY, CANOPY + 0.32, C.fin, C.canopy);
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) { const v = sd * (3.65 + k * 1.18); box(-0.85, 0, v - 0.11, v + 0.11, 0, CANOPY + 0.75, C.fin); }

  // ---- stair tower: white, glass blocks, red tiled hip roof ----
  const t0 = back, t1 = back + TOWER_D, [tv0, tv1] = TOWER_V;
  box(t0, t1, tv0, tv1, 0, TOWER_H, C.tower);
  {
    const o = 0.45, a0 = t0 - o, a1 = t1 + o, b0 = tv0 - o, b1 = tv1 + o, sm = (a0 + a1) / 2, d = (a1 - a0) / 2;
    const R0 = V(at(sm, b0 + d), TOWER_RIDGE), R1 = V(at(sm, b1 - d), TOWER_RIDGE);
    const E00 = V(at(a0, b0), TOWER_H), E10 = V(at(a1, b0), TOWER_H), E11 = V(at(a1, b1), TOWER_H), E01 = V(at(a0, b1), TOWER_H);
    B.color(C.tile); B.quad(E00, E01, R1, R0); B.quad(E10, E11, R1, R0); B.tri(E00, E10, R0); B.tri(E01, E11, R1);
    const eave = [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
    B.color(C.tileEdge).band(eave, TOWER_H - 0.22, TOWER_H); B.color(C.tower).cap(eave, TOWER_H - 0.22);
  }
  {
    const gs = t1 + 0.03, gv0 = tv0 + 0.15, gv1 = -1.0, gy0 = HALL_H + 0.6, gy1 = TOWER_H - 0.35;
    B.color(C.glassBlock); quadS(gs, gv0, gv1, gy0, gy1);
    B.color(C.glassLine);
    for (let i = 0; i <= 8; i++) { const v = gv0 + ((gv1 - gv0) * i) / 8; quadS(gs + 0.01, v - 0.03, v + 0.03, gy0, gy1); }
    for (let j = 0; j <= 22; j++) { const y = gy0 + ((gy1 - gy0) * j) / 22; quadS(gs + 0.01, gv0, gv1, y - 0.03, y + 0.03); }
  }

  // ---- the cube logo: turned 45 degrees, half of it out of the wall, under the eave ----
  const LV = 2.9, LY = TOWER_H - 0.6, A = 1.8, h = A / Math.SQRT2;
  const WS = at(t1, LV - h), WN = at(t1, LV + h), FV = at(t1 + h, LV);
  B.color(C.teal).tri(V(WS, LY), V(FV, LY), V(WN, LY));
  const cen = [(WS[0] + WN[0] + FV[0]) / 3, (WS[1] + WN[1] + FV[1]) / 3], shrink = (p) => lerp2(cen, p, 0.45);
  B.color(C.tealLight).tri(V(shrink(WS), LY + 0.01), V(shrink(FV), LY + 0.01), V(shrink(WN), LY + 0.01));
  B.color(C.cubeUnder).tri(V(WS, LY - A), V(WN, LY - A), V(FV, LY - A));
  const lpos = [], luv = [], U0 = 96 / 392, U1 = 376 / 392, VT = 1 - 93 / 386, VB = 1 - 369 / 386;
  const face = (L, R) => { // one side of the cube: the logo's blue square with the yellow P, upright
    const q = [V(L, LY), V(R, LY), V(R, LY - A), V(L, LY - A)], t = [[U0, VT], [U1, VT], [U1, VB], [U0, VB]];
    for (const i of [0, 1, 2, 0, 2, 3]) { lpos.push(...q[i]); luv.push(...t[i]); }
  };
  face(WS, FV); face(FV, WN);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  lg.computeVertexNormals();
  const logo = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ map: emblemTex(), side: THREE.DoubleSide }));
  logo.castShadow = true;

  // ---- stage in front of the hall: stepped rounded edges, three nested red squares, two shrubs ----
  for (let k = 0; k < STEP_N; k++) {
    const ring = rounded(STAGE_D - k * STEP_T, STAGE_W - k * STEP_T, Math.max(0.35, 1.3 - k * STEP_T)).map(([s, v]) => at(s, v));
    prism(B, ring, k * STEP_H, (k + 1) * STEP_H, C.stageSide, k === STEP_N - 1 ? C.stage : C.stageSide);
    surfaces.push({ pts: ring, y: (k + 1) * STEP_H });
  }
  const top = STEP_N * STEP_H;
  // porch under the canopy at stage level: you can walk in to the doors between the fins
  box(sF, 0, -hw, hw, 0, top, C.stageSide, C.stage);
  surfaces.push({ pts: rect(sF, 0, -hw, hw), y: top });
  const finSolids = [];
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) { const v = sd * (3.65 + k * 1.18); finSolids.push(rect(-0.85, 0, v - 0.11, v + 0.11)); }
  const square = (sc, vc, side, w) => {
    const q = side / 2;
    B.color(C.red);
    for (const [a0, a1, b0, b1] of [[sc - q, sc + q, vc - q, vc - q + w], [sc - q, sc + q, vc + q - w, vc + q], [sc - q, sc - q + w, vc - q, vc + q], [sc + q - w, sc + q, vc - q, vc + q]]) B.cap(rect(a0, a1, b0, b1), top + 0.006);
  };
  for (const vc of [-5.8, 0, 5.8]) { square(3.3, vc, 4.3, 0.24); square(3.3, vc, 2.0, 0.2); }
  const bushGeo = new THREE.IcosahedronGeometry(0.5, 1), bushMat = new THREE.MeshLambertMaterial({ color: 0x4d7a3a, flatShading: true });
  for (const v of [-8.2, 8.2]) {
    const m = new THREE.Mesh(bushGeo, bushMat), p = at(5.9, v);
    m.position.set(p[0], top + 0.4, p[1]); m.scale.set(1, 0.85, 1); m.castShadow = true;
    group.add(m);
  }

  const solid = fadeable(B.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.add(solid, logo);

  // ---- sân F: one textured layer on the ground ----
  const ppos = [], puv = [];
  const corners = [[PLAZA.s0, PLAZA.v0, 0, 0], [PLAZA.s1, PLAZA.v0, 1, 0], [PLAZA.s1, PLAZA.v1, 1, 1], [PLAZA.s0, PLAZA.v1, 0, 1]];
  for (const i of [0, 2, 1, 0, 3, 2]) { const [s, v, tu, tv] = corners[i], p = at(s, v); ppos.push(p[0], 0, p[1]); puv.push(tu, tv); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2));
  pg.computeVertexNormals();
  const plazaMat = new THREE.MeshLambertMaterial({ map: plazaTexture(), side: THREE.DoubleSide, depthWrite: false });
  const plaza = new THREE.Mesh(pg, plazaMat);
  plaza.receiveShadow = true;

  return {
    group, meshes: [solid], surfaces, ground: [plaza],
    solids: [rect(back, sF, -hw, hw), ...finSolids], // the hall without its porch, and the porch fins
    clear: [rect(PLAZA.s0, PLAZA.s1, PLAZA.v0, PLAZA.v1), rect(-1, STAGE_D + 1, -STAGE_W - 1, STAGE_W + 1)],
    setNight(on) { plazaMat.color.set(on ? 0x8a90a0 : 0xffffff); },
  };
}
