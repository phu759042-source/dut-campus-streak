// Visual detail for the 3D campus: facade styles per zone, pitched roofs, parapets, plinths, rooftop units,
// perimeter wall, gates with a name sign, parking canopies and street lamps.
// Styles follow the official campus renders (white corridor blocks, cream walls with red tile roofs,
// brown brick Khu F, glass tower Nhà S, Trung tâm Học liệu with a light-blue roof).
// Most extras are merged into a few vertex-coloured meshes so the draw-call count stays low.
import * as THREE from 'three';

export const FLOOR_H = 3.4;
const TILE_W = 12, TILE_FLOORS = 2; // one facade texture tile = 12 m wide x 2 floors

// ---------------- styles ----------------
// wall: facade texture style; roof: 'hip' (pitched) or 'flat'; roofColor for the roof surface
export function styleOf(b) {
  const base = baseStyle(b);
  return b.style ? { ...base, ...b.style } : base;
}
function baseStyle(b) {
  const z = b.zone;
  if (z === 'S') return { wall: 'glass', roof: 'flat', roofColor: 0xd5dbe2, parapet: 0xf2f4f6 };
  if (z === 'L') return { wall: 'glassLight', roof: 'hip', roofColor: 0x8cc3de };
  if (z === 'F') return { wall: 'brick', roof: 'hip', roofColor: 0xb4503c };
  if (['H', 'N', 'P', 'X', 'E1'].includes(z)) return { wall: 'cream', roof: 'hip', roofColor: 0xb9533f };
  if (z === 'B') return { wall: 'classic', roof: 'flat', roofColor: 0xc5ccd5, parapet: 0xf3f4f6 };
  if (z) return { wall: 'corridor', roof: 'flat', roofColor: 0xc3c9d1, parapet: 0xf5f3ee };
  if (b.kind === 'dormitory') return { wall: 'dorm', roof: 'flat', roofColor: 0xd7a46d, parapet: 0xefdcc0 };
  if (b.kind === 'sports_hall') return { wall: 'hall', roof: 'flat', roofColor: 0x6f93c8, parapet: 0xdfe6ee };
  return { wall: 'plain', roof: 'flat', roofColor: 0xc5ccd4, parapet: 0xece6da };
}

const WALLS = {
  corridor: { base: '#f4f2ec', kind: 'corridor' },
  cream: { base: '#efe2c4', kind: 'window', win: '#6f8aa6', frame: '#fbf7ee' },
  brick: { base: '#b8724c', kind: 'window', win: '#5f7896', frame: '#f3e6d4', brick: true },
  classic: { base: '#eef1f4', kind: 'window', win: '#6d8fb2', frame: '#ffffff', wide: true },
  glass: { base: '#f1f3f5', kind: 'glass', win: '#5c8fc0' },
  glassLight: { base: '#f6f7f8', kind: 'window', win: '#7fa9cf', frame: '#ffffff', wide: true, tall: true },
  dorm: { base: '#ecd8b5', kind: 'corridor', rail: '#f7ead2', shade: '#8b7a66' },
  hall: { base: '#dde5ee', kind: 'window', win: '#7b97b8', frame: '#f4f7fa', wide: true },
  plain: { base: '#e7dcc5', kind: 'window', win: '#7d8fa3', frame: '#f6f0e3' },
};

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

/** Facade texture (colour) + night texture (lit windows) for one style. */
function facadeTextures(style, seed) {
  const W = 256, H = 144, bayW = W / 3, floorH = H / TILE_FLOORS; // 3 bays x 2 floors
  const day = document.createElement('canvas'), night = document.createElement('canvas');
  day.width = night.width = W; day.height = night.height = H;
  const g = day.getContext('2d'), n = night.getContext('2d');
  const s = WALLS[style];
  const rand = rng(seed);
  g.fillStyle = s.base; g.fillRect(0, 0, W, H);
  n.fillStyle = '#000'; n.fillRect(0, 0, W, H);
  if (s.brick) {
    g.strokeStyle = 'rgba(80,40,20,0.18)'; g.lineWidth = 1;
    for (let y = 3; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  for (let f = 0; f < TILE_FLOORS; f++) {
    const y0 = f * floorH;
    if (s.kind === 'corridor') {
      // open corridor: dark recess with doors, white railing band in front, slab line
      g.fillStyle = s.shade || '#7c8796'; g.fillRect(0, y0 + floorH * 0.18, W, floorH * 0.62);
      for (let b = 0; b < 3; b++) {
        g.fillStyle = '#5d6b7e'; g.fillRect(b * bayW + bayW * 0.3, y0 + floorH * 0.24, bayW * 0.22, floorH * 0.56);
        g.fillStyle = '#9fb3c8'; g.fillRect(b * bayW + bayW * 0.62, y0 + floorH * 0.28, bayW * 0.26, floorH * 0.26);
        if (rand() > 0.35) { n.fillStyle = '#ffd78a'; n.fillRect(b * bayW + bayW * 0.62, y0 + floorH * 0.28, bayW * 0.26, floorH * 0.26); }
        g.fillStyle = s.base; g.fillRect(b * bayW, y0 + floorH * 0.18, bayW * 0.06, floorH * 0.62); // columns
      }
      g.fillStyle = s.rail || '#ffffff'; g.fillRect(0, y0 + floorH * 0.58, W, floorH * 0.24);
      n.fillStyle = 'rgba(255,215,140,0.25)'; n.fillRect(0, y0 + floorH * 0.18, W, floorH * 0.4);
    } else if (s.kind === 'glass') {
      // Nhà S: cyan-blue glass ribbon windows between white floor spandrels
      g.fillStyle = s.base; g.fillRect(0, y0, W, floorH);
      const gy = y0 + floorH * 0.3, gh = floorH * 0.62;
      const grd = g.createLinearGradient(0, gy, 0, gy + gh);
      grd.addColorStop(0, '#b4e2f5'); grd.addColorStop(0.5, '#6db9e3'); grd.addColorStop(1, '#3d8ccc');
      g.fillStyle = grd; g.fillRect(0, gy, W, gh);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let x = 0; x <= W; x += W / 8) g.fillRect(x - 1, gy, 2, gh);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, gy + gh, W, 3);
      for (let k = 0; k < 8; k++) if (rand() > 0.3) { n.fillStyle = '#ffe1a0'; n.fillRect(k * W / 8 + 2, gy + 2, W / 8 - 4, gh - 4); }
    } else {
      for (let b = 0; b < 3; b++) {
        const ww = bayW * (s.wide ? 0.66 : 0.46), wh = floorH * (s.tall ? 0.66 : 0.5);
        const x = b * bayW + (bayW - ww) / 2, y = y0 + floorH * (s.tall ? 0.16 : 0.22);
        g.fillStyle = s.frame; g.fillRect(x - 3, y - 3, ww + 6, wh + 6);
        g.fillStyle = s.win; g.fillRect(x, y, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, y, ww, wh * 0.18); // sky reflection
        g.fillStyle = s.frame; g.fillRect(x + ww / 2 - 1.5, y, 3, wh);       // mullion
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x - 4, y + wh + 3, ww + 8, 3); // sill shadow
        if (rand() > 0.38) { n.fillStyle = '#ffd78a'; n.fillRect(x, y, ww, wh); }
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, y0 + floorH - 3, W, 3); // floor slab line
  }
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / TILE_W, 1 / (TILE_FLOORS * FLOOR_H));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(day), glow: mk(night) };
}

