// Walk-in places for the 3D campus:
//  - Căn tin (canteen) next to Khu E1: doors, dining tables with stools, drinks fridges, a coffee bar,
//    and a kitchen behind a serving counter. Room for a dozen or more students.
//  - Khu E1: open corridors along the front on both floors and a staircase at the end next to the canteen.
//  - Khu H: the whole 4-storey block from its floor plan (see khu-h.js).
// Produces geometry plus what the walker needs: solids (footprints), walls with a height range,
// walkable surfaces (2nd-floor slab, stairs) and meshes that fade/hide when they block the view.
import * as THREE from 'three';
import { Builder, offsetPoly, insideP, FLOOR_H } from './campus-details.js';
import { isKhuH, buildKhuH, khuHOutline } from './khu-h.js';
import { isKhuF, buildKhuF, khuFSplit, khuFFront } from './khu-f.js';

const FLOOR2 = FLOOR_H; // top of the 2nd-floor slab

/** Local frame along a footprint edge: u along the edge (from a to c), v inward (away from the outside). */
function frame(pts, edge) {
  const a = pts[edge], c = pts[(edge + 1) % pts.length];
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
  let wx = -uz, wz = ux; // candidate inward normal
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  if (!insideP(pts, mx + wx * 0.5, mz + wz * 0.5)) { wx = -wx; wz = -wz; }
  const at = (u, v) => [a[0] + ux * u + wx * v, a[1] + uz * u + wz * v];
  const ang = Math.atan2(uz, ux);
  const rect = (u0, u1, v0, v1) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  return { a, c, L, ux, uz, wx, wz, at, ang, rect };
}
const depthOf = (pts, F) => Math.max(...pts.map(([x, z]) => (x - F.a[0]) * F.wx + (z - F.a[1]) * F.wz));

/** Called before the buildings are made: E1 keeps only its rooms as a solid block, the canteen becomes hollow. */
export function prepareInteriors(data) {
  for (const b of data.buildings) {
    if (b.interior === 'canteen') b.hollow = true;
    if (isKhuF(b) && !b.fullPts) { // the long block stays a normal building; the hall wing and the square: khu-f.js
      b.fullPts = b.pts; b.pts = khuFSplit(b.pts).spine;
      b.style = { wall: 'corridor', roof: 'hip', roofColor: 0xc5ccd2 }; // open corridors, light grey metal roof
      b.khuF = true; b.front = khuFFront(b.fullPts);
    }
    if (isKhuH(b) && !b.osmPts) { // walk-in from its floor plan; the short wing is rebuilt (see khu-h.js layout())
      b.osmPts = b.pts; b.pts = khuHOutline(b.pts);
      b.interior = 'khuH'; b.hollow = true; b.entrance_edge ??= 3; // main entrance under the glass bay
    }
    if (b.corridor && !b.roofPts) {
      const F = frame(b.pts, b.corridor.edge);
      const d = b.corridor.depth;
      b.roofPts = b.pts.map((p) => [...p]);
      const i = b.corridor.edge, j = (i + 1) % b.pts.length;
      b.pts = b.pts.map((p, k) => (k === i || k === j ? [p[0] + F.wx * d, p[1] + F.wz * d] : p));
    }
  }
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const fadeable = (geo, mat) => {
  geo.clearGroups(); geo.addGroup(0, geo.getAttribute('position').count, 0); // material array needs a group
  const m = new THREE.Mesh(geo, [mat]); m.castShadow = m.receiveShadow = true; return m;
};

/** Wall run from u0 to u1 along a frame line v, with gaps [[g0, g1], ...]. Adds boxes + collision segments. */
function wallRun(B, walls, F, u0, u1, v, gaps, y0, h, t = 0.2) {
  const cuts = [u0, ...gaps.flat(), u1].sort((p, q) => p - q);
  for (let k = 0; k < cuts.length; k += 2) {
    const s = cuts[k], e = cuts[k + 1];
    if (e - s < 0.05) continue;
    const [cx, cz] = F.at((s + e) / 2, v);
    B.box(cx, cz, e - s, t, y0, h, F.ang);
    walls.push({ a: F.at(s, v), b: F.at(e, v), y0, y1: y0 + h });
  }
}

/** Glazed wall run: low wall, glass panes between mullions, transom and lintel. Collision is full height. */
function glazedRun(BW, GB, walls, F, u0, u1, v, gaps, H) {
  const cuts = [u0, ...gaps.flat(), u1].sort((p, q) => p - q);
  for (let k = 0; k < cuts.length; k += 2) {
    const s = cuts[k], e = cuts[k + 1];
    if (e - s < 0.05) continue;
    const len = e - s, [cx, cz] = F.at((s + e) / 2, v);
    BW.color(0xf2e6cf); BW.box(cx, cz, len, 0.22, 0, 0.9, F.ang);          // low wall
    BW.color(0xf2e6cf); BW.box(cx, cz, len, 0.22, 2.95, H - 2.95, F.ang);   // lintel band
    BW.color(0x5e5146); BW.box(cx, cz, len, 0.16, 0.9, 0.07, F.ang);        // sill
    BW.color(0x5e5146); BW.box(cx, cz, len, 0.16, 2.88, 0.07, F.ang);       // head
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) { const [mx, mz] = F.at(s + (len * i) / n, v); BW.color(0x5e5146); BW.box(mx, mz, 0.08, 0.16, 0.9, 2.05, F.ang); } // mullions
    GB.color(0xbfe0f2); GB.box(cx, cz, len, 0.03, 0.97, 1.91, F.ang);      // glass
    walls.push({ a: F.at(s, v), b: F.at(e, v), y0: 0, y1: H });
  }
}

