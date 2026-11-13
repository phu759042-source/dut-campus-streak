// Stadium: standard 400 m running track (6 lanes) around the football pitch, pitch lines drawn on a
// turf texture, full-size goals with nets and corner flags, and stands (khán đài) along both long sides.
// OSM only has the pitch rectangle, so the track and the stands are generated around it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Returns { group, outer, posts, surfaces, walls, clear, seatAt, randomSeat }:
 * outer / clear = areas to keep trees and lamps off, posts = goal posts and flags for collisions,
 * surfaces / walls = the stand rows you can walk on and the railings around them (for walk mode),
 * seatAt(x, z) = the seat at a spot on the stands (or null), randomSeat() = a free-ish seat with a good view.
 */
export function buildStadium(pitchPts) {
  const group = new THREE.Group();
  // pitch frame from the rectangle: u along the long side, v across
  let iL = 0, best = 0;
  for (let i = 0; i < pitchPts.length; i++) {
    const a = pitchPts[i], b = pitchPts[(i + 1) % pitchPts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; iL = i; }
  }
  const a = pitchPts[iL], b = pitchPts[(iL + 1) % pitchPts.length];
  const ux = (b[0] - a[0]) / best, uz = (b[1] - a[1]) / best, vx = -uz, vz = ux;
  const cx = pitchPts.reduce((s, p) => s + p[0], 0) / pitchPts.length, cz = pitchPts.reduce((s, p) => s + p[1], 0) / pitchPts.length;
  const PL = best;
  let PW = 0;
  for (const p of pitchPts) PW = Math.max(PW, Math.abs((p[0] - cx) * vx + (p[1] - cz) * vz) * 2);
  const W = (x, y) => [cx + ux * x + vx * y, cz + uz * x + vz * y];
  const place = (geo, y) => { // shape coords (x along the pitch, y across) -> world, at height y
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const [wx, wz] = W(pos.getX(i), pos.getY(i)); pos.setXYZ(i, wx, y + pos.getZ(i), wz); }
    geo.computeVertexNormals();
    return geo;
  };

  // ---- running track ----
  const S = 84.39, R = 36.5, LANE = 1.22, N = 6, RO = R + LANE * N;
  const capsule = (r) => {
    const sh = new THREE.Shape();
    sh.moveTo(-S / 2, -r); sh.lineTo(S / 2, -r); sh.absarc(S / 2, 0, r, -Math.PI / 2, Math.PI / 2, false);
    sh.lineTo(-S / 2, r); sh.absarc(-S / 2, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    return sh;
  };
  // Everything flat lies at y = 0 like the rest of the ground (see map3d.js): drawn in this order, no depth writes.
  let order = -100;
  const flat = (shape, color) => {
    const m = new THREE.Mesh(place(new THREE.ShapeGeometry(shape, 48), 0), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, depthWrite: false }));
    m.receiveShadow = true; m.renderOrder = order++; group.add(m); return m;
  };
  const ring = (r0, r1, color) => { const sh = capsule(r1); sh.holes.push(capsule(r0)); return flat(sh, color); };
  flat(capsule(R), 0xa9ae7c);                        // infield (worn grass / dirt)
  ring(R, RO, 0xb8643f);                             // track surface
  for (let k = 0; k <= N; k++) ring(R + k * LANE - 0.03, R + k * LANE + 0.03, 0xf4efe8); // lane lines
  ring(RO, RO + 0.35, 0xd9d4ca);                     // kerb
  { // finish line across the lanes
    const sh = new THREE.Shape();
    sh.moveTo(S / 2 - 12, -RO); sh.lineTo(S / 2 - 11.9, -RO); sh.lineTo(S / 2 - 11.9, -R); sh.lineTo(S / 2 - 12, -R);
    flat(sh, 0xffffff);
  }

  // ---- turf with mowing stripes and FIFA-size lines ----
  const T = 2048, sx = T / PL, TH = Math.round(PW * sx);
  const c = document.createElement('canvas'); c.width = T; c.height = TH;
  const g = c.getContext('2d');
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#4f9a45' : '#58a64d'; g.fillRect((T / 12) * i, 0, T / 12 + 1, TH); }
  g.strokeStyle = '#f7f7f2'; g.fillStyle = '#f7f7f2'; g.lineWidth = Math.max(3, 0.12 * sx);
  const m2 = (x) => x * sx, X = (x) => T / 2 + x * sx, Y = (y) => TH / 2 + y * sx;
  const hl = PL / 2 - 1.2, hw = PW / 2 - 1.2; // lines a little inside the OSM outline
  g.strokeRect(X(-hl), Y(-hw), m2(hl * 2), m2(hw * 2));
  g.beginPath(); g.moveTo(X(0), Y(-hw)); g.lineTo(X(0), Y(hw)); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), m2(9.15), 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), m2(0.3), 0, Math.PI * 2); g.fill();
  for (const sd of [-1, 1]) {
    const gx = sd * hl;
    g.strokeRect(Math.min(X(gx), X(gx - sd * 16.5)), Y(-20.16), m2(16.5), m2(40.32));   // penalty area
    g.strokeRect(Math.min(X(gx), X(gx - sd * 5.5)), Y(-9.16), m2(5.5), m2(18.32));      // goal area
    g.beginPath(); g.arc(X(gx - sd * 11), Y(0), m2(0.25), 0, Math.PI * 2); g.fill();     // penalty spot
    const mid = sd > 0 ? Math.PI : 0;                                                    // the "D"
    g.beginPath(); g.arc(X(gx - sd * 11), Y(0), m2(9.15), mid - 0.93, mid + 0.93); g.stroke();
    for (const sy of [-1, 1]) {                                                           // corner arcs
      const ang = Math.atan2(-sy, -sd);
      g.beginPath(); g.arc(X(gx), Y(sy * hw), m2(1), ang - Math.PI / 4, ang + Math.PI / 4); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const turf = new THREE.Mesh(place(new THREE.PlaneGeometry(PL, PW), 0), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, depthWrite: false }));
  turf.receiveShadow = true; turf.renderOrder = order++; group.add(turf);

  // ---- goals (posts, crossbar, back frame, nets) and corner flags ----
  const posts = [];
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const netMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const bar = (x0, y0, h0, x1, y1, h1, r = 0.06) => {
    const [ax, az] = W(x0, y0), [bx, bz] = W(x1, y1);
    const A = new THREE.Vector3(ax, h0, az), Bv = new THREE.Vector3(bx, h1, bz);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(Bv), 8), white);
    m.position.copy(A).add(Bv).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
    m.castShadow = true; group.add(m);
  };
  const quad = (p0, p1, p2, p3) => {
    const P = [p0, p1, p2, p3].map(([x, y, h]) => { const [wx, wz] = W(x, y); return [wx, h, wz]; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, netMat); m.renderOrder = 2; group.add(m);
  };
  const GW = 7.32 / 2, GH = 2.44, GD = 1.9;
  for (const sd of [-1, 1]) {
    const gx = sd * hl, bx = gx + sd * GD;
    bar(gx, -GW, 0, gx, -GW, GH); bar(gx, GW, 0, gx, GW, GH); bar(gx, -GW, GH, gx, GW, GH);
    bar(bx, -GW, 0, bx, -GW, GH * 0.85, 0.035); bar(bx, GW, 0, bx, GW, GH * 0.85, 0.035);
    bar(gx, -GW, GH, bx, -GW, GH * 0.85, 0.035); bar(gx, GW, GH, bx, GW, GH * 0.85, 0.035); bar(bx, -GW, GH * 0.85, bx, GW, GH * 0.85, 0.035);
    quad([bx, -GW, 0], [bx, GW, 0], [bx, GW, GH * 0.85], [bx, -GW, GH * 0.85]);           // back net
    quad([gx, -GW, GH], [gx, GW, GH], [bx, GW, GH * 0.85], [bx, -GW, GH * 0.85]);         // roof net
    for (const sy of [-1, 1]) quad([gx, sy * GW, 0], [bx, sy * GW, 0], [bx, sy * GW, GH * 0.85], [gx, sy * GW, GH]); // side nets
    for (const sy of [-1, 1]) { const p = W(gx, sy * GW); posts.push([p[0], p[1], 0.1]); const q = W(bx, sy * GW); posts.push([q[0], q[1], 0.06]); }
    for (const sy of [-1, 1]) {                                                           // corner flags
      const fx = sd * hl, fy = sy * hw;
      bar(fx, fy, 0, fx, fy, 1.5, 0.025);
      const [wx, wz] = W(fx, fy);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshLambertMaterial({ color: 0xf5c518, side: THREE.DoubleSide }));
      flag.position.set(wx + ux * 0.23, 1.35, wz + uz * 0.23); flag.rotation.y = Math.atan2(vx, vz); group.add(flag);
      posts.push([wx, wz, 0.05]);
    }
  }
  // ---- stands: 7 stepped rows of seats along both straights, outside the track ----
  const SL = 33, ROWS = 7, RD = 0.85, RH = 0.42, V0 = RO + 1.9, VB = V0 + ROWS * RD, RAIL = 0.95;
  const SEAT = 0.62, perRow = Math.floor((2 * SL - 0.4) / SEAT);
  const toFrame = (geo) => { // geometry built with x = along the pitch, y = up, z = across -> world
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const [wx, wz] = W(pos.getX(i), pos.getZ(i)); pos.setXYZ(i, wx, pos.getY(i), wz); }
    geo.computeVertexNormals();
    return geo;
  };
  const profile = (pts) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]); return sh; };
  /** Extrudes a (distance from the centre line, height) profile along the pitch from u0 to u1 on side sd. */
  const extrude = (pts, sd, u0, u1) => {
    const geo = new THREE.ExtrudeGeometry(profile(pts), { depth: u1 - u0, bevelEnabled: false });
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, u0 + pos.getZ(i), pos.getY(i), sd * pos.getX(i));
    geo.deleteAttribute('uv');
    return toFrame(geo);
  };
  const box = (w, h, d, u, y, v) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(u, y, v); g.deleteAttribute('uv'); return toFrame(g); };
  const standGeos = [], railGeos = [], surfaces = [], walls = [], clear = [], seats = [];
  const seatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.13, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), perRow * ROWS * 2);
  const backMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.34, 0.06), new THREE.MeshLambertMaterial({ color: 0xffffff }), perRow * ROWS * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-uz, ux)), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  for (const sd of [-1, 1]) {
    const steps = [[V0, 0]];
    for (let k = 0; k < ROWS; k++) steps.push([V0 + k * RD, (k + 1) * RH], [V0 + (k + 1) * RD, (k + 1) * RH]);
    steps.push([VB, 0]);
    standGeos.push(extrude(steps, sd, -SL, SL));
    // railings: back wall and both ends (sloped along the rows)
    const end = [[V0, 0], [V0, RH + RAIL], [VB, ROWS * RH + RAIL], [VB, 0]];
    railGeos.push(extrude(end, sd, -SL - 0.18, -SL), extrude(end, sd, SL, SL + 0.18));
    railGeos.push(box(2 * SL + 0.36, ROWS * RH + RAIL, 0.18, 0, (ROWS * RH + RAIL) / 2, sd * (VB + 0.09)));
    walls.push({ a: W(-SL, sd * VB), b: W(SL, sd * VB), y0: -9, y1: 99 });
    for (const e of [-SL, SL]) walls.push({ a: W(e, sd * V0), b: W(e, sd * VB), y0: -9, y1: 99 });
    clear.push([W(-SL - 1, sd * (V0 - 0.5)), W(SL + 1, sd * (V0 - 0.5)), W(SL + 1, sd * (VB + 1)), W(-SL - 1, sd * (VB + 1))]);
    // facing the pitch
    const heading = Math.atan2(-sd * vx, -sd * vz);
    for (let k = 0; k < ROWS; k++) {
      const v0 = V0 + k * RD, y = (k + 1) * RH;
      surfaces.push({ pts: [W(-SL, sd * v0), W(SL, sd * v0), W(SL, sd * (v0 + RD)), W(-SL, sd * (v0 + RD))], y });
      for (let j = 0; j < perRow; j++) {
        const u = -SL + 0.2 + SEAT / 2 + j * SEAT;
        const [x, z] = W(u, sd * (v0 + 0.32));
        seats.push({ x, z, y, heading, row: k, u });
        at.set(x, y + 0.065, z); m4.compose(at, q, one); seatMesh.setMatrixAt(n, m4);
        const [bx, bz] = W(u, sd * (v0 + 0.55));
        at.set(bx, y + 0.26, bz); m4.compose(at, q, one); backMesh.setMatrixAt(n, m4);
        // blue seats on one side, orange on the other, rows in two shades
        col.setHex(sd > 0 ? (k % 2 ? 0x2f6bff : 0x2459d6) : (k % 2 ? 0xf97316 : 0xe0620c));
        seatMesh.setColorAt(n, col); backMesh.setColorAt(n, col);
        n++;
      }
    }
  }
  const stand = new THREE.Mesh(mergeGeometries(standGeos), new THREE.MeshLambertMaterial({ color: 0xd6d1c6, side: THREE.DoubleSide }));
  stand.castShadow = stand.receiveShadow = true;
  const rails = new THREE.Mesh(mergeGeometries(railGeos), new THREE.MeshLambertMaterial({ color: 0xa7adb7, side: THREE.DoubleSide }));
  rails.castShadow = true;
  for (const m of [seatMesh, backMesh]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.castShadow = true; m.computeBoundingSphere(); }
  group.add(stand, rails, seatMesh, backMesh);

  const local = (x, z) => { const dx = x - cx, dz = z - cz; return [dx * ux + dz * uz, dx * vx + dz * vz]; };
  /** The seat at (x, z) on the stands, or null when not on them. */
  function seatAt(x, z) {
    const [u, v] = local(x, z), av = Math.abs(v);
    const k = Math.floor((av - V0) / RD);
    if (k < 0 || k >= ROWS || Math.abs(u) > SL) return null;
    const j = Math.max(0, Math.min(perRow - 1, Math.round((u + SL - 0.2 - SEAT / 2) / SEAT)));
    return seats[(v > 0 ? perRow * ROWS : 0) + k * perRow + j];
  }
  /** A seat with a good view (middle rows, near the halfway line), picked at random. */
  function randomSeat() {
    const good = seats.filter((s) => s.row >= 1 && s.row <= 5 && Math.abs(s.u) < 22);
    return good[Math.floor(Math.random() * good.length)];
  }

  const outer = capsule(RO + 1).getPoints(24).map((p) => W(p.x, p.y));
  return { group, outer, posts, surfaces, walls, clear, seatAt, randomSeat };
}