/** One wall material per facade style (shared by all buildings of that style). */
export function wallMaterials() {
  const mats = {};
  Object.keys(WALLS).forEach((k, i) => {
    const t = facadeTextures(k, 1000 + i * 77);
    mats[k] = new THREE.MeshLambertMaterial({ color: 0xffffff, map: t.map, emissive: 0xffffff, emissiveMap: t.glow, emissiveIntensity: 0 });
  });
  return {
    get: (k) => mats[k] || mats.plain,
    setNight(on, wallTint) {
      for (const m of Object.values(mats)) { m.emissiveIntensity = on ? 0.95 : 0; m.color.set(wallTint); }
    },
  };
}

// ---------------- polygon helpers ----------------
function signedArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
export function insideP(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Offset a polygon: d > 0 grows it, d < 0 shrinks it. Returns null if the result folds over itself. */
export function offsetPoly(pts, d) {
  const n = pts.length;
  const s = signedArea(pts) > 0 ? 1 : -1; // orientation -> which side is "outside"
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = dz * s, nz = -dx * s; // outward normal
    lines.push({ ax: a[0] + nx * d, az: a[1] + nz * d, dx, dz });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const den = l1.dx * l2.dz - l1.dz * l2.dx;
    let x, z;
    if (Math.abs(den) < 1e-4) { x = l2.ax; z = l2.az; }
    else {
      const t = ((l2.ax - l1.ax) * l2.dz - (l2.az - l1.az) * l2.dx) / den;
      x = l1.ax + l1.dx * t; z = l1.az + l1.dz * t;
    }
    const ox = pts[i][0], oz = pts[i][1];
    const m = Math.hypot(x - ox, z - oz), lim = Math.abs(d) * 3;
    if (m > lim) { x = ox + (x - ox) * lim / m; z = oz + (z - oz) * lim / m; }
    out.push([x, z]);
  }
  // validity: every edge keeps its direction and the area changes the right way
  for (let i = 0; i < n; i++) {
    const a = out[i], b = out[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    if (ex * lines[i].dx + ez * lines[i].dz <= 0.05) return null;
  }
  const A0 = Math.abs(signedArea(pts)), A1 = Math.abs(signedArea(out));
  if (Math.sign(signedArea(out)) !== Math.sign(signedArea(pts)) || (d < 0 ? A1 >= A0 : A1 <= A0)) return null;
  return out;
}
const perimeter = (p) => p.reduce((s, q, i) => s + Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]), 0);

// ---------------- merged vertex-coloured geometry ----------------
export class Builder {
  constructor() { this.pos = []; this.col = []; this.c = new THREE.Color(); }
  color(hex) { this.c.set(hex); return this; }
  tri(a, b, c) {
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r, this.c.g, this.c.b); }
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** vertical band along a closed ring from y0 to y1 */
  band(ring, y0, y1) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
    }
  }
  /** flat cap of a polygon at height y */
  cap(ring, y) {
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) this.tri([ring[i][0], y, ring[i][1]], [ring[j][0], y, ring[j][1]], [ring[k][0], y, ring[k][1]]);
  }
  /** flat ring between an outer and an inner ring (same vertex count) at height y */
  ringCap(outer, inner, y) {
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      this.quad([outer[i][0], y, outer[i][1]], [outer[j][0], y, outer[j][1]], [inner[j][0], y, inner[j][1]], [inner[i][0], y, inner[i][1]]);
    }
  }
  box(cx, cz, w, d, y0, h, ang = 0) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (x, z) => [cx + x * c - z * s, cz + x * s + z * c];
    const r = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    this.band(r, y0, y0 + h);
    this.cap(r, y0 + h);
  }
  get tris() { return this.pos.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
  mesh(opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...opts }));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); };

/**
 * Roofs, parapets, plinths and rooftop units for every building.
 * Returns { mesh, pick(faceIndex) -> building } so clicks on a roof still select the building.
 */
const outEdge = (pts, i) => {
  const a = pts[i], c = pts[(i + 1) % pts.length];
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let nx = uz, nz = -ux;
  if (insideP(pts, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
  return { a, c, L, ux, uz, mx, mz, nx, nz, ang: Math.atan2(uz, ux), rot: Math.atan2(nx, nz) };
};
const SERIF = '"Times New Roman", "Noto Serif", Georgia, serif';
/**
 * School name as raised blue serif letters (as on the Nhà S facade): transparent background so it sits
 * on whatever is behind it; `band` adds the white band. The letters glow blue at night.
 */
function nameSign(w, h, band = false) {
  const W = 2048, H = Math.max(96, Math.round((W * h) / w));
  const draw = (g, color, glow) => {
    g.clearRect(0, 0, W, H);
    if (glow) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    else if (band) { g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, W, H); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = Math.round(H * 0.82);
    do { g.font = `bold ${px}px ${SERIF}`; px -= 2; } while (g.measureText('TRƯỜNG ĐẠI HỌC BÁCH KHOA').width > W - 30 && px > 10);
    if (!glow) { g.fillStyle = 'rgba(10,20,60,0.35)'; g.fillText('TRƯỜNG ĐẠI HỌC BÁCH KHOA', W / 2 + 3, H / 2 + 5); } // raised-letter shadow
    g.fillStyle = color; g.fillText('TRƯỜNG ĐẠI HỌC BÁCH KHOA', W / 2, H / 2 + 2);
  };
  const day = canvasTex(W, H, (g) => draw(g, '#2340b0', false));
  const glow = canvasTex(W, H, (g) => draw(g, '#3f6bff', true));
  return new THREE.MeshLambertMaterial({ map: day, transparent: !band, alphaTest: band ? 0 : 0.35, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0, depthWrite: band });
}
function logoMaterial() {
  const t = emblemTex();
  return new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 });
}

