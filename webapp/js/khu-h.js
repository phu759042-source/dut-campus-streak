// Khu H as a walk-in teaching block, laid out from the floor plan framed in the building ("Sơ đồ các phòng chức
// năng khu H") and photos taken inside:
//  - a V-shaped block: centre bar (4 floors) with a wing on each side (3 floors); stair towers with WCs at the two
//    outer corners where the wings meet the centre, white horizontal louvers on their walls
//  - the ground floor is raised (brick plinth, steps up at every entrance), corridors run along the courtyard side
//    behind ribbon windows with small red-tile awnings, classrooms are on the outer side
//  - main entrance in the middle of the centre bar: curved steps under a curved glass bay (floors 2-4), a wide
//    staircase behind it (middle flight up, two side flights back), dog-leg stairs in both corner towers
//  - rooms numbered as on the plan: 101-104 (long wing), 105/106 (centre), 107/108 (short wing), same upstairs,
//    401/402 on the 4th floor; WC, Kho vật tư and Phòng nước GV next to the corner towers
// Floors above the one you stand on are hidden while you are inside, so the follow camera sees your floor.
import * as THREE from 'three';
import { Builder, insideP, offsetPoly, FLOOR_H } from './campus-details.js';

const FH = FLOOR_H, PL = 0.75, SLAB = 0.22, CD = 2.8; // floor height, raised ground floor, slab, corridor depth
const Y = (k) => PL + k * FH;                          // floor level k (0 = ground floor)
const C_WALL = 0xf4f1ea, C_INNER = 0xefeae0, C_TILE = 0xb4533f, C_TILE_D = 0x8f4434, C_FRAME = 0x4b5560;
const C_FLOOR = 0xd9ab80, C_ROOMFL = 0xd3cfc6, C_CEIL = 0xf3f0ea, C_BRICK = 0x9c4a36, C_STAIR = 0x5d6670, C_STAIR2 = 0x67707a;
const C_DOOR = 0x8a5a3c, C_RAIL = 0xc9ced4, C_ROOF_W = 0x8fae9c, C_PLATE = '#1f4e9c';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Local frame: a along u, b along w (both unit vectors). */
function frame(o, u, w) {
  return {
    o, u, w, ang: Math.atan2(u[1], u[0]),
    at: (a, b) => [o[0] + u[0] * a + w[0] * b, o[1] + u[1] * a + w[1] * b],
    loc: (p) => { const d = sub(p, o); return [dot(d, u), dot(d, w)]; },
    rect(a0, a1, b0, b1) { return [this.at(a0, b0), this.at(a1, b0), this.at(a1, b1), this.at(a0, b1)]; },
  };
}
/** Frame from o towards uPt, w pointing to the side of sidePt. */
function mkFrame(o, uPt, sidePt) {
  const u = unit(sub(uPt, o));
  let w = [-u[1], u[0]];
  if (dot(w, sub(sidePt, o)) < 0) w = [u[1], -u[0]];
  return frame(o, u, w);
}
/** Keep the part of a polygon where f(p) >= 0 (Sutherland-Hodgman against one line). */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) out.push(lerp(a, b, fa / (fa - fb)));
  }
  return out;
}
const boxF = (B, F, a0, a1, b0, b1, y0, h) => {
  const c = F.at((a0 + a1) / 2, (b0 + b1) / 2);
  B.box(c[0], c[1], Math.abs(a1 - a0), Math.abs(b1 - b0), y0, h, F.ang);
};
const fadeable = (geo, mat) => {
  geo.clearGroups(); geo.addGroup(0, geo.getAttribute('position').count, 0);
  const m = new THREE.Mesh(geo, [mat]); m.castShadow = m.receiveShadow = true; return m;
};
const spans = (L, gaps) => { // [0, L] minus the gaps
  const out = []; let s = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > s + 0.05) out.push([s, g0]); s = Math.max(s, g1); }
  if (L > s + 0.05) out.push([s, L]);
  return out;
};

/** Can this building be built from the plan? (OSM outline with the 16 corners the layout below is measured on) */
export const isKhuH = (b) => b.zone === 'H' && (b.osmPts || b.pts)?.length === 16;

/**
 * Bars measured on the OSM outline. OSM corners: 0-1 long wing (courtyard side), 1..6 centre bar (2-5 = entrance
 * bump), 6-13 short wing + its corner tower, 13-14 centre outer side, 14-15 long wing outer side.
 * The short wing is NOT taken from OSM: there the outline is offset (the wing sits 2 m towards the courtyard, is
 * narrower and its tower juts out), unlike the floor plan where both ends of the centre bar are alike. It is built
 * as the mirror image of the long wing's junction (same angle, width and corner tower), reaching as far as OSM's end.
 */
function layout(P) {
  const LW = mkFrame(P[1], P[0], P[15]), LW_L = len(sub(P[0], P[1])), LW_D = dot(sub(P[15], P[0]), LW.w);
  const C = mkFrame(P[1], P[6], P[14]), C_L = len(sub(P[6], P[1])), C_D = dot(sub(P[14], P[1]), C.w);
  const uC = (p) => C.loc(p)[0], wC = (p) => C.loc(p)[1];
  const mir = (p) => C.at(C_L - uC(p), wC(p));                                // mirror across the middle of the centre bar
  const vC = (v) => [dot(v, C.u), dot(v, C.w)], cV = (a) => [C.u[0] * a[0] + C.w[0] * a[1], C.u[1] * a[0] + C.w[1] * a[1]];
  const mv = (v) => { const a = vC(v); return cV([-a[0], a[1]]); };
  const SW = frame(P[6], mv(LW.u), mv(LW.w)), SW_D = LW_D, SW_L = dot(sub(P[9], P[6]), SW.u);
  const C0o = C.at(0, C_D), C2o = C.at(C_L, C_D);                            // centre bar ends on its outer side
  const LWo = LW.at(0, LW_D), SWo0 = SW.at(0, SW_D);                        // wing starts on their outer sides
  const M14 = mir(P[14]);                                                   // outer corner of the second tower
  const SWe0 = SW.at(SW_L, 0), SWe1 = SW.at(SW_L, SW_D);
  const outline = [P[0], P[1], P[2], P[3], P[4], P[5], P[6], SWe0, SWe1, SWo0, M14, P[14], P[15]];
  return { LW, LW_L, LW_D, C, C_L, C_D, SW, SW_L, SW_D, C0o, C2o, LWo, M14, SWo0, SWe0, SWe1, uC, wC, outline };
}
/** The outline the map uses for Khu H (minimap, trees, selection): OSM with the short wing as built here. */
export const khuHOutline = (pts) => layout(pts).outline;

