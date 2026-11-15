// Details from photos of places that were still plain blocks in the 3D campus. Only what the photos show is built;
// everything is placed against the OpenStreetMap outlines and checked on satellite imagery (Esri World Imagery).
// Photos: Wikimedia Commons "Khu A.jpg", "Kvhbbk.jpg", "Khu b.jpg", "Tthl.jpg", "Bkdn.jpg" (2007-2008, CC BY-SA 3.0)
// and recent visitor photos on the Google Maps page of the school.
//  - Khu A (hiệu bộ, an H-shaped block): the entrance pavilion in the middle of its long front, where the outline
//    steps 4 m forward. Grey-blue walls, a tall grid of windows on the top floor, "TRƯỜNG ĐẠI HỌC BÁCH KHOA" in blue
//    serif letters below them, a pent roof around it at the height of the main roof and a wide low hip roof with
//    flared corners on top, a flag on the ridge. Breeze-block screens (gạch hoa thông gió) on the end walls of the
//    wings, the fish ponds in its two courtyards with green-tiled walls and a pergola on orange round columns
//    covered in bougainvillea, black double-lantern lamp posts and two white statues on the lawns across the road
//    (a draped woman carrying a jar, and a discus thrower on a dark stone plinth).
//  - Khu B: the entrance tower in the middle of the long front: a crown of zigzag concrete fins on top, stone
//    cladding round the door with a round porthole window each side, breeze-block screens on the first floor.
//  - Trung tâm Học liệu (Learning Resources and Communication Center): white, with a wide flat overhang at the roof,
//    a low hip roof with a glass lantern in the middle (seen from above), a half-round entrance canopy, three flag
//    poles, the red granite name stone on the lawn and areca palms along the front.
import * as THREE from 'three';
import { Builder, insideP, offsetPoly, nameSign, canvasTex, flagTex } from './campus-details.js';

const FLOOR_H = 3.4;