/**
 * Nhà S (smart building) after photos: white frame, cyan glass ribbons, wide white roof slabs,
 * a central core with grey vertical louvres over the main door rising above the roof, the emblem on top
 * of the core, "TRƯỜNG ĐẠI HỌC BÁCH KHOA" in blue serif letters on a white band across the top floor,
 * and two Vietnamese flags on vertical poles below the lettering. Emblem and letters light up at night.
 */
function towerS(b, B, group, glowMats) {
  const h = b.height, pts = b.pts;
  const E = outEdge(pts, b.entrance_edge ?? 0);
  // u along the front, n outwards; the core sits 1 m proud of the footprint so its recess stays in front of the wall
  const at = (u, n) => [E.mx + E.ux * u + E.nx * (n + 1), E.mz + E.uz * u + E.nz * (n + 1)];
  // white corner piers (not at the core: the lettering band runs across it)
  B.color(0xf3f5f7);
  pts.forEach((p, i) => {
    const du = (p[0] - E.mx) * E.ux + (p[1] - E.mz) * E.uz;
    if (Math.abs(du) < E.L / 2 + 2) return;
    const e = outEdge(pts, i); B.box(p[0], p[1], 1.2, 1.2, 0, h, e.ang);
  });
  // wide white roof slab (cantilever) + a thinner second slab
  const slab = offsetPoly(pts, 1.6) || pts;
  B.color(0xf5f7f9); B.band(slab, h - 0.1, h + 0.6); B.cap(slab, h + 0.6); B.cap(slab, h - 0.1);
  const slab2 = offsetPoly(pts, 0.9) || pts;
  B.color(0xe9edf1); B.band(slab2, h - 3.85, h - 3.55); B.cap(slab2, h - 3.55); B.cap(slab2, h - 3.85);

  // central core: two white pilasters proud of the walls with the grey louvre strip RECESSED between them
  const depth = 9, top = h + 4.2, half = E.L / 2 + 0.2, LW = 3.4, REC = -0.8;
  B.color(0xeef0f3);
  const coreBack = [at(-half, REC), at(half, REC), at(half, -depth), at(-half, -depth)];
  B.band(coreBack, 0, top); B.cap(coreBack, top);
  for (const sd of [-1, 1]) {
    const pil = [at(sd * half, 0.3), at(sd * LW / 2, 0.3), at(sd * LW / 2, REC - 0.05), at(sd * half, REC - 0.05)];
    B.band(pil, 0, top); B.cap(pil, top);
  }
  const coreTop = offsetPoly([at(-half, 0.3), at(half, 0.3), at(half, -depth), at(-half, -depth)], 0.5);
  if (coreTop) { B.color(0xf8f9fa); B.band(coreTop, top, top + 0.5); B.cap(coreTop, top + 0.5); B.cap(coreTop, top); }
  // louvres inside the recess: dark backing + light horizontal-looking vertical fins, canopy up to the roof
  const [lx, lz] = at(0, REC + 0.05);
  B.color(0x8d96a1); B.box(lx, lz, LW, 0.1, 4.3, top - 0.4 - 4.3, E.ang);
  B.color(0xd4d9df);
  for (let k = -5; k <= 5; k++) { const [fx, fz] = at(k * 0.3, REC + 0.2); B.box(fx, fz, 0.07, 0.2, 4.3, top - 0.4 - 4.3, E.ang); }
  // glass lobby + entrance canopy at the main door
  const [gx, gz] = at(0, 0.4);
  B.color(0x7fb9de); B.box(gx, gz, E.L - 1.2, 0.2, 0.2, 3.6, E.ang);
  const [cx, cz] = at(0, 2.4);
  B.color(0xf7f7f5); B.box(cx, cz, E.L + 1, 4.4, 3.9, 0.4, E.ang);
  B.color(0xdedbd3);
  for (const sx of [-E.L / 2, E.L / 2]) { const [px, pz] = at(sx, 4.2); B.box(px, pz, 0.35, 0.35, 0, 3.9, E.ang); }

  // white band across the top floor carrying the school name; it is CUT at the core so the emblem shows
  const bandW = Math.min(30, E.L + 22), bandY0 = h - 3.4, bandH = 2.3;
  B.color(0xf4f6f8);
  for (const sd of [-1, 1]) {
    const w = bandW / 2 - half;
    const [bx, bz] = at(sd * (half + w / 2), 0.45 - 2.875);
    B.box(bx, bz, w, 5.75, bandY0, bandH, E.ang);
  }
  const text = new THREE.Mesh(new THREE.PlaneGeometry(bandW - 2, 1.85), nameSign(bandW - 2, 1.85));
  const [tx, tz] = at(0, 0.45 + 0.06);
  text.position.set(tx, bandY0 + bandH / 2, tz);
  text.rotation.y = E.rot;
  text.renderOrder = 2;
  group.add(text); glowMats.push(text.material);

  // emblem at the top of the core, in front of everything, its lower edge just above the lettering
  const LOGO = 4.6;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(LOGO, LOGO * LOGO_ASPECT), logoMaterial());
  const [ex, ez] = at(0, 0.62);
  logo.position.set(ex, bandY0 + bandH + 0.15 + LOGO / 2, ez);
  logo.rotation.y = E.rot;
  group.add(logo); glowMats.push(logo.material);
  B.color(0xe6e9ed); { const [qx, qz] = at(0, 0.45); B.box(qx, qz, LOGO + 0.3, 0.3, bandY0 + bandH + 0.05, LOGO + 0.2, E.ang); } // panel frame

  // two Vietnamese flags on vertical poles standing in the louvre recess, centred on the core
  const flagMat = new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide });
  const POLE_TOP = 17.8, FW = 1.2, FH = 0.8;
  for (const u of [-0.15, 1.35]) {
    const [px, pz] = at(u, -0.25);
    B.color(0xd9dde2); B.box(px, pz, 0.08, 0.08, 4.3, POLE_TOP - 4.3, E.ang);   // pole from the canopy up
    B.color(0xf1c40f); B.box(px, pz, 0.14, 0.14, POLE_TOP, 0.12, E.ang);        // finial
    const f = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), flagMat);
    const [fx, fz] = at(u - FW / 2 - 0.05, -0.25);
    f.position.set(fx, POLE_TOP - FH / 2 - 0.05, fz);
    f.rotation.y = E.rot;
    group.add(f);
  }

  // the name again on the left side face, on a white band (seen in the side photos)
  const left = outEdge(pts, ((b.entrance_edge ?? 0) + pts.length - 3) % pts.length);
  {
    const w = Math.min(left.L - 2, 18), hh = 1.7;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), nameSign(w, hh, true));
    m.position.set(left.mx + left.nx * 0.12, h - 2.2, left.mz + left.nz * 0.12);
    m.rotation.y = left.rot;
    group.add(m); glowMats.push(m.material);
  }
}

