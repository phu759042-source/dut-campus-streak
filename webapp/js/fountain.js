// Fountain pond (hồ đài phun nước) east of Khu F. In OSM the water is one polygon with two lobes, a round pond and
// an irregular one to the west, joined by a neck that a footpath crosses. Built as in the photos (2018, 2024):
//  - a concrete kerb wall all round the water (0.55 m, wide coping you can walk or sit on), the water a bit lower;
//  - in the round pond a ring walkway on square pillars (20 straight sides) around the fountain, reached by a pier
//    from the east bank: 3 steps up onto the pier at the kerb, 3 more at its far end up onto the ring;
//  - inside the ring, in the water, the fountain: a drum and two steps clad in brown stone, a white stand and three
//    white saucers with brown stone rims, smaller and smaller upwards, thin spout pipes on the top step;
//  - the blue arched footbridge with lattice railings over the neck, on the line of that footpath.
// You cannot walk into the water (walk.js, `water`), so the pier and the bridge are the ways across.
// You can sit on the kerb, facing the water, and on the inner edge of the ring, facing the fountain.
import * as THREE from 'three';
import { Builder, offsetPoly, insideP } from './campus-details.js';

const CENTER = [24.3, -14.0];                     // middle of the round lobe (circle through its banks)
const BRIDGE_ENDS = [[12.4, 3.4], [5.9, -11.4]];  // the footpath over the neck (OSM), south end first
const RIM_H = 0.55, RIM_W = 0.45, COPE = 0.08, WATER_Y = 0.25;
// ring walkway: apothems of its outer / inner edge (a flat side faces the pier), deck top and thickness
const RING_N = 20, RING_AO = 10.5, RING_AI = 8.7, RING_Y = 1.05, RING_T = 0.22;
const PIER_W = 2.0, TREAD = 0.3;
const BRIDGE_W = 2.2, BRIDGE_H = 1.35, BRIDGE_SEG = 14, BRIDGE_T = 0.28, RAIL_H = 1.0;
const SIT_DROP = 0.13; // a seat is this far below the top you sit on (same as the stands in stadium.js)
const C = {
  coping: 0xdad5c9, kerb: 0xc2bdb0, kerbIn: 0xa9a49a, pier: 0xc9c5ba, tread: 0xd6d2c7,
  ring: 0xc8c4b9, ringSide: 0xaeaaa0, pillar: 0x9e9a90,
  stone: 0x86674a, stoneTop: 0x6f5844, stoneDark: 0x765b42, white: 0xe4e1da, under: 0xd3d0c8,
  rim: 0xa07d55, rimTop: 0xb48f63, pipe: 0x9aa1a8,
  deck: 0xc4bfb5, deckSide: 0xa7a298, blue: 0x3b8fd9,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
const V = (p, y) => [p[0], y, p[1]];
const circ = (c, r, n = 48) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });
const near = (a, b, tol = 0.6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

/** Frustum (or flat ring when y0 = y1) between two rings with the same vertex count. */
function cone(B, inner, y0, outer, y1) {
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length;
    B.quad(V(inner[i], y0), V(inner[j], y0), V(outer[j], y1), V(outer[i], y1));
  }
}
/** Upright prism on a closed ring, with a lid. */
function prism(B, ring, y0, y1, side, top = side) { B.color(side).band(ring, y0, y1); B.color(top).cap(ring, y1); }
/** Thin straight member between two points [x, y, z] (railings, pipes): w across, h up. */
function beam(B, a, b, w, h = w) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, f = d.map((v) => v / L);
  let sx = -f[2], sz = f[0];
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-3) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  const up = [f[1] * sz, f[2] * sx - f[0] * sz, -f[1] * sx]; // f x side
  const P = (p, i, j) => [p[0] + sx * i * w / 2 + up[0] * j * h / 2, p[1] + up[1] * j * h / 2, p[2] + sz * i * w / 2 + up[2] * j * h / 2];
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [i0, j0] = cs[k], [i1, j1] = cs[(k + 1) % 4];
    B.quad(P(a, i0, j0), P(a, i1, j1), P(b, i1, j1), P(b, i0, j0));
  }
}
/** Distances s (0..L) along o + u s where that line crosses the edges of a polygon, sorted. */
function crossings(poly, o, u, L) {
  const out = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], e = sub(poly[i], a), den = u[0] * e[1] - u[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, o), s = (w[0] * e[1] - w[1] * e[0]) / den, t = (w[0] * u[1] - w[1] * u[0]) / den;
    if (t >= 0 && t <= 1 && s >= 0 && s <= L) out.push(s);
  }
  return out.sort((p, q) => p - q);
}
/** t in [0, 1] where lo < f0 + (f1 - f0) t < hi, or null. */
function linInt(f0, f1, lo, hi) {
  const d = f1 - f0;
  if (Math.abs(d) < 1e-9) return f0 > lo && f0 < hi ? [0, 1] : null;
  let a = (lo - f0) / d, b = (hi - f0) / d;
  if (a > b) [a, b] = [b, a];
  a = Math.max(a, 0); b = Math.min(b, 1);
  return a < b ? [a, b] : null;
}
/** Parts of the segment m0-m1 (as [t0, t1]) outside all the corridors { o, u, n, hw, s0, s1 }. */
function keepParts(m0, m1, cuts) {
  let parts = [[0, 1]];
  for (const c of cuts) {
    const r0 = sub(m0, c.o), r1 = sub(m1, c.o);
    const iv = linInt(dot(r0, c.n), dot(r1, c.n), -c.hw, c.hw), is = linInt(dot(r0, c.u), dot(r1, c.u), c.s0, c.s1);
    if (!iv || !is) continue;
    const a = Math.max(iv[0], is[0]), b = Math.min(iv[1], is[1]);
    if (a >= b) continue;
    parts = parts.flatMap(([p, q]) => (b <= p || a >= q) ? [[p, q]] : [...(a > p ? [[p, a]] : []), ...(b < q ? [[b, q]] : [])]);
  }
  return parts.filter(([p, q]) => q - p > 1e-3);
}
/** The polygon shrunk by d (the inner edge of the kerb); corners moved along their bisectors if offsetPoly gives up. */
function inset(poly, d) {
  const o = offsetPoly(poly, -d);
  if (o) return o;
  let A = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) A += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  const s = A > 0 ? 1 : -1, n = poly.length;
  return poly.map((p, i) => {
    const a = unit(sub(p, poly[(i - 1 + n) % n])), b = unit(sub(poly[(i + 1) % n], p));
    const na = [-a[1] * s, a[0] * s], nb = [-b[1] * s, b[0] * s]; // inward normals
    const m = unit(add(na, nb)), k = Math.max(0.35, dot(m, na));
    return add(p, m, d / k);
  });
}