/** Canteen interior. */
function buildCanteen(b, out, B, BW) {
  const pts = b.pts;
  const F = frame(pts, b.entrance_edge ?? 0);
  const L = F.L, D = depthOf(pts, F), H = b.height || 4.2;
  const solid = (u0, u1, v0, v1) => out.solids.push(F.rect(u0, u1, v0, v1));
  // floor tiles
  const floorT = canvasTex(64, 64, (g) => {
    g.fillStyle = '#e9e3d6'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d9d1c1'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  });
  floorT.wrapS = floorT.wrapT = THREE.RepeatWrapping; floorT.repeat.set(1 / 1.2, 1 / 1.2);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)))).rotateX(Math.PI / 2).translate(0, 0.02, 0),
    new THREE.MeshLambertMaterial({ map: floorT, side: THREE.DoubleSide }));
  fl.receiveShadow = true; out.group.add(fl);

  // outer walls: framed glass all round so the room can be seen from outside (front door + side door)
  const GB = out.glassB;
  const door = [[L / 2 - 1.1, L / 2 + 1.1]];
  glazedRun(BW, GB, out.walls, F, -0.1, L + 0.1, 0.1, door, H);
  BW.color(0xf2e6cf); wallRun(BW, out.walls, F, -0.1, L + 0.1, D - 0.1, [], 0, H); // kitchen back wall stays solid
  BW.color(0xf2e6cf); { const [x, z] = F.at(L / 2, 0.1); BW.box(x, z, 2.2, 0.22, 2.55, H - 2.55, F.ang); } // over the door
  // end walls run along v: build them with a frame on the side edges
  const endWall = (u, gaps) => {
    const s = F.at(u, 0), e = F.at(u, D);
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    const sg = u === 0 ? 1 : -1; // inward from this end
    const G = { at: (uu, vv) => [s[0] + F.wx * uu + F.ux * vv * sg, s[1] + F.wz * uu + F.uz * vv * sg], ang: Math.atan2(F.wz, F.wx) };
    glazedRun(BW, GB, out.walls, G, 0, len, 0.1, gaps, H);
  };
  endWall(0, [[D - 5.5, D - 3.9]]); // side door on the end facing Khu E1 (between the coffee bar and the fridges)
  endWall(L, []);
  // door frames + windows on the front
  B.color(0x8a5a3c);
  for (const u of [L / 2 - 1.15, L / 2 + 1.15]) { const [x, z] = F.at(u, 0.1); B.box(x, z, 0.12, 0.3, 0, 2.4, F.ang); }
  { const [x, z] = F.at(L / 2, 0.1); B.box(x, z, 2.4, 0.3, 2.4, 0.15, F.ang); }
  // sign over the door
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.8), new THREE.MeshBasicMaterial({ map: canvasTex(512, 102, (g, w, h) => {
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 60px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText('CĂN TIN', w / 2, h / 2 + 3);
  }) }));
  { const [x, z] = F.at(L / 2, -0.06); sign.position.set(x, 3.0, z); sign.rotation.y = Math.atan2(-F.wx, -F.wz); out.group.add(sign); }

  // kitchen at the back behind a partition with a serving counter and two doorways
  const kv = D - 3.6;
  BW.color(0xf5efe3);
  wallRun(BW, out.walls, F, 0.3, L - 0.3, kv, [[2.6, 3.8], [L - 3.8, L - 2.6], [7, L - 7]], 0, H);
  B.color(0xb98b5e); { const [x, z] = F.at(L / 2, kv); B.box(x, z, L - 14, 0.6, 0, 1.0, F.ang); }        // serving counter
  B.color(0xe8e2d6); { const [x, z] = F.at(L / 2, kv); B.box(x, z, L - 13.8, 0.75, 1.0, 0.06, F.ang); }   // counter top
  solid(7, L - 7, kv - 0.35, kv + 0.35);
  // kitchen fittings: back counters, stove with pots, sink, big fridge
  B.color(0xc7ccd3); { const [x, z] = F.at(L / 2, D - 0.6); B.box(x, z, L - 2, 0.7, 0, 0.92, F.ang); }
  solid(1, L - 1, D - 1.0, D - 0.2);
  B.color(0x30343a); { const [x, z] = F.at(L / 2 - 4, D - 0.6); B.box(x, z, 3, 0.66, 0.92, 0.05, F.ang); }   // stove top
  B.color(0x9aa1a9);
  for (const du of [-1.1, 0, 1.1]) { const [x, z] = F.at(L / 2 - 4 + du, D - 0.6); B.box(x, z, 0.45, 0.45, 0.97, 0.35, F.ang); } // pots
  B.color(0x8fa7bd); { const [x, z] = F.at(L / 2 + 4, D - 0.6); B.box(x, z, 1.2, 0.5, 0.92, 0.04, F.ang); } // sink
  B.color(0xe9edf1); { const [x, z] = F.at(L - 2.2, D - 0.75); B.box(x, z, 1.4, 0.8, 0, 2.1, F.ang); } solid(L - 2.9, L - 1.5, D - 1.2, D - 0.3);
  B.color(0x7a8591); { const [x, z] = F.at(L / 2 - 4, D - 0.45); B.box(x, z, 3.2, 0.6, 2.2, 0.5, F.ang); }  // hood

  // coffee bar at the left end: counter, espresso machine, grinder, cups, menu board
  B.color(0x7b5236); { const [x, z] = F.at(3.2, 4.2); B.box(x, z, 0.7, 5.2, 0, 1.05, F.ang); } solid(2.8, 3.6, 1.6, 6.8);
  B.color(0x4a3222); { const [x, z] = F.at(3.2, 4.2); B.box(x, z, 0.85, 5.35, 1.05, 0.06, F.ang); }
  B.color(0xb0b6bd); { const [x, z] = F.at(3.15, 5.4); B.box(x, z, 0.5, 0.7, 1.11, 0.45, F.ang); }        // espresso machine
  B.color(0x2b2b2b); { const [x, z] = F.at(3.15, 4.4); B.box(x, z, 0.25, 0.25, 1.11, 0.4, F.ang); }       // grinder
  B.color(0xffffff); for (const dv of [2.4, 2.7, 3.0, 3.3]) { const [x, z] = F.at(3.0, dv); B.box(x, z, 0.12, 0.12, 1.11, 0.12, F.ang); } // cups
  const menu = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), new THREE.MeshLambertMaterial({ map: canvasTex(384, 205, (g, w, h) => {
    g.fillStyle = '#2b2622'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f6d58e'; g.font = '800 30px "Be Vietnam Pro", sans-serif'; g.textAlign = 'center'; g.fillText('CÀ PHÊ · NƯỚC', w / 2, 40);
    g.fillStyle = '#f3efe7'; g.font = '600 20px "Be Vietnam Pro", sans-serif'; g.textAlign = 'left';
    [['Cà phê đen', '15k'], ['Cà phê sữa', '18k'], ['Bạc xỉu', '20k'], ['Trà đá · Nước suối', '5k']].forEach(([n, p], i) => {
      g.fillText(n, 24, 82 + i * 30); g.textAlign = 'right'; g.fillText(p, w - 24, 82 + i * 30); g.textAlign = 'left';
    });
  }), emissive: 0xffffff, emissiveIntensity: 0 }));
  { const [x, z] = F.at(0.13, 4.2); menu.position.set(x, 2.3, z); menu.rotation.y = Math.atan2(F.ux, F.uz); out.group.add(menu); out.glow.push(menu.material); }

  // drinks fridges (glass doors, bottles inside, lit) against the partition
  const fridgeTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#dff3ff'; g.fillRect(0, 0, w, h);
    const cols = ['#e74c3c', '#2ecc71', '#f1c40f', '#3498db', '#e67e22', '#9b59b6'];
    for (let r = 0; r < 4; r++) {
      g.fillStyle = '#b8c6d1'; g.fillRect(0, 40 + r * 56, w, 4);
      for (let k = 0; k < 6; k++) { g.fillStyle = cols[(k + r) % cols.length]; g.fillRect(8 + k * 19, 12 + r * 56, 12, 28); }
    }
    g.strokeStyle = '#7d8a96'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
  const fridgeFront = new THREE.MeshLambertMaterial({ map: fridgeTex, emissive: 0xffffff, emissiveMap: fridgeTex, emissiveIntensity: 0.25 });
  out.glow.push(fridgeFront); fridgeFront.userData.dayGlow = 0.25;
  for (const u of [5.6, 6.7, 7.8]) {
    B.color(0xd5dbe1); { const [x, z] = F.at(u, kv - 0.45); B.box(x, z, 1.0, 0.7, 0, 2.0, F.ang); }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.85), fridgeFront);
    const [x, z] = F.at(u, kv - 0.81); glass.position.set(x, 1.0, z); glass.rotation.y = Math.atan2(-F.wx, -F.wz); out.group.add(glass);
  }
  solid(5.0, 8.4, kv - 0.85, kv - 0.05);

  // dining tables (2 rows x 3) with 4 stools each = 24 seats
  for (const v of [3.0, 6.0]) for (const u of [9.5, 13.0 + (v > 4 ? 0 : 3.5), 19.5]) {
    if (v < 4 && Math.abs(u - L / 2) < 2) continue; // keep the front door clear
    B.color(0xd9b48a); { const [x, z] = F.at(u, v); B.box(x, z, 1.8, 0.85, 0.72, 0.06, F.ang); }
    B.color(0x6e5a48); { const [x, z] = F.at(u, v); B.box(x, z, 0.12, 0.12, 0, 0.72, F.ang); }
    solid(u - 0.9, u + 0.9, v - 0.42, v + 0.42);
    B.color(0x3d7bd9);
    for (const du of [-0.5, 0.5]) for (const dv of [-0.75, 0.75]) { const [x, z] = F.at(u + du, v + dv); B.box(x, z, 0.36, 0.36, 0, 0.45, F.ang); }
  }
  // ceiling lights (glow at night)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1 });
  for (let u = 4; u < L - 2; u += 5) for (const v of [2.8, 6.2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.25), lampMat);
    const [x, z] = F.at(u, v); m.position.set(x, H - 0.25, z); m.rotation.y = -F.ang; out.group.add(m);
  }

  // roof (hidden while the student is inside so the room can be seen from the follow camera)
  const RB = new Builder();
  const eave = offsetPoly(pts, 0.6) || pts;
  const inset = offsetPoly(pts, -Math.min(L, D) * 0.38) || offsetPoly(pts, -2) || pts;
  RB.color(0x9a4b38); RB.band(eave, H - 0.25, H + 0.05);
  RB.color(0xb4533f);
  for (let i = 0; i < eave.length; i++) {
    const j = (i + 1) % eave.length, rise = Math.min(L, D) * 0.25;
    RB.quad([eave[i][0], H + 0.05, eave[i][1]], [eave[j][0], H + 0.05, eave[j][1]], [inset[j][0], H + rise, inset[j][1]], [inset[i][0], H + rise, inset[i][1]]);
  }
  RB.cap(inset, H + Math.min(L, D) * 0.25);
  RB.color(0xf1ede4); RB.cap(pts, H - 0.02); // white ceiling
  const roof = RB.mesh();
  out.group.add(roof);
  out.hideWhenInside.push({ pts, mesh: roof });
  return F;
}