export function buildBuildingDetails(buildings) {
  const extras = new THREE.Group();
  const glowMats = [];
  const B = new Builder();
  const ranges = [];
  const rand = rng(77);
  for (const b of buildings) {
    const start = B.tris;
    if (b.hollow) { ranges.push([start, start, b]); continue; } // walk-in building: built by interiors.js
    const st = styleOf(b);
    const wallHex = WALLS[st.wall].base;
    const h = b.height;
    // plinth: darker band at the foot of the walls
    const plinth = offsetPoly(b.pts, 0.12);
    if (plinth) { B.color(shade(wallHex, 0.72)); B.band(plinth, 0, 0.9); B.ringCap(plinth, b.pts, 0.9); }
    if (b.zone === 'S') { towerS(b, B, extras, glowMats); ranges.push([start, B.tris, b]); continue; }

    const rp = b.roofPts || b.pts; // E1: the roof also covers the open corridor
    const thickness = (2 * Math.abs(signedArea(rp))) / (perimeter(rp) || 1);
    let roofDone = false;
    if (st.roof === 'hip') {
      // pitched roof: eaves overhang, then slopes up to an inset ridge outline
      const eave = offsetPoly(rp, 0.7) || rp;
      for (const k of [0.46, 0.38, 0.3, 0.22, 0.15, 0.1]) {
        const inset = offsetPoly(rp, -thickness * k);
        if (!inset) continue;
        const rise = thickness * k * 0.62;
        B.color(shade(st.roofColor, 0.82)); B.band(eave, h - 0.25, h + 0.05);          // fascia
        B.color(st.roofColor);
        for (let i = 0; i < eave.length; i++) {
          const j = (i + 1) % eave.length;
          B.quad([eave[i][0], h + 0.05, eave[i][1]], [eave[j][0], h + 0.05, eave[j][1]], [inset[j][0], h + rise, inset[j][1]], [inset[i][0], h + rise, inset[i][1]]);
        }
        B.color(shade(st.roofColor, 1.06)); B.cap(inset, h + rise);
        roofDone = true;
        break;
      }
    }
    if (!roofDone) {
      // flat roof with a parapet wall and a lighter roof deck
      const inner = offsetPoly(b.pts, -0.35);
      if (inner) {
        B.color(st.parapet || wallHex); B.band(b.pts, h, h + 0.9); B.ringCap(b.pts, inner, h + 0.9);
        B.color(shade(st.parapet || wallHex, 0.85)); B.band(inner, h + 0.05, h + 0.9);
        B.color(st.roofColor); B.cap(inner, h + 0.06);
      }
      // rooftop units on bigger flat roofs: stair house + water tanks / AC boxes
      const area = Math.abs(signedArea(b.pts));
      if (area > 300) {
        const n = Math.min(4, 1 + Math.floor(area / 900));
        const bb = b.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);
        let placed = 0;
        for (let tries = 0; tries < 40 && placed < n; tries++) {
          const x = bb[0] + rand() * (bb[1] - bb[0]), z = bb[2] + rand() * (bb[3] - bb[2]);
          if (!inner || !insideP(inner, x, z) || !insideP(inner, x + 2.5, z) || !insideP(inner, x - 2.5, z) || !insideP(inner, x, z + 2.5) || !insideP(inner, x, z - 2.5)) continue;
          if (placed === 0) { B.color(0xe9e6df); B.box(x, z, 4, 3.2, h, 2.8); B.color(0x9aa3ad); B.box(x, z, 4.3, 3.5, h + 2.8, 0.25); }
          else { B.color(placed % 2 ? 0x8f99a5 : 0xb7c0ca); B.box(x, z, 1.8, 1.4, h, 1.1); }
          placed++;
        }
      }
    }
    // entrance canopy on the "front" (bottom of the map) of large zone buildings
    if (b.zone && !b.corridor && Math.abs(signedArea(b.pts)) > 700) {
      let best = null;
      if (b.entrance_edge != null) { const e = outEdge(b.pts, b.entrance_edge); best = { a: e.a, c: e.c, L: e.L, mz: e.mz }; }
      for (let i = 0; i < b.pts.length && b.entrance_edge == null; i++) {
        const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 8) continue;
        const mz = (a[1] + c[1]) / 2;
        if (!best || mz > best.mz) best = { a, c, L, mz };
      }
      if (best) {
        const mx = (best.a[0] + best.c[0]) / 2, mz = best.mz;
        const ang = Math.atan2(best.c[1] - best.a[1], best.c[0] - best.a[0]);
        let nx = Math.sin(ang), nz = -Math.cos(ang);
        if (insideP(b.pts, mx + nx * 1.5, mz + nz * 1.5)) { nx = -nx; nz = -nz; }
        const cx = mx + nx * 1.6, cz = mz + nz * 1.6;
        B.color(0xf7f7f5); B.box(cx, cz, 6.5, 3.4, 3.3, 0.35, ang);
        B.color(0xdedbd3);
        for (const sx of [-2.9, 2.9]) B.box(cx + Math.cos(ang) * sx + nx * 1.3, cz + Math.sin(ang) * sx + nz * 1.3, 0.35, 0.35, 0, 3.3, ang);
      }
    }
    ranges.push([start, B.tris, b]);
  }
  const mesh = B.mesh();
  return {
    mesh,
    extras,
    setNight(on) { for (const m of glowMats) m.emissiveIntensity = on ? 1 : 0; },
    pick(face) { for (const [a, z, b] of ranges) if (face >= a && face < z) return b; return null; },
  };
}

