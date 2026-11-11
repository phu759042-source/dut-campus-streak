// Stadium: standard 400 m running track (6 lanes) around the football pitch, pitch lines drawn on a
// turf texture, full-size goals with nets and corner flags. OSM only has the pitch rectangle, so the track
// is generated around it (the satellite photo shows a track ring around the pitch).
import * as THREE from 'three';

/** Returns { group, outer, posts }: outer = polygon to keep trees/lamps off, posts = goal posts and flags for collisions. */
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
  const flat = (shape, y, color) => {
    const m = new THREE.Mesh(place(new THREE.ShapeGeometry(shape, 48), y), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    m.receiveShadow = true; group.add(m); return m;
  };
  const ring = (r0, r1, y, color) => { const sh = capsule(r1); sh.holes.push(capsule(r0)); return flat(sh, y, color); };
  flat(capsule(R), 0.17, 0xa9ae7c);                 // infield (worn grass / dirt)
  ring(R, RO, 0.18, 0xb8643f);                       // track surface
  for (let k = 0; k <= N; k++) ring(R + k * LANE - 0.03, R + k * LANE + 0.03, 0.19, 0xf4efe8); // lane lines
  ring(RO, RO + 0.35, 0.2, 0xd9d4ca);                // kerb
  { // finish line across the lanes
    const sh = new THREE.Shape();
    sh.moveTo(S / 2 - 12, -RO); sh.lineTo(S / 2 - 11.9, -RO); sh.lineTo(S / 2 - 11.9, -R); sh.lineTo(S / 2 - 12, -R);
    flat(sh, 0.195, 0xffffff);
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
  const turf = new THREE.Mesh(place(new THREE.PlaneGeometry(PL, PW), 0.23), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  turf.receiveShadow = true; group.add(turf);

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
  const outer = capsule(RO + 1).getPoints(24).map((p) => W(p.x, p.y));
  return { group, outer, posts };
}