/** E1: corridors on the 1st and 2nd floor along the front + staircase at the end next to the canteen. */
function buildCorridor(b, out, B, slabB) {
  const F = frame(b.roofPts, b.corridor.edge); // u along the front, v inward
  const d = b.corridor.depth, L = F.L, h = b.height;
  const out_ = (u, n) => F.at(u, -n); // n > 0 = outside the building
  // floor-1 corridor paving
  B.color(0xd8d2c4); B.cap(F.rect(0, L, 0, d), 0.02);
  // floor-2 slab (walkable) — fades when it hides the student
  slabB.color(0xeeeae2); slabB.band(F.rect(0, L, -0.05, d), FLOOR2 - 0.25, FLOOR2); slabB.cap(F.rect(0, L, -0.05, d), FLOOR2); slabB.cap(F.rect(0, L, -0.05, d), FLOOR2 - 0.25);
  out.surfaces.push({ pts: F.rect(0, L, -0.05, d), y: FLOOR2 });
  // columns along the front
  const stairU0 = L - 2.6; // landing zone at the end of the front (u from stairU0 to L - 0.3)
  B.color(0xf3eee4);
  for (let u = 0.3; u <= L - 0.2; u += 4.4) {
    if (u > stairU0 - 0.2 && u < L - 0.5) continue;
    const [x, z] = F.at(u, 0.2); B.box(x, z, 0.38, 0.38, 0, h, F.ang); out.solids.push(F.rect(u - 0.19, u + 0.19, 0.01, 0.39));
  }
  { const [x, z] = F.at(L - 0.2, 0.2); B.box(x, z, 0.38, 0.38, 0, h, F.ang); out.solids.push(F.rect(L - 0.39, L - 0.01, 0.01, 0.39)); }
  // floor-2 railing along the front (opening at the stair landing) and across both ends
  B.color(0xffffff);
  wallRun(B, out.walls, F, 0, L, 0.05, [[stairU0, L - 0.4]], FLOOR2, 1.0, 0.14);
  B.color(0x9aa3ad);
  for (let u = 0.4; u < L; u += 1.2) { if (u > stairU0 && u < L - 0.4) continue; const [x, z] = F.at(u, 0.05); B.box(x, z, 0.06, 0.18, FLOOR2 + 1.0, 0.05, F.ang); }
  const across = (u) => {
    const s = F.at(u, 0), e = F.at(u, d);
    const G = { at: (uu) => [s[0] + F.wx * uu, s[1] + F.wz * uu], ang: Math.atan2(F.wz, F.wx) };
    B.color(0xffffff); wallRun(B, out.walls, G, 0, d, 0, [], FLOOR2, 1.0, 0.14);
  };
  across(0.05); across(L - 0.05);
  // doors on both floors along the corridor (one per ~7 m)
  B.color(0x7a5c3e);
  for (let u = 3; u < L - 3; u += 7) for (const y of [0, FLOOR2]) { const [x, z] = F.at(u, d + 0.01); B.box(x, z, 1.0, 0.05, y + 0.15, 2.1, F.ang); }

  // staircase outside the front, rising toward the end of the building
  const run = 7.2, w = 1.6, steps = 20;
  const sU0 = stairU0 - run; // foot of the stairs
  B.color(0xd9d4ca);
  for (let k = 0; k < steps; k++) {
    const u = sU0 + (k + 0.5) * (run / steps), top = ((k + 1) / steps) * FLOOR2;
    const [x, z] = out_(u, w / 2 + 0.05); B.box(x, z, run / steps + 0.01, w, top - 0.18, 0.18, F.ang);
  }
  // sloped stringers along both sides of the flight (open underneath), a mid support, the landing slab
  const tread = run / steps;
  B.color(0xc9c2b5);
  for (let k = 0; k < steps; k++) {
    const u = sU0 + (k + 0.5) * tread, top = ((k + 1) / steps) * FLOOR2;
    for (const n of [0.08, w + 0.08]) { const [x, z] = out_(u, n); B.box(x, z, tread + 0.01, 0.14, Math.max(0, top - 0.5), Math.min(0.5, top) + 0.02, F.ang); }
  }
  B.color(0xbdb6a9);
  for (const k of [9]) { const u = sU0 + (k + 0.5) * tread, top = ((k + 1) / steps) * FLOOR2; for (const n of [0.08, w + 0.08]) { const [x, z] = out_(u, n); B.box(x, z, 0.22, 0.22, 0, top - 0.5, F.ang); } }
  B.color(0xe2ddd3); { const [x, z] = out_((stairU0 + L - 0.3) / 2, w / 2 + 0.05); B.box(x, z, L - 0.3 - stairU0, w + 0.2, FLOOR2 - 0.25, 0.25, F.ang); }
  B.color(0xbdb6a9); for (const uu of [stairU0 + 0.2, L - 0.5]) { const [x, z] = out_(uu, w); B.box(x, z, 0.25, 0.25, 0, FLOOR2 - 0.25, F.ang); }
  // handrail on the open side: posts on every other step + a rail following the slope, then along the landing
  B.color(0x9aa3ad);
  for (let k = 1; k < steps; k += 2) { const u = sU0 + (k + 0.5) * tread, top = ((k + 1) / steps) * FLOOR2; const [x, z] = out_(u, w + 0.1); B.box(x, z, 0.05, 0.05, top, 0.95, F.ang); }
  B.color(0xf2f2f2);
  for (let k = 0; k < steps; k++) { const u = sU0 + (k + 0.5) * tread, top = ((k + 1) / steps) * FLOOR2; const [x, z] = out_(u, w + 0.1); B.box(x, z, tread + 0.02, 0.07, top + 0.92, 0.07, F.ang); }
  { const [x, z] = out_((stairU0 + L - 0.3) / 2, w + 0.1); B.box(x, z, L - 0.3 - stairU0, 0.07, FLOOR2 + 0.92, 0.07, F.ang); B.color(0x9aa3ad); B.box(x, z, L - 0.3 - stairU0, 0.04, FLOOR2 + 0.45, 0.04, F.ang); }
  { const [x, z] = out_(L - 0.3, w / 2 + 0.05); B.color(0xf2f2f2); B.box(x, z, 0.07, w + 0.1, FLOOR2 + 0.92, 0.07, F.ang); }
  // collision: open side of the flight + landing, end of the landing
  out.walls.push({ a: out_(sU0, w + 0.1), b: out_(L - 0.3, w + 0.1), y0: 0, y1: FLOOR2 + 1.0 });
  out.walls.push({ a: out_(L - 0.3, 0), b: out_(L - 0.3, w + 0.1), y0: FLOOR2, y1: FLOOR2 + 1.0 });
  // walkable surfaces: the ramp and the landing
  const foot = out_(sU0, 0), dirU = [F.ux, F.uz];
  out.surfaces.push({ pts: [out_(sU0, -0.05), out_(stairU0, -0.05), out_(stairU0, w + 0.05), out_(sU0, w + 0.05)], ramp: { o: foot, u: dirU, len: run, y0: 0, y1: FLOOR2, steps } });
  out.surfaces.push({ pts: [out_(stairU0, -0.1), out_(L - 0.3, -0.1), out_(L - 0.3, w + 0.05), out_(stairU0, w + 0.05)], y: FLOOR2 });
}