/** Frame on one edge of an outline: u along the edge from its middle, n outwards. */
function edgeFrame(pts, i) {
  const a = pts[i], c = pts[(i + 1) % pts.length];
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let nx = uz, nz = -ux;
  if (insideP(pts, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
  return { L, ux, uz, nx, nz, mx, mz, ang: Math.atan2(uz, ux), rot: Math.atan2(nx, nz),
    at: (u, n) => [mx + ux * u + nx * n, mz + uz * u + nz * n] };
}
/** Index of the edge of `pts` whose middle is nearest to (x, z). */
function edgeNear(pts, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length], d = Math.hypot((a[0] + c[0]) / 2 - x, (a[1] + c[1]) / 2 - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const near = (b, x, z, r) => b.pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < r);
const heightOf = (b) => b.height || b.levels * FLOOR_H + 0.8;
/** Rectangle in an edge frame: u from u0 to u1, n from n0 to n1. */
const rectIn = (F, u0, u1, n0, n1) => [F.at(u0, n0), F.at(u1, n0), F.at(u1, n1), F.at(u0, n1)];

// ---------------- textures ----------------
/** Breeze blocks: square cells with a round hole and a cross, as cast in the 1970s-80s blocks of Khu A and Khu B. */
function latticeTex(cellsU, cellsV) {
  const C = 64, t = canvasTex(C * 4, C * 4, (g) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * C, y = j * C;
      g.fillStyle = '#f1f0eb'; g.fillRect(x, y, C, C);
      g.fillStyle = '#5b6168'; g.beginPath(); g.arc(x + C / 2, y + C / 2, C * 0.36, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f1f0eb'; g.fillRect(x + C / 2 - 3, y + 6, 6, C - 12); g.fillRect(x + 6, y + C / 2 - 3, C - 12, 6);
      g.strokeStyle = '#c9c7c0'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, C - 3, C - 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(cellsU / 4, cellsV / 4);
  return t;
}
/** Rough stone cladding (đá chẻ) round the Khu B entrance. */
function stoneTex() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6d645a'; g.fillRect(0, 0, w, h);
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < h; y += 26) for (let x = -((y / 26) % 2) * 20; x < w; x += 34 + r() * 18) {
      const k = 120 + r() * 70 | 0;
      g.fillStyle = `rgb(${k + 25},${k + 12},${k - 8})`;
      g.beginPath(); g.ellipse(x + 17, y + 13, 15 + r() * 4, 10 + r() * 3, r() * 0.4, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Grid of windows: dark glass with light frames; cols x rows panes. */
function gridTex(cols, rows, glass = '#4f6274', frame = '#e4e8ec') {
  return canvasTex(cols * 48, rows * 64, (g, w, h) => {
    g.fillStyle = frame; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      g.fillStyle = glass; g.fillRect(i * 48 + 5, j * 64 + 6, 38, 52);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(i * 48 + 7, j * 64 + 8, 10, 48);
    }
  });
}
/** Grey-blue wall with rows of windows (the Khu A pavilion below its name band). */
function wallTex(cols, rows) {
  return canvasTex(cols * 64, rows * 96, (g, w, h) => {
    g.fillStyle = '#c3cdd6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      g.fillStyle = '#e9edf0'; g.fillRect(i * 64 + 8, j * 96 + 22, 48, 54);
      g.fillStyle = '#4e6072'; g.fillRect(i * 64 + 12, j * 96 + 26, 40, 46);
      g.fillStyle = '#e9edf0'; g.fillRect(i * 64 + 31, j * 96 + 26, 2, 46);
    }
  });
}
/** The granite stone in front of the Learning Resources Center (g5 photo): red-brown with pale letters. */
function lrcSignTex() {
  return canvasTex(1024, 400, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#7b3a2c'); gr.addColorStop(1, '#5e2a20');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 260; i++) g.fillRect((i * 97) % w, (i * 53) % h, 3, 2);
    g.textAlign = 'center'; g.fillStyle = '#efe3c8';
    const line = (txt, y, px, weight = 700) => {
      let s = px; do { g.font = `${weight} ${s}px "Times New Roman", Georgia, serif`; s -= 2; } while (g.measureText(txt).width > w - 70 && s > 10);
      g.fillText(txt, w / 2, y);
    };
    line('ĐẠI HỌC ĐÀ NẴNG', 62, 34);
    line('TRƯỜNG ĐẠI HỌC BÁCH KHOA', 108, 34);
    line('TRUNG TÂM HỌC LIỆU VÀ TRUYỀN THÔNG', 200, 58, 800);
    line('LEARNING RESOURCES AND COMMUNICATION CENTER', 290, 38, 600);
  });
}

// ---------------- small pieces ----------------
/** Low hip roof over a rectangle (4 corners, any order round it): eaves `out` beyond the walls, corners lifted by
 *  `flare` (the upturned eaves of the photos), `rise` up to a flat top that is `topK` of the size. */
function hipRoof(B, ring, y, rise, out, flare, topK, color, edge) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / 4, cz = ring.reduce((s, p) => s + p[1], 0) / 4;
  const eave = offsetPoly(ring, out) || ring;
  const top = ring.map(([x, z]) => [cx + (x - cx) * topK, cz + (z - cz) * topK]);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const T = [0, 0.22, 0.78, 1], lift = [flare, 0, 0, flare];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (let k = 0; k < 3; k++) {
      const e0 = lerp(eave[i], eave[j], T[k]), e1 = lerp(eave[i], eave[j], T[k + 1]);
      const t0 = lerp(top[i], top[j], T[k]), t1 = lerp(top[i], top[j], T[k + 1]);
      const y0 = y + lift[k], y1 = y + lift[k + 1];
      B.color(color);
      B.quad([e0[0], y0, e0[1]], [e1[0], y1, e1[1]], [t1[0], y + rise, t1[1]], [t0[0], y + rise, t0[1]]);
      B.color(edge); // fascia under the eave
      B.quad([e0[0], y0 - 0.28, e0[1]], [e1[0], y1 - 0.28, e1[1]], [e1[0], y1, e1[1]], [e0[0], y0, e0[1]]);
    }
  }
  B.color(color); B.cap(top, y + rise);
}
/** Round column (8 sides) as a merged prism. */
function column(B, x, z, r, y0, h) {
  const ring = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  B.band(ring, y0, y0 + h); B.cap(ring, y0 + h);
}
/** Areca palm (cau kiểng): thin ringed trunk and a tuft of arching fronds. */
function palm(group, mats, x, z, h) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, h, 6), mats.trunk);
  trunk.position.set(x, h / 2, z); group.add(trunk);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), mats.frond);
    leaf.scale.set(0.16, 0.08, 1.15);
    leaf.position.set(x + Math.sin(a) * 0.85, h + 0.05, z + Math.cos(a) * 0.85);
    leaf.rotation.set(-0.5, a, 0, 'YXZ');
    group.add(leaf);
  }
}
/** Black cast-iron lamp post with two lanterns (in front of Khu A in the photos). */
function lantern(B, group, mats, x, z, ang) {
  B.color(0x22262b); B.box(x, z, 0.5, 0.5, 0, 0.5, ang); column(B, x, z, 0.07, 0.5, 3.4);
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const sd of [-1, 1]) {
    const lx = x + c * sd * 0.5, lz = z + s * sd * 0.5;
    B.color(0x22262b); B.box(x + c * sd * 0.25, z + s * sd * 0.25, 0.5, 0.06, 3.55, 0.06, ang);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.38, 6), mats.lamp);
    glass.position.set(lx, 3.42, lz); group.add(glass);
    B.color(0x22262b); B.box(lx, lz, 0.36, 0.36, 3.6, 0.08, ang);
  }
}
/** Statues: plain white stone figures, simple shapes at life size on their plinths. */
function statueWoman(group, mat, x, z, rot) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; group.add(g);
  const add = (geo, px, py, pz, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(1.2, 0.35, 1.2), 0, 0.175, 0);                      // plinth
  add(new THREE.CylinderGeometry(0.2, 0.36, 1.25, 10), 0, 0.98, 0);            // draped skirt
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 10), 0, 1.86, 0);            // body
  add(new THREE.SphereGeometry(0.12, 10, 8), 0, 2.27, 0);                       // head
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), 0.2, 2.05, 0, 0, 0, -0.35); // raised arm
  add(new THREE.CylinderGeometry(0.12, 0.09, 0.3, 10), 0.3, 2.38, 0, 0, 0, 0.5);  // jar on the shoulder
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 6), -0.19, 1.7, 0.05, 0.2, 0, 0.15); // arm holding the robe
}
function statueDiscus(B, group, mat, x, z, rot) {
  B.color(0x4a4f55); B.box(x, z, 1.15, 1.15, 0, 1.25, rot);                   // dark stone plinth
  const g = new THREE.Group(); g.position.set(x, 1.25, z); g.rotation.y = rot; group.add(g);
  const add = (geo, px, py, pz, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.07, 0.06, 0.85, 6), -0.15, 0.42, 0.05, 0, 0, 0.12); // standing leg
  add(new THREE.CylinderGeometry(0.07, 0.06, 0.8, 6), 0.25, 0.38, -0.1, 0.3, 0, -0.35); // trailing leg
  add(new THREE.CylinderGeometry(0.15, 0.12, 0.62, 8), 0, 1.05, 0, 0.55, 0.4, 0.25);    // bent torso, twisting
  add(new THREE.SphereGeometry(0.11, 8, 6), 0.05, 1.42, 0.22);                          // head
  add(new THREE.CylinderGeometry(0.045, 0.04, 0.72, 6), -0.38, 1.25, -0.2, 0.6, 0, 1.0); // throwing arm swung back
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 12), -0.68, 1.5, -0.42, 0.9, 0, 0.5); // discus
  add(new THREE.CylinderGeometry(0.045, 0.04, 0.6, 6), 0.2, 0.92, 0.25, -0.5, 0, -0.4);  // other arm towards the knee
}