/** Perimeter wall (white wall with a darker coping) along data.walls polylines, with pillars at openings.
 *  heights[i] = height of wall i when it is not the usual 2.1 m (the stadium wall is taller). */
export function buildWalls(walls, posts = [], heights = []) {
  const B = new Builder();
  const T = 0.28;
  for (const [wi, w] of walls.entries()) {
    const H = heights[wi] || 2.1;
    for (let i = 0; i < w.length - 1; i++) {
      const [ax, az] = w[i], [bx, bz] = w[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const ang = Math.atan2(bz - az, bx - ax);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      B.color(0xf1efe9); B.box(cx, cz, L + T, T, 0, H, ang);
      B.color(0x9aa0a8); B.box(cx, cz, L + T, T + 0.12, H, 0.16, ang);
      if (i % 2 === 0) { B.color(0xe3e0d8); B.box(ax, az, 0.5, 0.5, 0, H + 0.3, ang); }
    }
  }
  // gate pillars where a road passes through the fence
  for (const [x, z] of posts) {
    B.color(0xe7e2d8); B.box(x, z, 0.8, 0.8, 0, 2.7, 0);
    B.color(0xb9b3a7); B.box(x, z, 1.0, 1.0, 2.7, 0.2, 0);
  }
  return B.mesh();
}

// ---------------- gates ----------------
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** fillText that shrinks the font until the text fits maxW. */
function fitText(g, text, x, y, maxW, weight, size) {
  let px = size;
  do { g.font = `${weight} ${px}px ${FONT}`; px -= 2; } while (g.measureText(text).width > maxW && px > 10);
  g.fillText(text, x, y);
}
/**
 * The school emblem is the official image (img/dut-logo.jpg), never redrawn: it is the university's identity.
 * Canvas textures that include it are drawn again once the image has loaded; the map re-renders on 'cs-redraw'.
 */
export const LOGO_SRC = '/img/dut-logo.jpg', LOGO_ASPECT = 386 / 392; // height / width of the image
let logoImg = null;
const logoWait = [];
function onLogo(fn) {
  if (!logoImg) {
    logoImg = new Image();
    logoImg.onload = () => { for (const f of logoWait.splice(0)) f(); window.dispatchEvent(new Event('cs-redraw')); };
    logoImg.src = LOGO_SRC;
  }
  if (logoImg.complete && logoImg.naturalWidth) fn(); else logoWait.push(fn);
}
/** Draw the emblem `s` wide with its top-left corner at (x, y) (nothing until the image has loaded). */
function drawEmblem(g, x, y, s) {
  if (logoImg?.complete && logoImg.naturalWidth) g.drawImage(logoImg, x, y, s, s * LOGO_ASPECT);
}
/** Canvas texture whose drawing includes the emblem: drawn now, and again when the image is ready. */
function canvasTexWithLogo(w, h, draw) {
  const t = canvasTex(w, h, draw);
  onLogo(() => { const g = t.image.getContext('2d'); g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; });
  return t;
}
let emblemShared = null;
/** The emblem image as a texture (shared). */
function emblemTex() {
  if (!emblemShared) {
    emblemShared = new THREE.TextureLoader().load(LOGO_SRC, () => window.dispatchEvent(new Event('cs-redraw')));
    emblemShared.colorSpace = THREE.SRGBColorSpace; emblemShared.anisotropy = 8;
  }
  return emblemShared;
}
/** Granite name sign (right of the main gate): pink-brown granite, bevelled frame, engraved white lettering. */
const stoneSignTex = () => canvasTex(1024, 412, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#b56a55'); grd.addColorStop(1, '#a05442');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const rnd = rng(99);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,235,225' : '60,25,20'},${0.05 + rnd() * 0.08})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } // granite speckle
  g.strokeStyle = 'rgba(255,240,230,0.35)'; g.lineWidth = 6; g.strokeRect(16, 16, w - 32, h - 32);
  const engraved = (text, x, y, maxW, weight, size, align = 'center') => {
    g.textAlign = align; g.textBaseline = 'middle';
    let px = size;
    do { g.font = `${weight} ${px}px ${FONT}`; px -= 2; } while (g.measureText(text).width > maxW && px > 10);
    g.fillStyle = 'rgba(70,30,20,0.55)'; g.fillText(text, x + 2, y + 3);
    g.fillStyle = '#fbf6f0'; g.fillText(text, x, y);
  };
  engraved('ĐẠI HỌC ĐÀ NẴNG', w / 2, 58, 500, 800, 30);
  engraved('TRƯỜNG ĐẠI HỌC BÁCH KHOA', w / 2, 140, w - 90, 900, 82);
  engraved('UNIVERSITY OF SCIENCE AND TECHNOLOGY', w / 2, 222, w - 120, 800, 40);
  engraved('INSTITUT POLYTECHNIQUE DE DANANG', w / 2, 270, w - 200, 800, 36);
  engraved('54 Nguyễn Lương Bằng', 70, 352, 420, 700, 28, 'left');
  engraved('ĐT: 0236.3842308', w - 70, 352, 360, 700, 28, 'right');
});
/** Blue billboard over the guard house (left of the main gate). */
const billboardTex = () => canvasTexWithLogo(512, 640, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#2457c5'); grd.addColorStop(1, '#173f99');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  drawEmblem(g, w / 2 - 60, 40, 120);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, 'ĐẠI HỌC ĐÀ NẴNG', w / 2, 220, w - 60, 800, 38);
  fitText(g, 'TRƯỜNG ĐẠI HỌC', w / 2, 300, w - 60, 900, 52);
  fitText(g, 'BÁCH KHOA', w / 2, 366, w - 60, 900, 52);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(40, 420, w - 80, 4);
});
const flagTex = () => canvasTex(300, 200, (g, w, h) => {
  g.fillStyle = '#da251d'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffde00'; g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 26 : 62, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
});
/** Plain sign for the side gate. */
const sideSignTex = () => canvasTex(1024, 160, (g, w, h) => {
  g.fillStyle = '#1d47ad'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 64px ${FONT}`; g.fillText('CỔNG PHỤ', w / 2, 66);
  g.font = `700 30px ${FONT}`; g.fillStyle = '#dbe6ff'; g.fillText('Trường Đại học Bách khoa – ĐHĐN', w / 2, 122);
});

/** Textured box (same texture on the given faces, plain colour elsewhere). */
function texturedPanel(w, h, d, tex, color = 0xffffff, both = true) {
  const plain = new THREE.MeshLambertMaterial({ color });
  const face = new THREE.MeshLambertMaterial({ map: tex });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [plain, plain, plain, plain, face, both ? face : plain]);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * Gates. The main gate follows photos of the real one (no overhead arch):
 *  left (seen from the street): pale-blue guard house with a white portico, a tall blue billboard and a flag pole;
 *  right: a tall white ribbed column with an emblem cube on top, and a terracotta stone sign on a planter.
 * The side gate keeps a simple two-pillar frame with a sign.
 * Returns { group, solids } – solids are footprints the walking student collides with.
 */
export function buildGates(pois) {
  const group = new THREE.Group();
  const B = new Builder();
  const solids = [];
  const rect = (cx, cz, w, d, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
  };
  for (const p of pois.filter((x) => x.kind === 'gate' && x.dir)) {
    // The gate spans the boundary edge(s) crossing the entrance road: centre, inward direction f, width.
    const [x, z] = p.center || p.at;
    const [fx, fz] = p.dir;                 // into the campus
    const rx = -fz, rz = fx;                // right-hand side for someone outside looking in
    const across = Math.atan2(rz, rx);      // box local x runs across the entrance
    const half = (p.width || 13) / 2;
    const P = (side, fwd) => [x + rx * side + fx * fwd, z + rz * side + fz * fwd];
    const faceOut = Math.atan2(-fx, -fz);   // rotation.y so a mesh's +z faces the street

    if (p.id !== 'gate-main') {
      // side gate: two pillars at the ends of the opening, a beam and a sign facing the street only
      const H = 5;
      B.color(0xe9e4da);
      for (const sd of [-1, 1]) { const [px, pz] = P(half * sd, 0); B.box(px, pz, 1.2, 1.2, 0, H, across); solids.push(rect(px, pz, 1.2, 1.2, across)); }
      B.color(0xc2bcb0);
      for (const sd of [-1, 1]) { const [px, pz] = P(half * sd, 0); B.box(px, pz, 1.45, 1.45, H, 0.3, across); }
      B.color(0x1d47ad); B.box(x, z, half * 2 + 1.2, 0.6, H - 1.8, 1.5, across);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 1, 1.25), new THREE.MeshBasicMaterial({ map: sideSignTex() }));
      sign.position.set(x - fx * 0.32, H - 1.05, z - fz * 0.32);
      sign.rotation.y = faceOut;
      group.add(sign);
      continue;
    }

    // ---- main gate (after photos): no arch. Opening = the whole mouth of the entrance strip. ----
    // LEFT, just outside the strip wall: pale-blue guard house with a white portico reaching over the kerb,
    // a tall blue billboard facing the driveway, a flag pole.
    {
      const gw = 6, gd = 6.5, gs = -(half + 0.15 + gw / 2), gf = 2.6;
      const [gx, gz] = P(gs, gf);
      B.color(0xa9d6ea); B.box(gx, gz, gw, gd, 0, 3.4, across);                       // house
      B.color(0x8fc3dc); B.box(gx, gz, gw + 0.3, gd + 0.3, 3.4, 0.35, across);        // roof slab
      { const [wx, wz] = P(gs + gw / 2 + 0.02, gf); B.color(0x6e8ea8); B.box(wx, wz, 0.05, 3.2, 1.0, 1.4, across); } // window to the road
      { const [dx, dz] = P(gs + 1.2, gf - gd / 2 - 0.02); B.color(0x7a6a58); B.box(dx, dz, 1.0, 0.05, 0.25, 2.1, across); } // door
      B.color(0xb85c46); B.box(gx, gz, gw + 0.6, gd + 0.6, 0, 0.25, across);          // red tiled step
      solids.push(rect(gx, gz, gw, gd, across));
      // white portico: thick slab + two square columns standing on the kerb inside the gate
      const pw = 2.6, ps = -(half - pw / 2 + 0.6);
      { const [px, pz] = P(ps, gf); B.color(0xf7f7f5); B.box(px, pz, pw + 1.2, 4.4, 3.25, 0.7, across); }
      for (const fw of [-1.7, 1.7]) { const [cx, cz] = P(-(half - 0.55), gf + fw); B.color(0xf7f7f5); B.box(cx, cz, 0.55, 0.55, 0, 3.25, across); solids.push(rect(cx, cz, 0.55, 0.55, across)); }
      // tall blue billboard beside the guard house, panel running along the driveway, face toward the road
      const alongF = Math.atan2(fz, fx);
      const bs = gs - gw / 2 - 0.5;
      const [bx, bz] = P(bs, 2.2);
      const board = texturedPanel(5.2, 6.6, 0.5, billboardTex(), 0x1d4fb8, false);
      board.position.set(bx, 3.3 + 2.4, bz);
      board.rotation.y = Math.atan2(-fz, fx);
      group.add(board);
      B.color(0x1d4fb8); B.box(bx, bz, 5.2, 0.5, 0, 2.4, alongF);
      solids.push(rect(bx, bz, 5.2, 0.6, alongF));
      const [fpx, fpz] = P(bs, 2.2 + 2.45);
      B.color(0xd9dde3); B.box(fpx, fpz, 0.12, 0.12, 9, 4.2, alongF);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide }));
      const [flx, flz] = P(bs, 2.2 + 2.45 - 0.95);
      flag.position.set(flx, 12.5, flz);
      flag.rotation.y = Math.atan2(-fz, fx);
      group.add(flag);
    }

    // RIGHT (after the photos): slim white column at the corner of the driveway, a louvred neck and a white
    // cube with the emblem on every face; next to it a small white pillar, then the granite name sign on a
    // curved planter in front of a white rail fence — all in one line along the street.
    {
      const [cx, cz] = P(half - 0.8, 0.6);
      const white = new THREE.MeshLambertMaterial({ color: 0xf4f5f6 });
      const groove = new THREE.MeshLambertMaterial({ color: 0xc9ced4 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 7.3, 24), white);
      shaft.position.set(cx, 3.65, cz); shaft.castShadow = true; group.add(shaft);
      for (const y of [1.45, 2.9, 4.35, 5.8]) {                          // joints between the precast segments
        const j = new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.445, 0.05, 24), groove); j.position.set(cx, y, cz); group.add(j);
      }
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.25, 16), groove);
      core.position.set(cx, 7.9, cz); group.add(core);
      for (let k = 0; k < 10; k++) {                                     // louvred neck under the cube
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.055, 24), white); d.position.set(cx, 7.32 + k * 0.125, cz); group.add(d);
      }
      const C = 1.45, cy = 8.6 + C / 2;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(C, C, C), white);
      cube.position.set(cx, cy, cz); cube.rotation.y = faceOut; cube.castShadow = true; group.add(cube);
      const logoMat = new THREE.MeshLambertMaterial({ map: emblemTex() });
      for (let k = 0; k < 4; k++) {                                      // emblem inset on each face, white frame around
        const m = new THREE.Mesh(new THREE.PlaneGeometry(C * 0.84, C * 0.84 * LOGO_ASPECT), logoMat);
        const a2 = faceOut + (k * Math.PI) / 2;
        m.position.set(cx + Math.sin(a2) * (C / 2 + 0.005), cy, cz + Math.cos(a2) * (C / 2 + 0.005));
        m.rotation.y = a2;
        group.add(m);
      }
      B.color(0xe7e9ec); B.box(cx, cz, 1.05, 1.05, 0, 0.25, across);
      solids.push(rect(cx, cz, 1.0, 1.0, across));
      // small white box with the emblem at the foot of the column (street side)
      const [kx, kz] = P(half - 1.75, -0.2);
      B.color(0xf2f2f0); B.box(kx, kz, 0.5, 0.32, 0, 1.0, across);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32 * LOGO_ASPECT), logoMat);
      tag.position.set(kx - fx * 0.17, 0.72, kz - fz * 0.17); tag.rotation.y = faceOut; group.add(tag);
    }
    {
      const s0 = half + 0.15;                                            // the line continues to the right of the driveway
      // small square white pillar between the column and the sign
      const [qx, qz] = P(s0 + 0.35, 0.1);
      B.color(0xf3f3f1); B.box(qx, qz, 0.45, 0.45, 0, 2.5, across); B.color(0xdedcd6); B.box(qx, qz, 0.55, 0.55, 2.5, 0.08, across);
      solids.push(rect(qx, qz, 0.5, 0.5, across));
      // white rail fence behind the sign
      const fenceL = 9.5;
      B.color(0xf1f1ef);
      for (let u = 0.9; u <= fenceL; u += 1.6) { const [px, pz] = P(s0 + u, 0.1); B.box(px, pz, 0.12, 0.12, 0, 1.55, across); }
      B.color(0xd9dde2);
      for (const y of [0.45, 0.85, 1.25]) { const [px, pz] = P(s0 + 0.6 + fenceL / 2, 0.1); B.box(px, pz, fenceL, 0.05, y, 0.05, across); }
      solids.push(rect(...P(s0 + 0.6 + fenceL / 2, 0.1), fenceL, 0.25, across));
      // curved planter (round end toward the driveway) with grass
      const shape = (inset) => {
        const sh = new THREE.Shape();
        const u0 = s0 + 0.6 + inset, u1 = s0 + 0.6 + fenceL - inset, v0 = -0.25 - inset, v1 = -2.7 + inset, rr = 1.5 - inset * 0.6;
        // local (u = across, v = forward) -> shape coordinates in metres
        sh.moveTo(u0 + rr, v1); sh.lineTo(u1, v1); sh.lineTo(u1, v0); sh.lineTo(u0, v0); sh.lineTo(u0, v1 + rr);
        sh.quadraticCurveTo(u0, v1, u0 + rr, v1);
        return sh;
      };
      const toWorld = (geo, y) => {
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i), v = pos.getY(i), h = pos.getZ(i);
          const [wx, wz] = P(u, v);
          pos.setXYZ(i, wx, y + h, wz);
        }
        geo.computeVertexNormals();
        return geo;
      };
      const curb = new THREE.Mesh(toWorld(new THREE.ExtrudeGeometry(shape(0), { depth: 0.32, bevelEnabled: false }), 0), new THREE.MeshLambertMaterial({ color: 0xb4553f, side: THREE.DoubleSide }));
      curb.castShadow = curb.receiveShadow = true; group.add(curb);
      const grass = new THREE.Mesh(toWorld(new THREE.ShapeGeometry(shape(0.18)), 0.33), new THREE.MeshLambertMaterial({ color: 0x5fae4c, side: THREE.DoubleSide }));
      group.add(grass);
      solids.push(rect(...P(s0 + 0.6 + fenceL / 2, -1.45), fenceL, 2.5, across));
      // the granite sign: darker frame + engraved face, lettering only on the street side
      const SW = 6.2, SH = 2.5, [sx, sz] = P(s0 + 0.6 + fenceL * 0.55, -1.0);
      B.color(0x8b4535); B.box(sx, sz, SW + 0.3, 0.42, 0.32, SH + 0.3, across);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshLambertMaterial({ map: stoneSignTex() }));
      face.position.set(sx - fx * 0.215, 0.32 + 0.15 + SH / 2, sz - fz * 0.215);
      face.rotation.y = faceOut;
      group.add(face);
    }
  }
  group.add(B.mesh());
  return { group, solids };
}

/** Corrugated tin texture (UVs are in metres: one rib every 0.8 m). */
function tinTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#8ea3b8'); grd.addColorStop(0.45, '#c9d4de'); grd.addColorStop(0.55, '#d6dee6'); grd.addColorStop(1, '#8ea3b8');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 0.8, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Parked motorbikes in rows, filling a parking polygon (keeps the lots from looking empty). */
function parkBikes(B, pts, rand, fill, posts) {
  let best = 0, ang = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L > best) { best = L; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  }
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of pts) {
    const u = x * ux + z * uz, v = x * vx + z * vz;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const inner = offsetPoly(pts, -1.2) || pts;
  const COLORS = [0xc0392b, 0x1f2a44, 0xe9ecef, 0x2e86c1, 0x7f8c8d, 0x111111, 0xd35400, 0x8e44ad];
  for (let v = minV + 1.5; v < maxV - 1; v += 3.4) {          // rows (an aisle between every row)
    for (let u = minU + 0.6; u < maxU - 0.4; u += 0.82) {      // bikes side by side
      if (rand() > fill) continue;
      const x = u * ux + v * vx, z = u * uz + v * vz;
      if (!insideP(inner, x, z)) continue;
      const jitter = (rand() - 0.5) * 0.25;
      posts.push([x, z, 0.38]);
      B.color(0x1b1b1b); B.box(x, z, 0.12, 1.75, 0, 0.55, ang + jitter);                     // wheels
      B.color(COLORS[Math.floor(rand() * COLORS.length)]); B.box(x, z, 0.42, 1.25, 0.32, 0.45, ang + jitter); // body
      B.color(0x2b2b2b); B.box(x - vx * 0.15, z - vz * 0.15, 0.32, 0.6, 0.77, 0.1, ang + jitter);        // seat
      B.color(0x6b7280); B.box(x + vx * 0.72, z + vz * 0.72, 0.6, 0.06, 0.95, 0.06, ang + jitter);       // handlebar
    }
  }
}

/**
 * Parking lots inside the campus. cover:'roof' (or unspecified) -> tin roof on posts (nhà xe);
 * cover:'open' -> open-air motorbike lot, no roof. Both get rows of parked motorbikes.
 */
export function buildCanopies(areas, boundary) {
  const B = new Builder();
  const group = new THREE.Group();
  const tin = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tinTexture(), side: THREE.DoubleSide });
  const rand = rng(4242);
  const posts = []; // [x, z, radius] for the walker: parked bikes and roof posts
  const roofs = []; // tin roofs: fade when they stand between the camera and the student
  for (const a of areas.filter((x) => x.kind === 'parking')) {
    if (!a.pts.some(([x, z]) => insideP(boundary, x, z))) continue; // (centroid of an L-shaped lot can fall outside)
    const covered = a.cover !== 'open';
    parkBikes(B, a.pts, rand, covered ? 0.72 : 0.6, posts);
    if (!covered) continue;
    const roof = offsetPoly(a.pts, -0.6) || a.pts; // irregular lots: roof follows the lot outline
    const H = 3.3;
    // tin roof surface
    const shape = new THREE.Shape(roof.map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, H, 0);
    geo.addGroup(0, Infinity, 0);
    const m = new THREE.Mesh(geo, [tin]); // (material list: the roof fades when it hides the student, like buildings)
    m.castShadow = m.receiveShadow = true;
    m.userData.place = a.name || null;
    roofs.push(m);
    group.add(m);
    // fascia + steel posts every ~6 m along the edge
    B.color(0x6f8297); B.band(roof, H - 0.25, H);
    B.color(0x9aa5b1);
    for (let i = 0; i < roof.length; i++) {
      const p = roof[i], q = roof[(i + 1) % roof.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.floor(L / 6));
      for (let k = 0; k < n; k++) { const t = k / n; const px = p[0] + (q[0] - p[0]) * t, pz = p[1] + (q[1] - p[1]) * t; B.box(px, pz, 0.2, 0.2, 0, H - 0.2); posts.push([px, pz, 0.15]); }
    }
  }
  if (B.tris) group.add(B.mesh());
  return { group: group.children.length ? group : null, posts, roofs };
}

/** Street lamps along paths and service roads inside the campus. Returns an object with setNight(). */
export function buildLamps(roads, boundary, blocked) {
  const spots = [];
  for (const r of roads) {
    if (!(r.foot || r.w <= 6)) continue;
    let carry = 8;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (!L) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let d = carry; d < L; d += 24) {
        const off = r.w / 2 + 0.8;
        const x = ax + ux * d - uz * off, z = az + uz * d + ux * off;
        if (insideP(boundary, x, z) && !blocked(x, z) && !spots.some((s) => Math.abs(s[0] - x) + Math.abs(s[1] - z) < 10)) spots.push([x, z]);
        carry = d + 24 - L;
      }
      if (carry < 0) carry = 0;
    }
  }
  const poleG = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6); poleG.translate(0, 2.1, 0);
  const headG = new THREE.SphereGeometry(0.28, 10, 8); headG.translate(0, 4.35, 0);
  const pole = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x4b5563 }), spots.length);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf6f1e3, emissive: 0xffd27a, emissiveIntensity: 0 });
  const head = new THREE.InstancedMesh(headG, headMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); pole.setMatrixAt(i, m); head.setMatrixAt(i, m); });
  pole.castShadow = true;
  const group = new THREE.Group();
  group.add(pole, head);
  return { group, spots, count: spots.length, setNight(on) { headMat.emissiveIntensity = on ? 1.6 : 0; } };
}

/** Extra tree spots along vehicle roads inside the campus (avenue look). */
export function avenueTreeSpots(roads, boundary, blocked, rand) {
  const out = [];
  for (const r of roads) {
    if (r.foot || r.w > 8) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let d = 5; d < L - 3; d += 13) {
        for (const side of [-1, 1]) {
          const off = (r.w / 2 + 2.6) * side;
          const x = ax + ux * d - uz * off, z = az + uz * d + ux * off;
          if (!insideP(boundary, x, z) || blocked(x, z)) continue;
          out.push([x, z, 0.85 + rand() * 0.35, rand()]);
        }
      }
    }
  }
  return out;
}