/** Build all interiors. `buildings` are the scene building infos (with height). */
export function buildInteriors(buildings) {
  const out = { group: new THREE.Group(), solids: [], walls: [], surfaces: [], hideWhenInside: [], indoor: [], updaters: [], glow: [], occluders: [], meshFor: new Map(), glassB: new Builder(), ground: [], clear: [], night: [] };
  for (const b of buildings) {
    if (b.interior === 'canteen') {
      const B = new Builder(), BW = new Builder();
      buildCanteen(b, out, B, BW);
      const furn = B.mesh(); out.group.add(furn);
      const wallsMesh = fadeable(BW.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      wallsMesh.userData.building = b;
      out.group.add(wallsMesh);
      out.occluders.push(wallsMesh);
      out.meshFor.set(b.id, wallsMesh);
    }
    if (b.interior === 'khuH') {
      const h = buildKhuH(b, out);
      out.group.add(h.group);
      out.occluders.push(...h.meshes);
      out.meshFor.set(b.id, h.meshes[0]);
      out.indoor.push(h.indoor);
      out.updaters.push(h);
    }
    if (b.khuF) {
      const f = buildKhuF(b);
      out.group.add(f.group);
      for (const m of f.meshes) { m.userData.building = b; out.occluders.push(m); }
      out.solids.push(...f.solids); out.surfaces.push(...f.surfaces);
      out.ground.push(...f.ground); out.clear.push(...f.clear); out.night.push(f.setNight);
    }
    if (b.corridor) {
      const B = new Builder(), slabB = new Builder();
      buildCorridor(b, out, B, slabB);
      out.group.add(B.mesh());
      const slab = fadeable(slabB.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      slab.userData.building = b;
      out.group.add(slab);
      out.occluders.push(slab);
    }
  }
  if (out.glassB.tris) {
    const glass = out.glassB.mesh({ transparent: true, opacity: 0.32, depthWrite: false });
    glass.castShadow = false; glass.renderOrder = 3;
    out.group.add(glass);
  }
  return {
    ...out,
    /** Hide the canteen roof while the student is inside it. */
    update(st) {
      for (const r of out.hideWhenInside) r.mesh.visible = !(st && st.on && !st.fp && insideP(r.pts, st.x, st.z)); // first person keeps the roof + ceiling
      for (const h of out.updaters) h.update(st);
    },
    setNight(on) { for (const m of out.glow) m.emissiveIntensity = on ? 0.9 : (m.userData.dayGlow || 0); for (const f of out.night) f(on); },
  };
}