// ---------------- the places ----------------
// Roofs as seen on satellite imagery (Esri World Imagery, 0.3-0.6 m per pixel), by OSM way id: most teaching blocks
// have pitched metal roofs in a pale teal or light grey, Khu C and E2 red tiles, the old dormitories rusty brown
// corrugated sheet, Nhà 5 and the sports hall pale green, Viện Cơ khí a dark flat roof.
const TEAL = 0xa7cdc5, GREY = 0xcfd4d6, TILE = 0xb9533f, RED = 0xa8483a;
const ROOFS = {
  118777665: { roof: 'hip', roofColor: TEAL },  // Khu K
  118777693: { roof: 'hip', roofColor: TEAL },  // Khu N
  968341212: { roof: 'hip', roofColor: TEAL },
  968341227: { roof: 'hip', roofColor: TEAL },  // Khu I
  968341230: { roof: 'hip', roofColor: TEAL },
  1043659297: { roof: 'hip', roofColor: TEAL }, // Khu A, north wing
  1043659298: { roof: 'hip', roofColor: TEAL }, // Khu A, south wing
  968341235: { roof: 'hip', roofColor: GREY },  // Khu D
  1328750179: { roof: 'hip', roofColor: GREY }, // Khu N, west block
  1328750181: { roof: 'hip', roofColor: GREY },
  968341885: { roof: 'hip', roofColor: TILE },  // Khu E2
  968341233: { roof: 'hip', roofColor: TILE },  // Khu C - Khối E
  968341210: { roof: 'hip', roofColor: TILE },  // Khu C - Khối D
  968341225: { roof: 'hip', roofColor: 0xc0603e }, // Khu C - Khối B
  968341209: { roof: 'hip', roofColor: 0xbfd3d0 }, // Khu C - Khối A
  968341220: { roof: 'hip', roofColor: 0xbfd3d0 }, // Khu C - Khối C
  1328750185: { roof: 'hip', roofColor: 0x8e4a3c }, // Khu I, small block
  968341231: { roof: 'hip', roofColor: 0xc9b79a }, // Khu G
  968341223: { roof: 'flat', roofColor: 0x5d6268 }, // Viện Cơ khí (M)
  118777657: { roof: 'hip', roofColor: 0x9b5a43 }, // Nhà 1 (KTX)
  118777685: { roof: 'hip', roofColor: 0x9b5a43 }, // Nhà 2 (KTX)
  118777695: { roof: 'hip', roofColor: 0x9fcab6 }, // Nhà 5 (KTX)
  118777656: { roofColor: 0xd9e2e0 },              // Nhà 4 (KTX), flat
  118777678: { roof: 'hip', roofColor: 0x9ccbb8 }, // Trung tâm Giáo dục thể chất
  968341214: { roof: 'hip', roofColor: RED },      // Ban Quản lý Ký túc xá
  1043659299: { roof: 'hip', roofColor: RED },     // Căn tin KTX
};

