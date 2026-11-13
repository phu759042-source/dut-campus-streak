// Ngô Sĩ Liên railway overpass (cầu vượt đường sắt Ngô Sĩ Liên, Km 784+425 of the North–South line, opened
// 27-10-2013) and what is around it: approach ramps on retaining walls, 7 spans of 20 m on six wall piers,
// footways and railings (11 m wide in all: 7 m carriageway + 2 x 1.5 m footways + 2 x 0.5 m railings), street
// lamps on the deck, the single-track railway under span 5, the open space under the deck where students
// rehearse, the no-entry signs at the mouth of the left service lane and the name plates at both ends.
// The axis, the deck profile and the span positions come from data.bridge (dev/build_campus.py).
// Besides the meshes it returns what walk mode needs: sloped walkable surfaces, railings / retaining walls with
// a height range, round obstacles (piers, sign posts), areas to keep trees and lamps off, ground layers to
// paint, and the meshes that fade out when they stand between the camera and the student.
import * as THREE from 'three';
import { Builder } from './campus-details.js';

const HALF = 5.5;    // half the deck (11 m)
const ROAD = 3.5;    // half the carriageway (7 m)
const WALK = 5.0;    // footway from ROAD to here, then the railing strip
const KERB = 0.2;    // footway above the carriageway
const DEPTH = 1.15;  // slab girders + deck
const PAR = 0.45;    // concrete upstand above the footway
const RAIL = 1.05;   // top of the steel rail above the footway
const EDGE = 0.2;    // thickness of the deck edge (cantilever) under the footway
const C = {
  kerb: 0xbfbbb2, foot: 0xd9d3c6, parapet: 0xe6e2d9, fascia: 0xd2cec4, girder: 0xbdb9b0, soffit: 0xa9a59d,
  wallA: 0xdcd8ce, wallB: 0xd0ccc2, abut: 0xc9c5bb, pier: 0xd3d0c8, cap: 0xdddad2, plinth: 0xb9b5ac,
  steel: 0x8f98a3, pole: 0x6f7883, stone: 0xcbc5b8, bench: 0xc7c2b7, speaker: 0x2b2e34, rail: 0x5b5f66, sleeper: 0x8b867d,
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildBridge(data, { mobile = false } = {}) {
  const b = data.bridge;
  const [ax, az] = b.a, [bx, bz] = b.b;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;   // u along the bridge, n to its right
  const P = (s, t) => [ax + ux * s + nx * t, az + uz * s + nz * t];
  const V = (s, t, y) => [ax + ux * s + nx * t, y, az + uz * s + nz * t];
  const angU = Math.atan2(uz, ux), angN = Math.atan2(nz, nx);
  const prof = b.profile, spans = b.spans;
  const S0 = prof[0][0], S1 = prof[prof.length - 1][0], M1 = spans[0], M2 = spans[spans.length - 1];
  /** Height of the carriageway at s (0 before and after the ramps). */
  const hAt = (s) => {
    if (s <= S0 || s >= S1) return 0;
    let i = 0;
    while (i < prof.length - 2 && s > prof[i + 1][0]) i++;
    const [s0, h0] = prof[i], [s1, h1] = prof[i + 1];
    return h0 + (h1 - h0) * (s - s0) / (s1 - s0);
  };
  const onSpans = (s0, s1) => s0 >= M1 - 1e-6 && s1 <= M2 + 1e-6;

  // pieces along the bridge: every profile point and span joint, ramps in 3 m wall panels, spans in 5 m pieces
  const base = [...new Set([...prof.map((p) => p[0]), ...spans, S0 + 2.4, S1 - 2.4])].sort((p, q) => p - q);
  const cuts = [];
  for (let i = 0; i < base.length - 1; i++) {
    const s0 = base[i], s1 = base[i + 1], n = Math.max(1, Math.ceil((s1 - s0 - 1e-6) / (onSpans(s0, s1) ? 5 : 3)));
    for (let k = 0; k < n; k++) cuts.push(s0 + ((s1 - s0) * k) / n);
  }
  cuts.push(S1);

  const group = new THREE.Group();
  const structMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const topMat = new THREE.MeshLambertMaterial({ color: 0xb7bfcc, side: THREE.DoubleSide });
  const markMat = new THREE.MeshLambertMaterial({ color: 0xf4f2ea, side: THREE.DoubleSide });
  const extraMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshLambertMaterial({ color: 0xf6f1e3, emissive: 0xffd27a, emissiveIntensity: 0 });
  const UP = [0, 0, 1], DOWN = [0, 0, -1];
  /** Is the face (a, b, c) wound so that its normal points along `out` = [along, right, up]? */
  const faces = (a, b, c, out) => {
    const e1 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], e2 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    return n[0] * (ux * out[0] + nx * out[1]) + n[1] * out[2] + n[2] * (uz * out[0] + nz * out[1]) >= 0;
  };
  /** Quad through four [s, t, y] corners; its normal points along `out` (shadows are biased along the normal). */
  const quad = (B, c1, c2, c3, c4, out = UP) => {
    const a = V(...c1), b2 = V(...c2), c = V(...c3), d = V(...c4);
    if (faces(a, b2, c, out)) B.quad(a, b2, c, d); else B.quad(d, c, b2, a);
  };
  const tri = (B, c1, c2, c3, out) => {
    const a = V(...c1), b2 = V(...c2), c = V(...c3);
    if (faces(a, b2, c, out)) B.tri(a, b2, c); else B.tri(c, b2, a);
  };
  /** Thin beam of w x hh between (s0, t, y0) and (s1, t, y1) (y = its top). */
  const beam = (B, s0, y0, s1, y1, t, w, hh) => {
    const a = t - w / 2, c = t + w / 2;
    quad(B, [s0, a, y0], [s1, a, y1], [s1, c, y1], [s0, c, y0]);
    quad(B, [s0, a, y0 - hh], [s1, a, y1 - hh], [s1, c, y1 - hh], [s0, c, y0 - hh], DOWN);
    quad(B, [s0, a, y0 - hh], [s1, a, y1 - hh], [s1, a, y1], [s0, a, y0], [0, -1, 0]);
    quad(B, [s0, c, y0 - hh], [s1, c, y1 - hh], [s1, c, y1], [s0, c, y0], [0, 1, 0]);
  };

  // ---- deck, ramps, piers: built in chunks so each one fades on its own when it hides the student ----
  const chunkEnds = [M1, spans[2], spans[4], spans[6], S1];
  const occluders = [];
  const E = new Builder();   // steel railings, lamp posts, sign posts, benches, rails: never fade
  const G = new Builder();   // lamp heads and the lights under the deck (glow at night)
  let from = S0, panel = 0;
  for (const to of chunkEnds) {
    const S = new Builder(), T = new Builder(), M = new Builder();
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i], s1 = cuts[i + 1];
      if (s0 < from - 1e-6 || s1 > to + 1e-6) continue;
      const h0 = hAt(s0), h1 = hAt(s1), span = onSpans(s0, s1);
      quad(T, [s0, -ROAD, h0], [s1, -ROAD, h1], [s1, ROAD, h1], [s0, ROAD, h0]);
      M.color(0xffffff);
      for (const t of [-(ROAD - 0.3), ROAD - 0.3]) quad(M, [s0, t - 0.06, h0 + 0.02], [s1, t - 0.06, h1 + 0.02], [s1, t + 0.06, h1 + 0.02], [s0, t + 0.06, h0 + 0.02]);
      panel++;
      for (const g of [-1, 1]) {
        const f0 = h0 + KERB, f1 = h1 + KERB, p0 = f0 + PAR, p1 = f1 + PAR;
        const outer = [0, g, 0], inner = [0, -g, 0];
        S.color(C.kerb); quad(S, [s0, g * ROAD, h0], [s1, g * ROAD, h1], [s1, g * ROAD, f1], [s0, g * ROAD, f0], inner);
        S.color(C.foot); quad(S, [s0, g * ROAD, f0], [s1, g * ROAD, f1], [s1, g * WALK, f1], [s0, g * WALK, f0]);
        S.color(C.parapet);
        quad(S, [s0, g * WALK, f0], [s1, g * WALK, f1], [s1, g * WALK, p1], [s0, g * WALK, p0], inner);
        quad(S, [s0, g * WALK, p0], [s1, g * WALK, p1], [s1, g * HALF, p1], [s0, g * HALF, p0]);
        // outer face: deck edge, then either the girders (spans) or the retaining wall down to the ground (ramps)
        const e0 = Math.max(0, h0 - EDGE), e1 = Math.max(0, h1 - EDGE);
        S.color(C.fascia); quad(S, [s0, g * HALF, e0], [s1, g * HALF, e1], [s1, g * HALF, p1], [s0, g * HALF, p0], outer);
        if (span) {
          S.color(C.soffit); quad(S, [s0, g * HALF, e0], [s1, g * HALF, e1], [s1, g * WALK, e1], [s0, g * WALK, e0], DOWN);
          S.color(C.girder); quad(S, [s0, g * WALK, h0 - DEPTH], [s1, g * WALK, h1 - DEPTH], [s1, g * WALK, e1], [s0, g * WALK, e0], outer);
        } else if (e0 > 0 || e1 > 0) {
          S.color(panel % 2 ? C.wallA : C.wallB); quad(S, [s0, g * HALF, 0], [s1, g * HALF, 0], [s1, g * HALF, e1], [s0, g * HALF, e0], outer);
        }
        // steel railing: two rails and a post at each end of the piece (and in the middle of long pieces)
        if (s0 >= S0 + 2.4 - 1e-6 && s1 <= S1 - 2.4 + 1e-6) {
          E.color(C.steel);
          beam(E, s0, f0 + RAIL, s1, f1 + RAIL, g * 5.25, 0.08, 0.07);
          beam(E, s0, f0 + 0.76, s1, f1 + 0.76, g * 5.25, 0.05, 0.05);
          const n = s1 - s0 > 2.6 ? 2 : 1;
          for (let k = 0; k < n; k++) { const s = s0 + ((s1 - s0) * k) / n, [x, z] = P(s, g * 5.25); E.box(x, z, 0.08, 0.08, hAt(s) + KERB + PAR, RAIL - PAR, angU); }
        }
      }
      if (span) { S.color(C.soffit); quad(S, [s0, -WALK, h0 - DEPTH], [s1, -WALK, h1 - DEPTH], [s1, WALK, h1 - DEPTH], [s0, WALK, h0 - DEPTH], DOWN); }
    }
    // centre line: 3 m dashes every 9 m
    for (let s = Math.ceil((from + 0.5) / 9) * 9; s + 3 <= to; s += 9) quad(M, [s, -0.075, hAt(s) + 0.02], [s + 3, -0.075, hAt(s + 3) + 0.02], [s + 3, 0.075, hAt(s + 3) + 0.02], [s, 0.075, hAt(s) + 0.02]);
    // abutments: the end of a ramp, with the bearing shelf the girders sit on
    for (const [m, dir] of [[M1, 1], [M2, -1]]) {
      if (!(m > from + 1e-6 && m <= to + 1e-6)) continue;
      const top = hAt(m) - EDGE;
      S.color(C.abut); quad(S, [m, -HALF, 0], [m, HALF, 0], [m, HALF, top], [m, -HALF, top], [dir, 0, 0]);
      const [x, z] = P(m + dir * 0.2, 0);
      S.color(C.plinth); S.box(x, z, 2 * WALK, 0.4, hAt(m) - DEPTH - 0.4, 0.4, angN);
    }
    // piers: wall shaft with round ends on a plinth, hammerhead cap under the girders
    for (const m of spans.slice(1, -1)) {
      if (m <= from || m > to) continue;
      const top = hAt(m) - DEPTH - 0.02, neck = top - 1.15;
      const ring = [];
      for (let k = 0; k <= 6; k++) { const a = (Math.PI * k) / 6; ring.push(P(m + 0.5 * Math.cos(a), 1.9 + 0.5 * Math.sin(a))); }
      for (let k = 0; k <= 6; k++) { const a = Math.PI + (Math.PI * k) / 6; ring.push(P(m + 0.5 * Math.cos(a), -1.9 + 0.5 * Math.sin(a))); }
      // (Builder.band faces the left of each edge: walk the ring clockwise so the shaft faces outwards)
      let area = 0;
      for (let k = 0; k < ring.length; k++) { const p = ring[k], q = ring[(k + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (area > 0) ring.reverse();
      S.color(C.pier); S.band(ring, 0.3, neck + 0.02);
      const [x, z] = P(m, 0);
      S.color(C.plinth); S.box(x, z, 6.0, 1.9, 0, 0.3, angN);
      const cap = [[-5.1, top], [5.1, top], [5.1, top - 0.55], [2.9, neck], [-2.9, neck], [-5.1, top - 0.55]];
      S.color(C.cap);
      for (const d of [-1, 1]) for (let k = 1; k < cap.length - 1; k++) tri(S, [m + d * 0.8, ...cap[0]], [m + d * 0.8, ...cap[k]], [m + d * 0.8, ...cap[k + 1]], [d, 0, 0]);
      for (let k = 0; k < cap.length; k++) { // sides: each faces away from the middle of the cap
        const p = cap[k], q = cap[(k + 1) % cap.length];
        quad(S, [m - 0.8, ...p], [m + 0.8, ...p], [m + 0.8, ...q], [m - 0.8, ...q], [0, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - (top - 0.45)]);
      }
    }
    // name blocks where the railings start (both sides, both ends)
    for (const [s, ok] of [[S0 + 1.2, from === S0], [S1 - 1.2, to === S1]]) {
      if (!ok) continue;
      for (const g of [-1, 1]) { const [x, z] = P(s, g * 5.25); S.color(C.stone); S.box(x, z, 2.4, 0.6, 0, hAt(s) + KERB + 1.2, angU); }
    }
    // one mesh, three materials: structure (vertex colours), asphalt, road markings
    const parts = [S, T, M].filter((x) => x.tris);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((x) => x.pos), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(parts.flatMap((x) => x.col), 3));
    let start = 0;
    for (const x of parts) { geo.addGroup(start, x.pos.length / 3, [S, T, M].indexOf(x)); start += x.pos.length / 3; }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, [structMat, topMat, markMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.building = { poi: 'bridge' };
    group.add(mesh);
    occluders.push(mesh);
    from = to;
  }

  // ---- what walk mode needs ----
  const surfaces = [], walls = [], posts = [];
  const e = 0.02;
  const joints = [...new Set([...prof.map((p) => p[0]), M1, M2])].sort((p, q) => p - q); // straight pieces of the profile
  for (let i = 0; i < joints.length - 1; i++) {
    const s0 = joints[i], s1 = joints[i + 1], y0 = hAt(s0), y1 = hAt(s1);
    // `under`: how far below the surface its underside is (spans only: the camera stays below it, see walk.js)
    const piece = (t0, t1, dy) => ({ pts: [P(s0 - e, t0), P(s1 + e, t0), P(s1 + e, t1), P(s0 - e, t1)],
      ramp: { o: P(s0, 0), u: [ux, uz], len: s1 - s0, y0: y0 + dy, y1: y1 + dy }, ...(onSpans(s0, s1) ? { under: DEPTH + dy + 0.1 } : {}) });
    surfaces.push(piece(-ROAD, ROAD, 0), piece(-HALF, -ROAD, KERB), piece(ROAD, HALF, KERB));
  }
  // railings (and, on the ramps, the retaining walls below them): at most 12 m long so the height range stays tight
  for (let i = 0; i < base.length - 1; i++) {
    const n = Math.max(1, Math.ceil((base[i + 1] - base[i]) / 12));
    for (let k = 0; k < n; k++) {
      const s0 = base[i] + ((base[i + 1] - base[i]) * k) / n, s1 = base[i] + ((base[i + 1] - base[i]) * (k + 1)) / n;
      const lo = Math.min(hAt(s0), hAt(s1)), hi = Math.max(hAt(s0), hAt(s1));
      for (const g of [-1, 1]) walls.push({ a: P(s0, g * 5.3), b: P(s1, g * 5.3), y0: onSpans(s0, s1) ? lo - DEPTH - 0.05 : -1, y1: hi + KERB + RAIL + 0.1 });
    }
  }
  for (const m of [M1, M2]) walls.push({ a: P(m, -HALF), b: P(m, HALF), y0: -1, y1: hAt(m) - 0.3 });
  for (const m of spans.slice(1, -1)) for (const t of [-1.9, -0.95, 0, 0.95, 1.9]) posts.push([...P(m, t), 0.55]);

  // ---- street lamps on the deck (staggered) and lights under the spans of the rehearsal space ----
  for (let k = 0; S0 + 16 + k * 30 < S1 - 6; k++) {
    const s = S0 + 16 + k * 30, g = k % 2 ? 1 : -1, y = hAt(s) + KERB + PAR;
    const [x, z] = P(s, g * 5.25), [mx, mz] = P(s, g * 4.55), [hx, hz] = P(s, g * 3.75);
    E.color(C.pole); E.box(x, z, 0.16, 0.16, y, 8, angN); E.box(mx, mz, 1.5, 0.1, y + 7.9, 0.1, angN);
    G.color(0xffffff); G.box(hx, hz, 0.8, 0.34, y + 7.82, 0.1, angN);
  }
  // ...with a warm pool of light on the ground under each of them at night
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
    map: canvasTex(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    }) });
  const pools = new THREE.Group();
  pools.visible = false;
  for (let i = 1; i <= 3; i++) {
    const s = (spans[i] + spans[i + 1]) / 2;
    for (const t of [-2.6, 2.6]) {
      const [x, z] = P(s, t);
      G.color(0xffffff); G.box(x, z, 0.3, 1.5, hAt(s) - DEPTH - 0.09, 0.08, angN);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), poolMat);
      pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.04, z); pool.renderOrder = 1;
      pools.add(pool);
    }
  }
  group.add(pools);

  // ---- under the deck: concrete benches and a party speaker (students rehearse here) ----
  const plazaEnd = spans[4] + 1.2;
  for (const [s, t] of [[spans[1] + 6, -4.6], [spans[1] + 6, 4.6], [spans[2] + 6, -4.6], [spans[2] + 6, 4.6], [M1 + 1.4, -2.2], [M1 + 1.4, 2.2]]) {
    const along = s > M1 + 2 ? angU : angN, [x, z] = P(s, t);
    E.color(C.bench); E.box(x, z, 1.9, 0.46, 0.38, 0.09, along);
    for (const d of [-0.7, 0.7]) { const [lx, lz] = s > M1 + 2 ? P(s + d, t) : P(s, t + d); E.color(C.plinth); E.box(lx, lz, 0.14, 0.4, 0, 0.38, along); posts.push([lx, lz, 0.32]); }
  }
  {
    const [x, z] = P(spans[3] - 1.6, -3.4);
    E.color(C.speaker); E.box(x, z, 0.44, 0.4, 0, 0.86, angU);
    E.color(0x8f98a3); E.box(x, z, 0.3, 0.04, 0.86, 0.06, angU);
    const [fx, fz] = P(spans[3] - 1.6, -3.19);
    E.color(0x53575e); E.box(fx, fz, 0.3, 0.02, 0.1, 0.3, angU); E.box(fx, fz, 0.2, 0.02, 0.5, 0.2, angU);
    posts.push([x, z, 0.3]);
  }

  // ---- railway: rails on sleepers (the ballast is a ground layer) ----
  const rail = data.rail || [];
  const sleeperAt = [];
  for (let i = 0; i < rail.length - 1; i++) {
    const [x0, z0] = rail[i], [x1, z1] = rail[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, ang = Math.atan2(dz, dx);
    E.color(C.rail);
    for (const g of [-0.5, 0.5]) E.box((x0 + x1) / 2 - dz * g, (z0 + z1) / 2 + dx * g, len + 0.1, 0.07, 0.1, 0.13, ang);
    for (let d = 0.5; d < len; d += mobile ? 1.6 : 1.0) {
      const x = x0 + dx * d, z = z0 + dz * d;
      if (x > -560 && x < 660) sleeperAt.push([x, z, ang]);
    }
  }
  if (sleeperAt.length) {
    const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.1, 2.0), new THREE.MeshLambertMaterial({ color: C.sleeper }), sleeperAt.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    sleeperAt.forEach(([x, z, ang], i) => { q.setFromAxisAngle(up, -ang); m.compose(at.set(x, 0.05, z), q, one); sl.setMatrixAt(i, m); });
    sl.receiveShadow = true;
    group.add(sl);
  }

  // ---- no-entry signs (biển cấm đi ngược chiều) ----
  const noEntry = canvasTex(128, 128, (g) => {
    g.fillStyle = '#d81f26'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 59, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(22, 52, 84, 24);
  });
  const signMat = new THREE.MeshLambertMaterial({ map: noEntry, emissive: 0xffffff, emissiveMap: noEntry, emissiveIntensity: 0.3 });
  const backMat = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  for (const sg of (data.signs || []).filter((x) => x.kind === 'no-entry')) {
    const [x, z] = sg.at, [dx, dz] = sg.dir;
    E.color(C.pole); E.box(x, z, 0.07, 0.07, 0, 2.62, 0);
    for (const [mat, side] of [[signMat, 1], [backMat, -1]]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.36, 28), mat);
      m.position.set(x + dx * 0.045 * side, 2.25, z + dz * 0.045 * side);
      m.rotation.y = Math.atan2(dx * side, dz * side);
      group.add(m);
    }
    posts.push([x, z, 0.1]);
  }

  // ---- name plates on the right-hand block at each end ----
  const plate = canvasTex(512, 160, (g) => {
    g.fillStyle = '#343a44'; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#e9cf8b'; g.lineWidth = 4; g.strokeRect(8, 8, 496, 144);
    g.fillStyle = '#f3dc9c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 44px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText('CẦU VƯỢT NGÔ SĨ LIÊN', 256, 62);
    g.font = '700 21px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText('Km 784+425 · Đường sắt Bắc – Nam · 2013', 256, 114);
  });
  const plateMat = new THREE.MeshLambertMaterial({ map: plate });
  for (const [s, g] of [[S0 + 1.2, 1], [S1 - 1.2, -1]]) {
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.62), plateMat);
      const [x, z] = P(s, g * 5.25 + side * 0.31);
      m.position.set(x, hAt(s) + KERB + 0.72, z);
      m.rotation.y = Math.atan2(nx * side, nz * side);
      group.add(m);
    }
  }

  const extras = new THREE.Mesh(E.geometry(), extraMat);
  extras.castShadow = true;
  group.add(extras);
  if (G.tris) group.add(new THREE.Mesh(G.geometry(), glowMat));

  return {
    group, occluders, surfaces, walls, posts,
    /** keep trees and lamps off the bridge, its ramps and the space under it */
    clear: [[P(-3, -6.7), P(L + 3, -6.7), P(L + 3, 6.7), P(-3, 6.7)]],
    /** flat layers for the map to paint on the ground: the paved space under the deck and the track bed */
    ground: [
      { key: 'plaza', polys: [[P(M1 + 0.5, -5.9), P(plazaEnd, -5.9), P(plazaEnd, 5.9), P(M1 + 0.5, 5.9)]] },
      { key: 'ballast', lines: rail.length > 1 ? [{ pts: rail, w: 3.0 }] : [] },
    ],
    heightAt: hAt,
    setTheme(dark, pal) {
      topMat.color.set(pal.road);
      structMat.color.set(dark ? 0x8d95a8 : 0xffffff);
      extraMat.color.set(dark ? 0x9aa2b4 : 0xffffff);
      markMat.color.set(dark ? 0x9aa3b8 : 0xf4f2ea);
      glowMat.emissiveIntensity = dark ? 1.6 : 0;
      pools.visible = dark;
      for (const m of occluders) if (m.material === m.userData.solidMat || !m.userData.solidMat) m.userData.fadeMat = null; // re-made with the new colours
    },
  };
}