/**
 * Build Khu H. `out` collects what the walker needs (walls with a height range, solids, surfaces) and the meshes.
 * Returns { group, meshes, update(state) }.
 */
export function buildKhuH(b, out) {
  const P = b.osmPts || b.pts;
  const group = new THREE.Group();
  const lv = [0, 1, 2, 3, 4].map(() => ({ B: new Builder(), G: new Builder(), group: new THREE.Group() }));
  const wall = (a, c, y0, y1) => out.walls.push({ a, b: c, y0, y1 });
  /** Straight wall between two points (box + collision). */
  const seg = (k, p, q, y0, h, color, t = 0.2, collide = true) => {
    const L = len(sub(q, p)); if (L < 0.05) return;
    const B = lv[k].B; B.color(color);
    B.box((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, L, t, y0, h, Math.atan2(q[1] - p[1], q[0] - p[0]));
    if (collide) wall(p, q, y0, y0 + h);
  };
  /** Wall along a frame line b = const from a0 to a1 with door gaps. */
  const run = (k, F, a0, a1, bb, gaps, y0, h, color, collide = true) => {
    for (const [s, e] of spans(a1 - a0, gaps.map(([g0, g1]) => [g0 - a0, g1 - a0]))) seg(k, F.at(a0 + s, bb), F.at(a0 + e, bb), y0, h, color, 0.2, collide);
  };

  // ---------- the three bars (see layout()) ----------
  const { LW, LW_L, LW_D, C, C_L, C_D, SW, SW_L, SW_D, C0o, C2o, LWo, M14, SWo0, SWe0, SWe1, uC, wC, outline: Pm } = layout(P);
  const hall0 = uC(P[2]), hall1 = uC(P[5]);                                   // entrance hall between 105 and 106
  // corner towers (outside the bars, mirror images of each other) and the 4th floor outline (centre + towers)
  const J1 = [P[1], LWo, P[14], C0o];
  const J2 = [P[6], C2o, M14, SWo0];
  const F4 = [P[1], LWo, P[14], M14, SWo0, P[6], P[5], P[4], P[3], P[2]];
  const JW0 = 6.8, JW1 = C_D - 0.1;                    // corner stairs: from the landing (w = JW0) to the back wall
  const J1u = [-5.5, 0], J2u = [C_L, C_L + 5.5];
  const J1floor = clip(J1, (p) => JW0 - wC(p)), J2floor = clip(J2, (p) => JW0 - wC(p));
  const WC1 = clip(clip(J1, (p) => wC(p) - JW0), (p) => J1u[0] - uC(p));
  const WC2 = clip(clip(J2, (p) => wC(p) - JW0), (p) => uC(p) - J2u[1]);
  // WCs: the corner of each tower beside its stairs, with the door position (u) on the landing side
  const WCs = [[WC1, J1u[0] - 1.05], [WC2, J2u[1] + 0.2]].filter(([p]) => p.length >= 3);
  // centre bar: back corridor along the outer side (b from BC to C_D), store rooms UT wide at both ends
  const BC = C_D - 2.0, UT = 3.1;
  // curved glass bay over the main entrance
  const bayOut = [-C.w[0], -C.w[1]];
  const arc = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, p = lerp(P[3], P[4], t); arc.push([p[0] + bayOut[0] * 1.6 * Math.sin(Math.PI * t), p[1] + bayOut[1] * 1.6 * Math.sin(Math.PI * t)]); }
  const bay = [P[2], ...arc, P[5]];

  // ---------- entrances: steps up to the raised ground floor ----------
  const doors = []; // door gaps in the outer walls of the ground floor
  function entry(a, c, n, run = 1.6, steps = 5) {
    const d0 = [a[0] + n[0] * run, a[1] + n[1] * run], d1 = [c[0] + n[0] * run, c[1] + n[1] * run];
    out.surfaces.push({ pts: [a, c, d1, d0], ramp: { o: d0, u: [-n[0], -n[1]], len: run, y0: 0, y1: PL, steps } });
    const E = frame(a, unit(sub(c, a)), n), W = len(sub(c, a));
    const B = lv[0].B;
    for (let i = 0; i < steps; i++) { B.color(i % 2 ? 0xc9c3b8 : 0xbdb7ac); boxF(B, E, 0, W, (run * (steps - i - 1)) / steps, (run * (steps - i)) / steps, 0, ((i + 1) / steps) * PL); }
    B.color(C_BRICK); boxF(B, E, -0.25, 0, 0, run, 0, PL + 0.1); boxF(B, E, W, W + 0.25, 0, run, 0, PL + 0.1); // cheek walls
    doors.push([a, c]);
  }
  /** Steps as nested shapes, the top one level with the floor (shape(i) for i = 1..5, the lower ones larger). */
  const stack = (shape) => {
    const B = lv[0].B;
    for (let i = 1; i <= 5; i++) {
      const pts = shape(i), y = (i * PL) / 5;
      B.color(i % 2 ? 0xc8c2b6 : 0xbab4a8); B.band(pts, ((i - 1) * PL) / 5, y); B.cap(pts, y);
      out.surfaces.push({ pts, y });
    }
  };
  // end of the long wing (after 101), as on the plan: the corridor end opens on two sides and the steps wrap round
  // the corner (courtyard side + end) with a cut corner
  {
    const L = LW_L, u0 = L - 3.0;
    stack((i) => {
      const d = (6 - i) * 0.32, ch = 1.0 + d;
      return [LW.at(u0, 0), LW.at(u0, -d), LW.at(L + d - ch, -d), LW.at(L + d, -d + ch), LW.at(L + d, CD), LW.at(L, CD)];
    });
    lv[0].B.color(C_BRICK); boxF(lv[0].B, LW, u0 - 0.25, u0, -1.7, 0, 0, PL + 0.1); // cheek wall where the steps stop
    doors.push([LW.at(u0 + 0.2, 0), LW.at(L - 0.25, 0)], [LW.at(L, 0.25), LW.at(L, CD - 0.3)]);
    lv[0].B.color(0xf7f5f0); { const c = LW.at(L - 0.2, 0.2); lv[0].B.box(c[0], c[1], 0.36, 0.36, 0, Y(1) - SLAB, LW.ang); } // corner column
    { // small cabinet against the end wall of 101, beside the steps (drawn on the plan)
      const c = LW.at(L + 0.4, CD + 0.75);
      lv[0].B.color(0x59616b); lv[0].B.box(c[0], c[1], 0.6, 0.9, 0, 1.5, LW.ang);
      out.solids.push(LW.rect(L + 0.1, L + 0.7, CD + 0.3, CD + 1.2));
    }
  }
  entry(SW.at(SW_L, 0.35), SW.at(SW_L, 2.45), SW.u);                   // end of the short wing (after 108)
  entry(LW.at(22.4, LW_D), LW.at(25.1, LW_D), LW.w);                   // through passage between 102 and 103
  entry(LW.at(22.4, 0), LW.at(25.1, 0), [-LW.w[0], -LW.w[1]]);
  entry(LW.at(1.2, 0), LW.at(3.6, 0), [-LW.w[0], -LW.w[1]]);           // courtyard doors near the corner towers
  entry(SW.at(1.2, 0), SW.at(3.6, 0), [-SW.w[0], -SW.w[1]]);
  // back door of the entrance hall (ground floor, as on the plan): through the hall under the stair landing, two
  // doors either side of the middle flight, a porch with steps down to the outer side
  {
    const ua = hall0 + 0.1, ub = hall1 - 0.1, sw = (ub - ua) * 0.28, mid = (hall0 + hall1) / 2, Ls = 1.2;
    // rounded porch (straight sides, half-circle end) with steps all round, two columns at its end
    stack((i) => {
      const h = 3.6 + (5 - i) * 0.3, pts = [C.at(mid - h, C_D - 0.05)];
      for (let j = 0; j <= 16; j++) { const a = (Math.PI * j) / 16; pts.push(C.at(mid - h * Math.cos(a), C_D + Ls + h * Math.sin(a))); }
      pts.push(C.at(mid + h, C_D - 0.05));
      return pts;
    });
    for (const sg of [-1, 1]) {
      const a = Math.PI / 2 + sg * 0.55, c = C.at(mid - 3.1 * Math.cos(a), C_D + Ls + 3.1 * Math.sin(a));
      lv[0].B.color(0xf7f5f0); lv[0].B.box(c[0], c[1], 0.36, 0.36, PL, 2.9, C.ang);
      out.solids.push([[c[0] - 0.2, c[1] - 0.2], [c[0] + 0.2, c[1] - 0.2], [c[0] + 0.2, c[1] + 0.2], [c[0] - 0.2, c[1] + 0.2]]);
    }
    { // flat canopy over the porch on the columns
      const pts = [C.at(mid - 3.4, C_D)];
      for (let j = 0; j <= 16; j++) { const a = (Math.PI * j) / 16; pts.push(C.at(mid - 3.4 * Math.cos(a), C_D + Ls + 3.4 * Math.sin(a))); }
      pts.push(C.at(mid + 3.4, C_D));
      lv[0].B.color(C_WALL); lv[0].B.band(pts, PL + 2.9, PL + 3.15); lv[0].B.cap(pts, PL + 3.15); lv[0].B.color(C_CEIL); lv[0].B.cap(pts, PL + 2.9);
    }
    doors.push([C.at(ua + 0.2, C_D), C.at(ua + sw - 0.2, C_D)], [C.at(ub - sw + 0.2, C_D), C.at(ub - 0.2, C_D)]);
  }
  // main entrance: curved steps (half discs, the top one level with the floor) under the bay
  {
    const M = lerp(P[3], P[4], 0.5), U = unit(sub(P[4], P[3]));
    const disc = (r) => { const pts = []; for (let i = 0; i <= 16; i++) { const a = (Math.PI * i) / 16; pts.push([M[0] + U[0] * r * Math.cos(a) + bayOut[0] * r * Math.sin(a), M[1] + U[1] * r * Math.cos(a) + bayOut[1] * r * Math.sin(a)]); } return pts; };
    const B = lv[0].B;
    for (let i = 1; i <= 5; i++) {
      const pts = disc(4.6 - (i - 1) * 0.35), y = (i * PL) / 5;
      B.color(i % 2 ? 0xc8c2b6 : 0xbab4a8); B.band(pts, (i - 1) * PL / 5, y); B.cap(pts, y);
      out.surfaces.push({ pts, y });
    }
    // two columns at the front of the bay
    for (const t of [0.22, 0.78]) {
      const p = arc[Math.round(t * 10)], q = [p[0] - bayOut[0] * 0.35, p[1] - bayOut[1] * 0.35];
      B.color(0xf7f5f0); B.box(q[0], q[1], 0.42, 0.42, 0, Y(1) - SLAB, C.ang);
      out.solids.push([[q[0] - 0.22, q[1] - 0.22], [q[0] + 0.22, q[1] - 0.22], [q[0] + 0.22, q[1] + 0.22], [q[0] - 0.22, q[1] + 0.22]]);
    }
  }

  // ---------- floor slabs (holes over the stairs) ----------
  const floorPieces = (k) => {
    if (k === 0) return [Pm];
    const ps = [];
    if (k <= 2) ps.push(LW.rect(0, LW_L, 0, LW_D), SW.rect(0, SW_L, 0, SW_D));
    ps.push(C.rect(0, hall0, 0, C_D), C.rect(hall0, hall1, -0.3, 4.6), C.rect(hall0, hall1, BC, C_D), C.rect(hall1, C_L, 0, C_D), bay, J1floor, J2floor);
    return ps;
  };
  lv[0].B.color(C_BRICK); lv[0].B.band(Pm, 0, PL); // brick plinth of the raised ground floor
  for (let k = 0; k <= 3; k++) {
    const B = lv[k].B;
    for (const pts of floorPieces(k)) {
      B.color(C_FLOOR); B.cap(pts, Y(k));
      if (k > 0) { B.color(C_CEIL); B.cap(pts, Y(k) - SLAB); }
      out.surfaces.push({ pts, y: Y(k) });
    }
    if (k > 0) { // slab edges around the stair wells
      B.color(0xe2ddd3);
      B.band(C.rect(hall0, hall1, 4.6, BC), Y(k) - SLAB, Y(k));
      B.band(C.rect(J1u[0], J1u[1], JW0, JW1), Y(k) - SLAB, Y(k));
      B.band(C.rect(J2u[0], J2u[1], JW0, JW1), Y(k) - SLAB, Y(k));
    }
  }

  // ---------- outside walls ----------
  const N3 = [0, 1, 2], N4 = [0, 1, 2, 3];
  const edges = [
    [P[0], P[1], 'corr', N3], [P[1], P[2], 'corr', N4], [P[2], P[3], 'plain', N4], [P[4], P[5], 'plain', N4],
    [P[5], P[6], 'corr', N4], [P[6], SWe0, 'corr', N3],
    [SWe0, SWe1, 'end', N3], [SWe1, SWo0, 'room', N3], [SWo0, M14, 'tower', N4],
    [M14, C2o, 'tower', N4], [C2o, C0o, 'corr', N4], [C0o, P[14], 'tower', N4], [P[14], LWo, 'tower', N4],
    [LWo, P[15], 'room', N3], [P[15], P[0], 'end', N3], [P[1], LWo, 'plain', [3]], [P[6], SWo0, 'plain', [3]],
  ];
  function awning(B, E, s, e, y, depth = 0.75, drop = 0.32) {
    const a = E.at(s, 0), c = E.at(e, 0), d = E.at(e, -depth), f = E.at(s, -depth);
    B.color(C_TILE); B.quad([a[0], y, a[1]], [c[0], y, c[1]], [d[0], y - drop, d[1]], [f[0], y - drop, f[1]]);
    B.color(C_TILE_D); boxF(B, E, s, e, -depth - 0.03, -depth + 0.03, y - drop - 0.08, 0.1);
  }
  for (const [a, c, style, floors] of edges) {
    const poly = floors.length === 1 ? F4 : Pm;
    const u = unit(sub(c, a)), m = lerp(a, c, 0.5);
    let w = [-u[1], u[0]];
    if (!insideP(poly, m[0] + w[0] * 0.4, m[1] + w[1] * 0.4)) w = [-w[0], -w[1]];
    const E = frame(a, u, w), L = len(sub(c, a));
    for (const k of floors) {
      const B = lv[k].B, G = lv[k].G, y0 = Y(k), ground = k === 0;
      const gaps = [];
      if (ground) for (const [da, db] of doors) {
        const [ta, oa] = E.loc(da), [tb, ob] = E.loc(db);
        if (Math.abs(oa) < 0.3 && Math.abs(ob) < 0.3) gaps.push([Math.min(ta, tb), Math.max(ta, tb)]);
      }
      for (const [g0, g1] of gaps) { // door: frame + lintel
        B.color(C_WALL); boxF(B, E, g0, g1, 0, 0.24, y0 + 2.4, FH - 2.4);
        B.color(C_DOOR); boxF(B, E, g0 - 0.06, g0, 0, 0.26, y0, 2.4); boxF(B, E, g1, g1 + 0.06, 0, 0.26, y0, 2.4);
      }
      for (const [s, e] of spans(L, gaps)) {
        wall(E.at(s, 0.12), E.at(e, 0.12), ground ? 0 : y0, y0 + FH);
        const W = e - s;
        if (style === 'corr') { // open corridor: parapet, wide openings between white piers (no glass), rail on top
          B.color(C_WALL); boxF(B, E, s, e, 0, 0.24, y0, 1.0); boxF(B, E, s, e, 0, 0.24, y0 + 2.65, FH - 2.65);
          const n = Math.max(1, Math.round(W / 3.2));
          for (let i = 0; i <= n; i++) { const x = s + (W * i) / n; boxF(B, E, Math.max(s, x - 0.18), Math.min(e, x + 0.18), 0, 0.26, y0 + 1.0, 1.65); }
          B.color(C_RAIL); boxF(B, E, s, e, 0.08, 0.16, y0 + 1.0, 0.06);
          if (k > 0) awning(B, E, s, e, y0 + 0.25);
        } else if (style === 'room') { // classroom windows with small tile awnings
          const n = Math.max(1, Math.round(W / 3.6)), bay = W / n, ww = Math.min(2.2, bay - 0.9);
          B.color(C_WALL); boxF(B, E, s, e, 0, 0.24, y0, 0.95); boxF(B, E, s, e, 0, 0.24, y0 + 2.45, FH - 2.45);
          for (let i = 0; i < n; i++) {
            const c0 = s + bay * i + (bay - ww) / 2, c1 = c0 + ww;
            B.color(C_WALL); boxF(B, E, s + bay * i, c0, 0, 0.24, y0 + 0.95, 1.5); boxF(B, E, c1, s + bay * (i + 1), 0, 0.24, y0 + 0.95, 1.5);
            B.color(C_FRAME); boxF(B, E, (c0 + c1) / 2 - 0.03, (c0 + c1) / 2 + 0.03, 0.06, 0.18, y0 + 0.95, 1.5);
            G.color(0xbfdcef); boxF(G, E, c0, c1, 0.11, 0.13, y0 + 0.95, 1.5);
            awning(B, E, c0 - 0.2, c1 + 0.2, y0 + 2.75, 0.6, 0.28);
          }
        } else if (style === 'tower') { // stair tower: white horizontal louvers in a frame
          B.color(C_WALL); boxF(B, E, s, Math.min(e, s + 0.5), 0, 0.24, y0, FH); boxF(B, E, Math.max(s, e - 0.5), e, 0, 0.24, y0, FH);
          if (W > 1.3) {
            B.color(0xffffff);
            for (let y = y0 + 0.15; y < y0 + FH; y += 0.3) boxF(B, E, s + 0.5, e - 0.5, -0.2, 0.0, y, 0.06);
            for (const t of [1 / 3, 2 / 3]) { const x = s + 0.5 + (W - 1) * t; boxF(B, E, x - 0.04, x + 0.04, -0.22, 0.02, y0, FH); }
          }
        } else { // plain wall, wing ends with one window
          B.color(C_WALL);
          if (style === 'end' && W > 2.5) {
            const c0 = s + W / 2 - 0.7, c1 = c0 + 1.4;
            boxF(B, E, s, c0, 0, 0.24, y0, FH); boxF(B, E, c1, e, 0, 0.24, y0, FH);
            boxF(B, E, c0, c1, 0, 0.24, y0, 1.0); boxF(B, E, c0, c1, 0, 0.24, y0 + 2.4, FH - 2.4);
          } else boxF(B, E, s, e, 0, 0.24, y0, FH);
        }
      }
    }
  }
  // curved glass bay (floors 2-4), open entrance under it
  for (let k = 1; k <= 3; k++) {
    const B = lv[k].B, G = lv[k].G, y0 = Y(k);
    B.color(0xe2ddd3); B.band(arc, y0 - SLAB, y0);
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i], c = arc[i + 1], E = frame(a, unit(sub(c, a)), C.w), W = len(sub(c, a));
      B.color(C_FRAME); boxF(B, E, -0.04, 0.04, 0, 0.12, y0, FH); boxF(B, E, 0, W, 0, 0.12, y0 + 0.2, 0.05); boxF(B, E, 0, W, 0, 0.12, y0 + 2.3, 0.05);
      B.color(0x3f474f); boxF(B, E, 0, W, 0.25, 0.3, y0 + 0.95, 0.05); // inner rail
      G.color(0xc8e2f2); boxF(G, E, 0, W, 0.05, 0.07, y0 + 0.2, FH - 0.2);
      wall(a, c, y0, y0 + FH);
    }
  }
  { const B = lv[4].B; B.color(C_WALL); B.band(arc, Y(4) - 0.3, Y(4) + 0.25); B.cap(bay, Y(4) + 0.25); B.color(C_CEIL); B.cap(bay, Y(4) - 0.3); }

  // ---------- rooms ----------
  const label = (k, F, a, bb, y, text) => {
    const wide = text.length > 6, cw = wide ? 384 : 192, c = document.createElement('canvas'); c.width = cw; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = C_PLATE; g.fillRect(0, 0, cw, 64); g.fillStyle = '#fff';
    g.font = `800 ${wide ? 30 : 40}px "Be Vietnam Pro", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wide ? 1.2 : 0.6, 0.2), new THREE.MeshBasicMaterial({ map: t }));
    const p = F.at(a, bb); m.position.set(p[0], y, p[1]); m.rotation.y = Math.atan2(-F.w[0], -F.w[1]);
    lv[k].group.add(m);
  };
  const doorLeaf = (k, F, g0, open) => {
    const B = lv[k].B; B.color(C_DOOR);
    if (open) boxF(B, F, g0 + 0.02, g0 + 0.07, CD + 0.1, CD + 1.0, Y(k), 2.1); // swung open into the room
    else boxF(B, F, g0, g0 + 0.95, CD - 0.03, CD + 0.03, Y(k), 2.1);
  };
  /** Wall along b with windows between the door gaps (you can look into the class from the corridor). */
  function glassWall(k, F, a0, a1, bb, gaps) {
    const B = lv[k].B, y0 = Y(k);
    for (const [s0, s1] of spans(a1 - a0, gaps.map(([g0, g1]) => [g0 - a0, g1 - a0]))) {
      const u0 = a0 + s0, u1 = a0 + s1;
      wall(F.at(u0, bb), F.at(u1, bb), y0, y0 + FH);
      B.color(C_INNER); boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0, 1.0); boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0 + 2.2, FH - 2.2);
      if (u1 - u0 < 1.2) { boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2); continue; }
      const n = Math.max(1, Math.round((u1 - u0 - 0.6) / 1.4));
      B.color(C_FRAME);
      for (let i = 0; i <= n; i++) { const x = u0 + 0.3 + ((u1 - u0 - 0.6) * i) / n; boxF(B, F, x - 0.03, x + 0.03, bb - 0.06, bb + 0.06, y0 + 1.0, 1.2); }
      B.color(C_INNER); boxF(B, F, u0, u0 + 0.3, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2); boxF(B, F, u1 - 0.3, u1, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2);
      lv[k].G.color(0xbfdcef); boxF(lv[k].G, F, u0 + 0.3, u1 - 0.3, bb - 0.01, bb + 0.01, y0 + 1.0, 1.2);
    }
    for (const g of gaps) { B.color(C_INNER); boxF(B, F, g[0], g[1], bb - 0.1, bb + 0.1, y0 + 2.2, FH - 2.2); }
  }
  /**
   * Classroom between a0 and a1 on bar F (corridor at b < CD, wall at b = D): board, teacher's desk, rows of desks.
   * board: 'end' puts the board at a1 (as drawn on the plan for the long wing). back: D is an inner wall with windows
   * and a door to the back corridor at the a1 end (centre bar).
   */
  function classroom(k, F0, a0, a1, D, name, { board = 'start', back = false } = {}) {
    // board at a1: work in a mirrored frame where the room still spans [a0, a1]
    const F = board === 'end' ? frame(F0.at(a0 + a1, 0), [-F0.u[0], -F0.u[1]], F0.w) : F0;
    const B = lv[k].B, y0 = Y(k), mid = (CD + D) / 2;
    B.color(C_ROOMFL); B.cap(F.rect(a0 + 0.1, a1 - 0.1, CD + 0.1, D - 0.12), y0 + 0.012);
    const g1 = [a0 + 0.7, a0 + 1.7], g2 = [a1 - 1.7, a1 - 0.7];
    glassWall(k, F, a0, a1, CD, [g1, g2]);
    for (const g of [g1, g2]) doorLeaf(k, F, g[0], true);
    if (back) {
      glassWall(k, F, a0, a1, D, [g2]);
      B.color(C_DOOR); boxF(B, F, g2[0] + 0.02, g2[0] + 0.07, D - 1.0, D - 0.1, y0, 2.1);
    }
    seg(k, F.at(a0, CD), F.at(a0, D), y0, FH, C_INNER); seg(k, F.at(a1, CD), F.at(a1, D), y0, FH, C_INNER);
    // board on the end wall, teacher's desk in front of it
    B.color(0x2f4a3a); boxF(B, F, a0 + 0.1, a0 + 0.16, CD + 1.6, D - 1.6, y0 + 0.95, 1.2);
    B.color(0xd8d2c4); boxF(B, F, a0 + 0.1, a0 + 0.2, CD + 1.5, D - 1.5, y0 + 0.9, 0.05);
    B.color(C_DOOR); boxF(B, F, a0 + 1.3, a0 + 2.0, mid - 0.7, mid + 0.7, y0, 0.78); wall(F.at(a0 + 1.65, mid - 0.7), F.at(a0 + 1.65, mid + 0.7), y0, y0 + 0.85);
    // rows of long desks with benches (students face the board), aisles in the middle and along the walls
    for (let a = a0 + 3.0; a < a1 - 0.9; a += 1.3) for (const [b0, b1] of [[CD + 1.2, mid - 0.7], [mid + 0.7, D - 0.9]]) {
      B.color(0xb98a5a); boxF(B, F, a - 0.25, a + 0.25, b0, b1, y0 + 0.72, 0.05);
      B.color(0x7a5a3e); boxF(B, F, a - 0.24, a - 0.2, b0, b1, y0 + 0.3, 0.42);
      B.color(0x8c6a4a); boxF(B, F, a + 0.45, a + 0.75, b0, b1, y0 + 0.42, 0.05); boxF(B, F, a + 0.58, a + 0.62, b0, b1, y0, 0.42);
      wall(F.at(a + 0.25, b0), F.at(a + 0.25, b1), y0, y0 + 0.85);
    }
    label(k, F, (g1[0] + g1[1]) / 2, CD - 0.13, y0 + 2.45, 'H' + name);
    // desk tops (and the teacher's desk) where something can be left behind: js/lost-core.js
    for (let a = a0 + 3.0, row = 0; a < a1 - 0.9; a += 1.3, row++) for (const [b0, b1] of [[CD + 1.2, mid - 0.7], [mid + 0.7, D - 0.9]]) {
      const [x, z] = F.at(a, (b0 + b1) / 2 + ((row % 3) - 1) * 0.6);
      out.lostSpots.push({ x, z, y: y0 + 0.77, ang: F.ang, room: 'H' + name, k });
    }
    { const [x, z] = F.at(a0 + 1.65, mid + 0.35); out.lostSpots.push({ x, z, y: y0 + 0.78, ang: F.ang, room: 'H' + name, k, teacher: true }); }
  }
  /** Closed rooms (WC, store rooms): walls with a shut door and a plate. Collision comes from a solid footprint. */
  function closed(k, F, a0, a1, D, names) {
    const B = lv[k].B, y0 = Y(k), n = names.length, w = (a1 - a0) / n;
    run(k, F, a0, a1, CD, [], y0, FH, C_INNER, false); run(k, F, a0, a1, D, [], y0, FH, C_INNER, false);
    seg(k, F.at(a0, CD), F.at(a0, D), y0, FH, C_INNER, 0.2, false); seg(k, F.at(a1, CD), F.at(a1, D), y0, FH, C_INNER, 0.2, false);
    names.forEach((nm, i) => {
      const s = a0 + w * i;
      if (i) seg(k, F.at(s, CD), F.at(s, D), y0, FH, C_INNER, 0.2, false);
      doorLeaf(k, F, s + w / 2 - 0.47, false); B.color(C_INNER);
      label(k, F, s + w / 2, CD - 0.13, y0 + 2.45, nm);
    });
  }
  const NUM = (k, n) => `${k + 1}0${n}`;
  for (let k = 0; k <= 2; k++) {
    // long wing: 104 103 | passage (ground floor) | 102 101 to the end of the wing; boards at the far end (plan)
    const q = LW_L / 4;
    const lw = k === 0 ? [[0, 11, 4], [11, 22, 3], [25.5, 38, 2], [38, LW_L - 0.05, 1]] : [[0, q, 4], [q, 2 * q, 3], [2 * q, 3 * q, 2], [3 * q, LW_L - 0.05, 1]];
    for (const [a0, a1, n] of lw) classroom(k, LW, a0, a1, LW_D, NUM(k, n), { board: 'end' });
    // short wing: 107 108 to the end of the wing; boards at the junction end
    classroom(k, SW, 0, SW_L / 2, SW_D, NUM(k, 7)); classroom(k, SW, SW_L / 2, SW_L - 0.05, SW_D, NUM(k, 8));
  }
  const RIGHT = ['Phòng nước GV', 'Kho vật tư', 'Kho vật tư', 'Kho vật tư'], LEFT = ['Kho vật tư', 'Kho vật tư', 'Phòng nước GV', 'Phòng nước GV'];
  // centre bar (plan): store / teachers' water room next to each corner tower, a classroom each side of the hall,
  // and a back corridor along the outer side on every floor (rooms have a back door at their far end)
  for (let k = 0; k <= 3; k++) {
    classroom(k, C, UT, hall0, BC, k < 3 ? NUM(k, 5) : '401', { back: true });
    classroom(k, C, hall1, C_L - UT, BC, k < 3 ? NUM(k, 6) : '402', { back: true });
    closed(k, C, 0.02, UT, BC, [RIGHT[k]]);
    closed(k, C, C_L - UT, C_L - 0.02, BC, [LEFT[k]]);
    // WC in each corner tower, its door on the stair landing
    for (const [poly, d0] of WCs) {
      const B = lv[k].B; B.color(C_INNER); B.band(poly, Y(k), Y(k) + FH);
      B.color(C_DOOR); boxF(B, C, d0, d0 + 0.85, JW0 - 0.04, JW0 + 0.04, Y(k), 2.1);
      label(k, C, d0 + 0.42, JW0 - 0.08, Y(k) + 2.4, 'WC');
    }
  }
  out.solids.push(C.rect(0.02, UT, CD, BC), C.rect(C_L - UT, C_L - 0.02, CD, BC), ...WCs.map(([p]) => p));

  // ---------- stairs: dog-leg, flight A up along +b, landing, flight B back to the next floor ----------
  function flight(k, F, a0, a1, bS, bE, yS, yE, rail) {
    const B = lv[k].B, n = 10, L = Math.abs(bE - bS), d = Math.sign(bE - bS), tr = L / n;
    for (let i = 0; i < n; i++) {
      const bc = bS + d * (i + 0.5) * tr, top = yS + ((yE - yS) * (i + 1)) / n;
      B.color(i % 2 ? C_STAIR : C_STAIR2); boxF(B, F, a0, a1, bc - tr / 2, bc + tr / 2, top - 0.17, 0.17);
    }
    // sloped underside
    const p0 = F.at(a0, bS), p1 = F.at(a1, bS), p2 = F.at(a1, bE), p3 = F.at(a0, bE);
    B.color(0xe2ddd3); B.quad([p0[0], yS - 0.2, p0[1]], [p1[0], yS - 0.2, p1[1]], [p2[0], yE - 0.25, p2[1]], [p3[0], yE - 0.25, p3[1]]);
    // handrail on the spine side
    B.color(C_RAIL);
    for (const r of [rail].flat()) {
      for (let i = 0; i <= n; i += 2) { const bc = bS + d * i * tr, top = yS + ((yE - yS) * Math.max(1, i)) / n; boxF(B, F, r - 0.03, r + 0.03, bc - 0.03, bc + 0.03, top, 0.9); }
      const a = F.at(r, bS), c = F.at(r, bE); B.quad([a[0], yS + 0.92, a[1]], [c[0], yE + 0.92, c[1]], [c[0], yE + 0.98, c[1]], [a[0], yS + 0.98, a[1]]);
    }
    out.surfaces.push({ pts: F.rect(a0, a1, Math.min(bS, bE), Math.max(bS, bE)), ramp: { o: F.at(a0, bS), u: d > 0 ? F.w : [-F.w[0], -F.w[1]], len: L, y0: yS, y1: yE, steps: n } });
  }
  function dogLeg(F, ua, ub, b0, R, b2, walls) {
    const um = (ua + ub) / 2, half = FH / 2;
    for (let k = 0; k < 3; k++) {
      const y = Y(k), B = lv[k].B;
      flight(k, F, ua, um - 0.06, b0, b0 + R, y, y + half, um - 0.1);
      B.color(C_STAIR2); boxF(B, F, ua, ub, b0 + R, b2, y + half - 0.2, 0.2);
      out.surfaces.push({ pts: F.rect(ua, ub, b0 + R, b2), y: y + half });
      flight(k, F, um + 0.06, ub, b0 + R, b0, y + half, y + FH, um + 0.1);
    }
    for (let k = 0; k <= 3; k++) { // low wall along the spine on every floor
      lv[k].B.color(0xe2ddd3); boxF(lv[k].B, F, um - 0.06, um + 0.06, b0, b0 + R, Y(k) - (k ? FH / 2 : 0), k ? FH / 2 + 0.3 : 0.3);
      if (walls) { seg(k, F.at(ua, b0), F.at(ua, b2 + 0.1), Y(k), FH, C_INNER); seg(k, F.at(ub, b0), F.at(ub, b2 + 0.1), Y(k), FH, C_INNER); seg(k, F.at(ua, b2 + 0.1), F.at(ub, b2 + 0.1), Y(k), FH, C_INNER); }
    }
    wall(F.at(um, b0), F.at(um, b0 + R), Y(0) - 1, Y(3) + 1.2);
    // top floor: railing across the flight that would go further up
    const B = lv[3].B; B.color(C_RAIL);
    boxF(B, F, ua, um, b0 - 0.03, b0 + 0.03, Y(3) + 0.92, 0.06);
    for (let a = ua + 0.1; a < um; a += 0.5) boxF(B, F, a - 0.02, a + 0.02, b0 - 0.02, b0 + 0.02, Y(3), 0.95);
    wall(F.at(ua, b0), F.at(um, b0), Y(3), Y(3) + 1.0);
  }
  /**
   * Main stairs (as in the hall on the 2nd floor): one wide flight in the middle goes up from the floor to the
   * landing under the back windows, two narrower flights on both sides come back from the landing to the next floor.
   * So on every floor you arrive on either side and carry on up the middle.
   */
  function splitStair(F, ua, ub, b0, R, b2) {
    const half = FH / 2, sw = (ub - ua) * 0.28, s0 = ua + sw, s1 = ub - sw; // side flights [ua, s0] and [s1, ub]
    for (let k = 0; k < 3; k++) {
      // ground floor: the landing sits higher (2.3 m) so you can walk under it and the side flights, through the
      // hall to the back door
      const y = Y(k), B = lv[k].B, hA = k === 0 ? 2.3 : half;
      flight(k, F, s0 + 0.08, s1 - 0.08, b0, b0 + R, y, y + hA, [s0 + 0.12, s1 - 0.12]);
      B.color(C_STAIR2); boxF(B, F, ua, ub, b0 + R, b2, y + hA - 0.2, 0.2);
      out.surfaces.push({ pts: F.rect(ua, ub, b0 + R, b2), y: y + hA });
      flight(k, F, ua, s0 - 0.08, b0 + R, b0, y + hA, y + FH, s0 - 0.12);
      flight(k, F, s1 + 0.08, ub, b0 + R, b0, y + hA, y + FH, s1 + 0.12);
    }
    for (let k = 0; k <= 3; k++) for (const sp of [s0, s1]) { // low walls between the middle and the side flights
      lv[k].B.color(0xe2ddd3); boxF(lv[k].B, F, sp - 0.08, sp + 0.08, b0, b0 + R, Y(k) - (k ? FH / 2 : 0), k ? FH / 2 + 0.3 : 0.3);
    }
    for (const sp of [s0, s1]) wall(F.at(sp, b0), F.at(sp, b0 + R), Y(0) - 1, Y(3) + 1.2);
    // back corridor runs behind the stairs: railing along the well on floors 2-4, and along the back of each landing
    for (let k = 0; k <= 3; k++) {
      const Bk = lv[k].B, hA = k === 0 ? 2.3 : half;
      if (k > 0) {
        Bk.color(C_RAIL); boxF(Bk, F, ua, ub, b2 + 0.02, b2 + 0.08, Y(k) + 0.92, 0.06);
        for (let a = ua + 0.1; a < ub; a += 0.5) boxF(Bk, F, a - 0.02, a + 0.02, b2 + 0.03, b2 + 0.07, Y(k), 0.95);
        wall(F.at(ua, b2 + 0.05), F.at(ub, b2 + 0.05), Y(k), Y(k) + 1.0);
      }
      if (k < 3) {
        Bk.color(C_RAIL); boxF(Bk, F, ua, ub, b2 - 0.08, b2 - 0.02, Y(k) + hA + 0.92, 0.06);
        wall(F.at(ua, b2 - 0.05), F.at(ub, b2 - 0.05), Y(k) + hA - 0.1, Y(k) + hA + 1.1);
      }
    }
    // top floor: railing across the middle flight (nothing further up)
    const B = lv[3].B; B.color(C_RAIL);
    boxF(B, F, s0, s1, b0 - 0.03, b0 + 0.03, Y(3) + 0.92, 0.06);
    for (let a = s0 + 0.1; a < s1; a += 0.5) boxF(B, F, a - 0.02, a + 0.02, b0 - 0.02, b0 + 0.02, Y(3), 0.95);
    wall(F.at(s0, b0), F.at(s1, b0), Y(3), Y(3) + 1.0);
  }
  splitStair(C, hall0 + 0.1, hall1 - 0.1, 4.6, 4.0, BC - 0.05);    // main stairs behind the entrance
  dogLeg(C, J1u[0], J1u[1], JW0, 3.6, JW1, true);                  // corner tower by 104/105
  dogLeg(C, J2u[0], J2u[1], JW0, 3.6, JW1, true);                  // corner tower by 106/107

  // ---------- roofs: wings (3 floors, pale green sheet), centre + towers (4 floors, red tile) ----------
  function roof(B, pts, y, color, insets) {
    const eave = offsetPoly(pts, 0.5) || pts;
    let top = null, dIn = 0;
    for (const d of insets) { top = offsetPoly(pts, -d); if (top) { dIn = d; break; } }
    B.color(C_TILE_D); B.band(eave, y - 0.2, y);
    B.color(C_CEIL); B.cap(pts, y - 0.22);
    B.color(color);
    if (!top) { B.cap(eave, y); return; }
    const rise = (dIn + 0.5) * 0.42;
    for (let i = 0; i < eave.length; i++) {
      const j = (i + 1) % eave.length;
      B.quad([eave[i][0], y, eave[i][1]], [eave[j][0], y, eave[j][1]], [top[j][0], y + rise, top[j][1]], [top[i][0], y + rise, top[i][1]]);
    }
    B.cap(top, y + rise);
  }
  roof(lv[3].B, LW.rect(0, LW_L, 0, LW_D), Y(3), C_ROOF_W, [LW_D / 2 - 0.05, 5, 4]);
  roof(lv[3].B, SW.rect(0, SW_L, 0, SW_D), Y(3), C_ROOF_W, [SW_D / 2 - 0.05, 5, 4]);
  roof(lv[4].B, F4, Y(4), C_TILE, [3.2, 2.6, 2.0, 1.5, 1.0, 0.6]);

  // ---------- meshes ----------
  const meshes = [];
  lv.forEach((L, k) => {
    if (L.B.tris) {
      const m = fadeable(L.B.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.userData.building = b; L.group.add(m); meshes.push(m);
    }
    if (L.G.tris) {
      const g = L.G.mesh({ transparent: true, opacity: 0.3, depthWrite: false }); g.castShadow = false; g.renderOrder = 3;
      L.group.add(g);
    }
    group.add(L.group);
  });
  let shown = -1;
  return {
    group, meshes, indoor: Pm,
    /** Is (x, z, y) on a floor hidden right now (you stand inside on a lower floor)? */
    hides: (x, z, y) => shown >= 0 && shown < 9 && y > Y(shown) + FH - 0.5 && insideP(Pm, x, z),
    /** While inside (third person), hide the floors above the one you stand on and the roofs over them. */
    update(st) {
      const inside = st && st.on && !st.fp && insideP(Pm, st.x, st.z);
      const lev = inside ? THREE.MathUtils.clamp(Math.floor((st.y - PL + 0.8) / FH), 0, 3) : 9;
      if (lev === shown) return;
      shown = lev;
      lv.forEach((L, k) => { L.group.visible = k <= lev; });
    },
  };
}