/** Before the buildings are built: main doors where the photos have them, roofs from the satellite imagery. */
export function prepareLandmarks(data) {
  for (const b of data.buildings) {
    const r = ROOFS[b.id];
    if (r && !b.hollow) b.style = { ...(b.style || {}), ...r };
  }
  // the dormitory office is a single storey with a veranda in the photos (OSM guessed 2)
  const office = data.buildings.find((b) => b.id === 968341214);
  if (office?.estimated) office.levels = 1;
  const A = data.buildings.find((b) => b.zone === 'A' && near(b, -40.1, -76.9, 1.5) && near(b, -22.9, -85.3, 1.5));
  if (A) A.entrance_edge = edgeNear(A.pts, -31.5, -81.1);
  const L = data.buildings.find((b) => b.zone === 'L');
  // OSM only guessed 4 floors; every photo shows 3 under the roof overhang
  if (L) { L.style = { ...(L.style || {}), roofColor: 0xdfe5e9 }; L.noCanopy = true; if (L.estimated) L.levels = 3; }
}

export function buildLandmarks(data) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const B = new Builder();
  const glow = [];
  const posts = [], clear = [], solids = [];
  const mats = {
    trunk: new THREE.MeshLambertMaterial({ color: 0x8a7a63 }),
    frond: new THREE.MeshLambertMaterial({ color: 0x4f8f3a }),
    lamp: new THREE.MeshLambertMaterial({ color: 0xfff2c8, emissive: 0xffd27a, emissiveIntensity: 0 }),
    stone: new THREE.MeshLambertMaterial({ color: 0xf1efe8 }),
  };
  glow.push(mats.lamp);
  const plane = (w, h, mat, x, y, z, rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = rot; group.add(m); return m; };
  const blds = data.buildings;

  // ---- Khu A ----
  const A = blds.find((b) => b.zone === 'A' && near(b, -40.1, -76.9, 1.5) && near(b, -22.9, -85.3, 1.5));
  if (A) {
    const h = heightOf(A);
    const F = edgeFrame(A.pts, edgeNear(A.pts, -31.5, -81.1));
    const W = F.L / 2, top = h + FLOOR_H, D = 12;
    // pavilion body above the main roof (the front and sides below it are the building's own walls)
    const body = rectIn(F, -W, W, 0.05, -D);
    B.color(0xc6d0d9); B.band(body, h - 0.2, top);
    // the pavilion is grey-blue from the ground up: its own skin over the front and the two short sides
    const skin = new THREE.MeshLambertMaterial({ map: wallTex(6, Math.max(1, A.levels - 1)) });
    const [kx, kz] = F.at(0, 0.07), skinH = h - 2.1 - 0.9;
    plane(F.L, skinH, skin, kx, 0.9 + skinH / 2, kz, F.rot);
    for (const sd of [-1, 1]) {
      const S = edgeFrame(A.pts, (edgeNear(A.pts, ...F.at(sd * W, -2)) + A.pts.length) % A.pts.length);
      if (S.L > 8) continue;
      const side = new THREE.MeshLambertMaterial({ map: wallTex(1, Math.max(1, A.levels - 1)) });
      const [ox, oz] = S.at(0, 0.07);
      plane(S.L, skinH, side, ox, 0.9 + skinH / 2, oz, S.rot);
    }
    // tall glass grid of the top floor, the name band under it
    const grid = new THREE.MeshLambertMaterial({ map: gridTex(6, 2) });
    const [gx, gz] = F.at(0, 0.09);
    plane(F.L - 3, FLOOR_H - 0.5, grid, gx, h + FLOOR_H / 2 - 0.05, gz, F.rot);
    const sign = nameSign(F.L - 2, 1.5, true);
    const [sx, sz] = F.at(0, 0.12);
    plane(F.L - 2, 1.5, sign, sx, h - 1.25, sz, F.rot); glow.push(sign);
    // pent roof round the pavilion at the main roof line, then the wide flared hip roof on top
    for (const [u0, u1, n0, n1] of [[-W - 1.4, W + 1.4, 1.4, 0], [-W - 1.4, -W, 0, -D], [W, W + 1.4, 0, -D]]) {
      const r = rectIn(F, u0, u1, n0, n1);
      B.color(0xd3d8dc); B.band(r, h + 0.05, h + 0.3); B.cap(r, h + 0.3);
    }
    hipRoof(B, rectIn(F, -W, W, 0.05, -D), top, 2.1, 1.9, 0.45, 0.35, 0xd9dde0, 0xaab2ba);
    // flag on the ridge
    const [fx, fz] = F.at(0, -D / 2);
    B.color(0xdfe3e7); column(B, fx, fz, 0.06, top + 2.1, 5.2);
    const flag = plane(1.5, 1.0, new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide }), 0, 0, 0, F.rot);
    const [ffx, ffz] = F.at(-0.78, -D / 2);
    flag.position.set(ffx, top + 2.1 + 5.2 - 0.55, ffz);
    // black double-lantern lamp posts either side of the front
    for (const u of [-W - 2.5, W + 2.5]) { const [lx, lz] = F.at(u, 2.2); lantern(B, group, mats, lx, lz, F.ang); posts.push([lx, lz, 0.3]); }
    // white statues on the lawns across the road (draped woman with a jar; discus thrower on a dark plinth)
    const [wx, wz] = F.at(13, 17), [dx, dz] = F.at(-12, 17);
    statueWoman(group, mats.stone, wx, wz, F.rot + Math.PI);
    statueDiscus(B, group, mats.stone, dx, dz, F.rot + Math.PI + 0.4);
    posts.push([wx, wz, 0.75], [dx, dz, 0.75]);
    clear.push(rectIn(F, 9, 17, 13, 21), rectIn(F, -16, -8, 13, 21));
  }
  // breeze-block screens on the end walls of the two outer Khu A wings (their short edges)
  const lattice = new THREE.MeshLambertMaterial({ map: latticeTex(10, 14) });
  for (const b of blds.filter((x) => x.zone === 'A' && x.pts.length === 4)) {
    const h = heightOf(b);
    for (let i = 0; i < b.pts.length; i++) {
      const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 8 || L > 16) continue;
      const F = edgeFrame(b.pts, i);
      const w = Math.min(L - 3, 9), hh = h - FLOOR_H - 0.6;
      const m = new THREE.MeshLambertMaterial({ map: lattice.map.clone() });
      m.map.repeat.set(w / 0.9 / 4, hh / 0.9 / 4); m.map.needsUpdate = true;
      const [px, pz] = F.at(0, 0.08);
      plane(w, hh, m, px, FLOOR_H + hh / 2, pz, F.rot);
    }
  }
  // fish ponds in the courtyards: green-tiled walls, and a pergola on orange columns along one long side
  for (const pond of data.areas.filter((a) => a.kind === 'water' && a.name === 'Hồ cá' && a.pts.length === 4)) {
    const p = pond.pts;
    B.color(0x4f8f7d); B.band(p, 0, 0.45);
    const kerb = offsetPoly(p, 0.25);
    if (kerb) { B.color(0xd8d6cf); B.band(kerb, 0, 0.5); B.ringCap(kerb, p, 0.5); }
    let li = 0; for (let i = 0; i < 4; i++) { const a = p[i], c = p[(i + 1) % 4]; if (Math.hypot(c[0] - a[0], c[1] - a[1]) > Math.hypot(p[(li + 1) % 4][0] - p[li][0], p[(li + 1) % 4][1] - p[li][1])) li = i; }
    const F = edgeFrame(p, li), n = Math.max(3, Math.round(F.L / 2.6));
    for (const row of [0.6, 3.0]) {
      for (let k = 0; k <= n; k++) {
        const u = -F.L / 2 + (F.L * k) / n, [cx, cz] = F.at(u, row);
        B.color(0xe39a3b); column(B, cx, cz, 0.17, 0, 2.7);
        posts.push([cx, cz, 0.2]);
      }
      const [bx, bz] = F.at(0, row);
      B.color(0xf3f1ea); B.box(bx, bz, F.L + 0.6, 0.22, 2.7, 0.25, F.ang);    // beam along the row
    }
    for (let k = 0; k <= n * 2; k++) {                                          // slats across
      const [tx, tz] = F.at(-F.L / 2 + (F.L * k) / (n * 2), 1.8);
      B.color(0xf3f1ea); B.box(tx, tz, 0.12, 3.4, 2.95, 0.14, F.ang);
    }
    for (let k = 0; k < n * 5; k++) {                                            // bougainvillea spilling over the top
      const t = (k * 0.618) % 1, row = ((k * 7) % 11) / 11;
      const [qx, qz] = F.at(-F.L / 2 + 0.4 + (F.L - 0.8) * t, 0.3 + row * 3.0);
      B.color([0xd94f9b, 0xc23f86, 0x5f9445, 0xe0609f][k % 4]);
      B.box(qx, qz, 0.55 + (k % 3) * 0.2, 0.5 + (k % 2) * 0.25, 3.02, 0.18 + (k % 3) * 0.08, F.ang + ((k % 5) - 2) * 0.25);
    }
    clear.push(rectIn(F, -F.L / 2 - 1, F.L / 2 + 1, -0.5, 4));
  }

  // ---- Khu B: entrance tower in the middle of the long front ----
  const KB = blds.filter((b) => b.zone === 'B').sort((a, b) => b.pts.length - a.pts.length)[0];
  if (KB) {
    let li = 0, lb = 0;
    for (let i = 0; i < KB.pts.length; i++) { const a = KB.pts[i], c = KB.pts[(i + 1) % KB.pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L > lb) { lb = L; li = i; } }
    const F = edgeFrame(KB.pts, li), h = heightOf(KB), TW = 4.6, top = h + 1.6;
    const tower = rectIn(F, -TW, TW, 0.9, -6);
    B.color(0xeef0ee); B.band(tower, 0, top); B.cap(tower, top);
    // the crown: zigzag fins all round the top
    const crown = offsetPoly(tower, 0.25) || tower;
    for (let i = 0; i < 4; i++) {
      const a = crown[i], c = crown[(i + 1) % 4], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(2, Math.round(L / 0.9));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 0.5) / n, t2 = (k + 1) / n;
        const P = (t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
        const p0 = P(t0), p1 = P(t1), p2 = P(t2);
        B.color(0xf6f6f2);
        B.quad([p0[0], top, p0[1]], [p2[0], top, p2[1]], [p2[0], top + 0.3, p2[1]], [p0[0], top + 0.3, p0[1]]);
        B.tri([p0[0], top + 0.3, p0[1]], [p2[0], top + 0.3, p2[1]], [p1[0], top + 1.1, p1[1]]);
      }
    }
    B.color(0xe5e7e3); B.cap(crown, top + 0.05);
    // top floor windows of the tower, stone cladding and portholes at the door
    const [wx, wz] = F.at(0, 0.95);
    plane(TW * 2 - 1.4, FLOOR_H - 0.9, new THREE.MeshLambertMaterial({ map: gridTex(4, 1, '#3e6f8c') }), wx, h - FLOOR_H / 2 + 0.2, wz, F.rot);
    const stone = new THREE.MeshLambertMaterial({ map: stoneTex() });
    for (const sd of [-1, 1]) {
      const st = stone.clone(); st.map = stone.map.clone(); st.map.repeat.set(1.2, 1.4); st.map.needsUpdate = true;
      const [px, pz] = F.at(sd * (TW - 1.5), 0.97);
      plane(3, FLOOR_H - 0.2, st, px, (FLOOR_H - 0.2) / 2, pz, F.rot);
      const [ox, oz] = F.at(sd * (TW - 1.5), 1.0);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.66, 20), mats.stone);
      ring.position.set(ox, 1.7, oz); ring.rotation.y = F.rot; group.add(ring);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshLambertMaterial({ color: 0x33414c }));
      hole.position.set(ox, 1.7, oz); hole.rotation.y = F.rot; group.add(hole);
    }
    const [ddx, ddz] = F.at(0, 0.96);
    plane(2.4, 2.6, new THREE.MeshLambertMaterial({ color: 0x3b4650 }), ddx, 1.3, ddz, F.rot);
    // breeze-block screens on the first floor either side of the tower
    for (const sd of [-1, 1]) {
      const w = 7, m = new THREE.MeshLambertMaterial({ map: lattice.map.clone() });
      m.map.repeat.set(w / 0.9 / 4, (FLOOR_H - 0.6) / 0.9 / 4); m.map.needsUpdate = true;
      const [px, pz] = F.at(sd * (TW + 1 + w / 2), 0.08);
      plane(w, FLOOR_H - 0.6, m, px, FLOOR_H * 1.5, pz, F.rot);
    }
    solids.push(rectIn(F, -TW, TW, 0.9, 0));
  }

  // ---- Trung tâm Học liệu ----
  const L = blds.find((b) => b.zone === 'L');
  if (L && L.pts.length === 4) {
    const h = heightOf(L);
    let fi = 0; for (let i = 0; i < 4; i++) { const m = (L.pts[i][0] + L.pts[(i + 1) % 4][0]) / 2; if (m > (L.pts[fi][0] + L.pts[(fi + 1) % 4][0]) / 2) fi = i; }
    const F = edgeFrame(L.pts, fi);
    // the wide flat overhang at the roof line (the hip roof itself is drawn with the other roofs)
    const slab = offsetPoly(L.pts, 2.2);
    if (slab) { B.color(0xf7f8f8); B.band(slab, h - 0.45, h + 0.1); B.cap(slab, h - 0.45); B.cap(slab, h + 0.1); }
    // glass lantern in the middle of the roof (the dark square seen from above)
    const thick = 2 * Math.abs(L.pts.reduce((s, p, i) => { const q = L.pts[(i + 1) % 4]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2) /
      L.pts.reduce((s, p, i) => { const q = L.pts[(i + 1) % 4]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
    const rise = thick * 0.46 * 0.62;
    const cx = L.pts.reduce((s, p) => s + p[0], 0) / 4, cz = L.pts.reduce((s, p) => s + p[1], 0) / 4;
    const lan = L.pts.map(([x, z]) => [cx + (x - cx) * 0.2, cz + (z - cz) * 0.2]);
    B.color(0x52677a); B.band(lan, h + rise, h + rise + 1.5);
    hipRoof(B, lan, h + rise + 1.5, 1.2, 0.5, 0, 0.2, 0xe9edf0, 0xc3cbd2);
    // half-round entrance canopy on two columns, glass doors
    const [ex, ez] = F.at(0, 0.02);
    const half = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.35, 24, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0xf6f7f7 }));
    half.position.set(ex, 3.75, ez); half.rotation.y = F.rot - Math.PI / 2; half.castShadow = true; group.add(half);
    for (const sd of [-1, 1]) { const [px, pz] = F.at(sd * 2.2, 2.0); B.color(0xf4f5f5); column(B, px, pz, 0.2, 0, 3.6); posts.push([px, pz, 0.22]); }
    const [dx, dz] = F.at(0, 0.06);
    plane(4.2, 3, new THREE.MeshLambertMaterial({ color: 0x4f6474 }), dx, 1.5, dz, F.rot);
    // three flag poles, the national flag on the tallest
    [3.2, 4.8, 6.4].forEach((u, i) => {
      const [px, pz] = F.at(u, 4.6), H = i === 2 ? 11 : 10.4;
      B.color(0xd7dbe0); column(B, px, pz, 0.06, 0, H); posts.push([px, pz, 0.12]);
      if (i === 2) {
        const fl = plane(1.8, 1.2, new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide }), 0, 0, 0, F.rot);
        const [qx, qz] = F.at(u + 0.95, 4.6);
        fl.position.set(qx, H - 0.65, qz);
      }
    });
    // the name stone on a low plinth, tilted back
    const [gx, gz] = F.at(11, 3.4);
    B.color(0xbdb9b0); B.box(gx, gz, 4.6, 1.6, 0, 0.3, F.ang);
    const st = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.6, 0.4), [0, 0, 0, 0, 0, 0].map((_, k) => k === 4 ? new THREE.MeshLambertMaterial({ map: lrcSignTex() }) : new THREE.MeshLambertMaterial({ color: 0x5e2a20 })));
    st.position.set(gx, 1.05, gz); st.rotation.set(0, F.rot, 0); st.rotateX(-0.3); st.castShadow = true; group.add(st);
    solids.push(rectIn(F, 8.7, 13.3, 2.6, 4.2));
    // areca palms along the front
    for (const u of [-20, -15.5, -10.5, -6, 15.5, 20]) { const [px, pz] = F.at(u, 1.9); palm(group, mats, px, pz, 3.4 + ((u * 7) % 3 + 3) % 3 * 0.4); posts.push([px, pz, 0.15]); }
    clear.push(rectIn(F, -F.L / 2, F.L / 2, 0, 6));
  }

  const mesh = B.mesh();
  group.add(mesh);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group, posts, clear, solids,
    setNight(on) { for (const m of glow) m.emissiveIntensity = on ? 1 : 0; },
  };
}