/**
 * Returns null when the pond is not in the data, else { group, surfaces, walls, clear, seatAt(x, z, y), setTheme }:
 * surfaces / walls for walk mode (kerb, pier, steps, ring, bridge deck and its railings), clear = areas to keep
 * trees and lamps off, seatAt = where you sit down from (x, z) at height y (or null).
 * Marks the OSM footpath the bridge replaces with `footbridge` so the map does not paint it on the water.
 */
export function buildFountain(data) {
  const area = data.areas.find((a) => a.kind === 'water' && insideP(a.pts, CENTER[0], CENTER[1]));
  if (!area) return null;
  const pond = area.pts;
  const group = new THREE.Group();
  const B = new Builder(), W = new Builder(); // structure / water surfaces
  const surfaces = [], walls = [], clear = [], cuts = [];

  // ---- pier frame: from the east bank (E) towards the middle ----
  const east = crossings(pond, CENTER, [1, 0], 40)[0] ?? 15;
  const E = add(CENTER, [1, 0], east), u = [-1, 0], n = [0, 1];
  const F = (s, v) => add(add(E, u, s), n, v);
  const sR = east - RING_AO;            // from the bank to the outer side of the ring
  const hw = PIER_W / 2, h1 = RIM_H / 3, h2 = (RING_Y - RIM_H) / 3;
  const rect = (s0, s1, v0, v1) => [F(s0, v0), F(s1, v0), F(s1, v1), F(s0, v1)];
  cuts.push({ o: E, u, n, hw, s0: -1, s1: 1.5 });
  clear.push(rect(-3, 0.5, -2.4, 2.4));

  // ---- footbridge over the neck, on the line of the OSM footpath ----
  const road = data.roads.find((r) => r.foot && r.pts.length >= 2 && ((near(r.pts[0], BRIDGE_ENDS[0]) && near(r.pts.at(-1), BRIDGE_ENDS[1])) || (near(r.pts[0], BRIDGE_ENDS[1]) && near(r.pts.at(-1), BRIDGE_ENDS[0]))));
  let bridge = null;
  if (road) {
    road.footbridge = true;
    const S0 = near(road.pts[0], BRIDGE_ENDS[0]) ? road.pts[0] : road.pts.at(-1), S1 = S0 === road.pts[0] ? road.pts.at(-1) : road.pts[0];
    const L = Math.hypot(S1[0] - S0[0], S1[1] - S0[1]), ub = unit(sub(S1, S0)), nb = [-ub[1], ub[0]];
    const wet = crossings(pond, S0, ub, L);
    const sIn = wet[0] ?? L * 0.2, sOut = wet.at(-1) ?? L * 0.8;
    // highest over the middle of the water: warp s so the crest of the arch falls there
    const p = THREE.MathUtils.clamp(Math.log(0.5) / Math.log(THREE.MathUtils.clamp((sIn + sOut) / 2 / L, 0.2, 0.8)), 0.6, 1.6);
    bridge = { S0, L, ub, nb, sIn, sOut, y: (s) => BRIDGE_H * Math.sin(Math.PI * Math.pow(THREE.MathUtils.clamp(s / L, 0, 1), p)) };
    cuts.push({ o: S0, u: ub, n: nb, hw: BRIDGE_W / 2 + 0.1, s0: -0.5, s1: L + 0.5 });
    const G = (s, v) => add(add(S0, ub, s), nb, v);
    clear.push([G(-2, -2.6), G(L + 2, -2.6), G(L + 2, 2.6), G(-2, 2.6)]);
  }

  // ---- water a little below the kerb, and the kerb wall with its coping ----
  W.cap(pond, WATER_Y);
  const inner = inset(pond, RIM_W);
  const rimPieces = []; // centre line of each piece of kerb and the way to the water, for the seats
  for (let i = 0; i < pond.length; i++) {
    const j = (i + 1) % pond.length, P0 = pond[i], P1 = pond[j], Q0 = inner[i], Q1 = inner[j];
    for (const [ta, tb] of keepParts(lerp2(P0, Q0, 0.5), lerp2(P1, Q1, 0.5), cuts)) {
      const pa = lerp2(P0, P1, ta), pb = lerp2(P0, P1, tb), qa = lerp2(Q0, Q1, ta), qb = lerp2(Q0, Q1, tb);
      const out = unit(sub(lerp2(pa, pb, 0.5), lerp2(qa, qb, 0.5)));
      const pa2 = add(pa, out, 0.04), pb2 = add(pb, out, 0.04); // the coping juts out a little
      const y0 = RIM_H - COPE;
      B.color(C.kerb).quad(V(pa, 0), V(pb, 0), V(pb, y0), V(pa, y0));
      B.quad(V(pa, y0), V(pb, y0), V(pb2, y0), V(pa2, y0));
      B.color(C.coping).quad(V(pa2, y0), V(pb2, y0), V(pb2, RIM_H), V(pa2, RIM_H));
      B.quad(V(pa2, RIM_H), V(pb2, RIM_H), V(qb, RIM_H), V(qa, RIM_H));
      B.color(C.kerbIn).quad(V(qa, WATER_Y - 0.05), V(qb, WATER_Y - 0.05), V(qb, RIM_H), V(qa, RIM_H));
      if (ta > 0) B.color(C.kerb).quad(V(pa2, 0), V(qa, 0), V(qa, RIM_H), V(pa2, RIM_H)); // cut ends (pier, bridge)
      if (tb < 1) B.color(C.kerb).quad(V(pb2, 0), V(qb, 0), V(qb, RIM_H), V(pb2, RIM_H));
      surfaces.push({ pts: [pa, pb, qb, qa], y: RIM_H });
      rimPieces.push({ a: lerp2(pa, qa, 0.5), b: lerp2(pb, qb, 0.5), n: [-out[0], -out[1]] });
    }
  }

  // ---- pier: 3 steps up at the bank, the pier, 3 steps up onto the ring ----
  for (let k = 1; k <= 3; k++) prism(B, rect(-0.9 + (k - 1) * TREAD, -0.9 + k * TREAD, -hw, hw), 0, k * h1, C.pier, C.tread);
  prism(B, rect(0, sR - 0.9, -hw, hw), WATER_Y - 0.05, RIM_H, C.pier, C.tread);
  for (let k = 1; k <= 3; k++) prism(B, rect(sR - 0.9 + (k - 1) * TREAD, sR - 0.9 + k * TREAD, -hw, hw), WATER_Y - 0.05, RIM_H + k * h2, C.pier, C.tread);
  surfaces.push(
    { pts: rect(-0.9, 0, -hw, hw), ramp: { o: F(-0.9, 0), u, len: 0.9, y0: 0, y1: RIM_H, steps: 3 } },
    { pts: rect(0, sR - 0.9, -hw, hw), y: RIM_H },
    { pts: rect(sR - 0.9, sR, -hw, hw), ramp: { o: F(sR - 0.9, 0), u, len: 0.9, y0: RIM_H, y1: RING_Y, steps: 3 } },
  );

  // ---- ring walkway on pillars (a flat side faces the pier) ----
  const th0 = Math.atan2(E[1] - CENTER[1], E[0] - CENTER[0]), step = (2 * Math.PI) / RING_N;
  const ringPts = (ap) => Array.from({ length: RING_N }, (_, k) => {
    const a = th0 + step / 2 + k * step, r = ap / Math.cos(step / 2);
    return [CENTER[0] + Math.cos(a) * r, CENTER[1] + Math.sin(a) * r];
  });
  const ro = ringPts(RING_AO), ri = ringPts(RING_AI), rm = ringPts((RING_AO + RING_AI) / 2);
  B.color(C.ring).ringCap(ro, ri, RING_Y);
  B.color(C.ringSide).band(ro, RING_Y - RING_T, RING_Y);
  B.band(ri, RING_Y - RING_T, RING_Y);
  B.ringCap(ro, ri, RING_Y - RING_T);
  for (let k = 0; k < RING_N; k++) {
    surfaces.push({ pts: [ro[k], ro[(k + 1) % RING_N], ri[(k + 1) % RING_N], ri[k]], y: RING_Y });
    B.color(C.pillar).box(rm[k][0], rm[k][1], 0.35, 0.35, WATER_Y - 0.05, RING_Y - RING_T - WATER_Y + 0.05, th0 + step / 2 + k * step);
  }

  // ---- the fountain in the middle: stone drum and two steps, white stand, three saucers ----
  const S = (r, k = 48) => circ(CENTER, r, k);
  prism(B, S(4.45), WATER_Y - 0.05, 0.75, C.stoneDark, C.stoneTop);
  prism(B, S(3.8), 0.75, 1.1, C.stone, C.stoneTop);
  prism(B, S(3.15), 1.1, 1.45, C.stone, C.stoneTop);
  prism(B, S(0.9, 24), 1.45, 1.7, C.white);
  const saucer = (y0, r0, y1, R, h) => {
    B.color(C.under); cone(B, S(r0, 32), y0, S(R, 32), y1);
    B.color(C.rim).band(S(R, 32), y1, y1 + h);
    B.color(C.rimTop); cone(B, S(R - 0.14, 32), y1 + h, S(R, 32), y1 + h);
    B.color(C.rim).band(S(R - 0.14, 32), y1 + 0.06, y1 + h);
    W.cap(S(R - 0.14, 32), y1 + h - 0.06);
  };
  saucer(1.7, 0.45, 2.1, 2.15, 0.26);
  B.color(C.white).band(S(0.3, 16), 2.1, 2.75);
  saucer(2.7, 0.32, 2.98, 1.5, 0.22);
  B.color(C.white).band(S(0.26, 16), 2.98, 3.4);
  saucer(3.35, 0.28, 3.58, 1.08, 0.2);
  B.color(C.pipe).band(S(0.05, 8), 3.58, 3.85);
  for (let k = 0; k < 12; k++) { // spout pipes on the top step, leaning in
    const d = [Math.cos(k * Math.PI / 6 + 0.26), Math.sin(k * Math.PI / 6 + 0.26)];
    beam(B, V(add(CENTER, d, 2.95), 1.45), V(add(CENTER, d, 2.7), 1.9), 0.05);
  }

  // ---- the footbridge: arched deck, blue lattice railings, two slim piers in the water ----
  if (bridge) {
    const { S0, L, ub, nb, sIn, sOut, y } = bridge, bh = BRIDGE_W / 2, rv = bh - 0.05;
    const G = (s, v) => add(add(S0, ub, s), nb, v);
    const ss = Array.from({ length: BRIDGE_SEG + 1 }, (_, k) => (L * k) / BRIDGE_SEG), ys = ss.map(y);
    const D = new Builder();
    for (let k = 0; k < BRIDGE_SEG; k++) {
      const s0 = ss[k], s1 = ss[k + 1], y0 = ys[k], y1 = ys[k + 1];
      const b0 = Math.max(0.02, y0 - BRIDGE_T), b1 = Math.max(0.02, y1 - BRIDGE_T);
      B.color(C.deck).quad(V(G(s0, -bh), y0), V(G(s1, -bh), y1), V(G(s1, bh), y1), V(G(s0, bh), y0));
      B.color(C.deckSide);
      for (const v of [-bh, bh]) B.quad(V(G(s0, v), b0), V(G(s1, v), b1), V(G(s1, v), y1), V(G(s0, v), y0));
      B.quad(V(G(s0, -bh), b0), V(G(s1, -bh), b1), V(G(s1, bh), b1), V(G(s0, bh), b0));
      surfaces.push({ pts: [G(s0, -bh), G(s1, -bh), G(s1, bh), G(s0, bh)], ramp: { o: G(s0, 0), u: ub, len: s1 - s0, y0, y1 } });
      for (const v of [-rv, rv]) {
        const a = G(s0, v), b = G(s1, v);
        walls.push({ a, b, y0: Math.min(y0, y1) - 0.5, y1: Math.max(y0, y1) + RAIL_H });
        D.color(C.blue);
        beam(D, V(a, y0 + RAIL_H), V(b, y1 + RAIL_H), 0.07, 0.05);       // handrail
        beam(D, V(a, y0 + 0.12), V(b, y1 + 0.12), 0.05);                 // bottom rail
        beam(D, V(a, y0 + 0.12), V(b, y1 + RAIL_H), 0.035);              // lattice
        beam(D, V(a, y0 + RAIL_H), V(b, y1 + 0.12), 0.035);
      }
    }
    for (let k = 0; k <= BRIDGE_SEG; k++) for (const v of [-rv, rv]) beam(D, V(G(ss[k], v), ys[k]), V(G(ss[k], v), ys[k] + RAIL_H + 0.03), 0.06);
    for (const f of [1 / 3, 2 / 3]) {
      const s = sIn + (sOut - sIn) * f;
      prism(B, [G(s - 0.18, -bh + 0.15), G(s + 0.18, -bh + 0.15), G(s + 0.18, bh - 0.15), G(s - 0.18, bh - 0.15)], WATER_Y - 0.05, y(s) - BRIDGE_T + 0.01, C.pillar);
    }
    const rails = D.mesh();
    rails.castShadow = true;
    group.add(rails);
  }

  const solid = B.mesh(), water = new THREE.Mesh(W.geometry(), new THREE.MeshLambertMaterial({ color: 0x6fb7e8, side: THREE.DoubleSide }));
  water.receiveShadow = true;
  group.add(solid, water);
  const tinted = group.children.filter((m) => m !== water).map((m) => m.material);

  /** Where you sit down from (x, z) at height y: the inner edge of the ring, or the kerb next to you. */
  function seatAt(x, z, y) {
    const d = sub([x, z], CENTER);
    if (Math.abs(y - RING_Y) < 0.3) {
      const k = Math.round((Math.atan2(d[1], d[0]) - th0) / step), a = th0 + k * step;
      const nk = [Math.cos(a), Math.sin(a)], tk = [-nk[1], nk[0]], ap = dot(d, nk);
      if (ap > RING_AI - 0.2 && ap < RING_AO + 0.2) {
        const lim = RING_AI * Math.tan(step / 2) - 0.3, t = THREE.MathUtils.clamp(dot(d, tk), -lim, lim);
        const p = add(add(CENTER, nk, RING_AI + 0.22), tk, t);
        return { x: p[0], z: p[1], y: RING_Y - SIT_DROP, heading: Math.atan2(-nk[0], -nk[1]) };
      }
    }
    const onKerb = Math.abs(y - RIM_H) < 0.3;
    if (!onKerb && (y > 0.3 || insideP(pond, x, z))) return null;
    let best = null, bd = onKerb ? 0.5 : 1.1;
    for (const r of rimPieces) {
      const e = sub(r.b, r.a), L2 = dot(e, e) || 1, t = THREE.MathUtils.clamp(dot(sub([x, z], r.a), e) / L2, 0.08, 0.92);
      const p = add(r.a, e, t), dd = Math.hypot(p[0] - x, p[1] - z);
      if (dd < bd) { bd = dd; best = { x: p[0], z: p[1], y: RIM_H - SIT_DROP, heading: Math.atan2(r.n[0], r.n[1]) }; }
    }
    return best;
  }

  return {
    group, surfaces, walls, clear, seatAt,
    setTheme(dark, pal) {
      water.material.color.set(pal.water);
      for (const m of tinted) m.color.set(dark ? 0x8d95a8 : 0xffffff);
    },
  };
}
