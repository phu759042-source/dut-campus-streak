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
  const z = b.zone;
  if (z === 'S') return { wall: 'glass', roof: 'flat', roofColor: 0xd5dbe2, parapet: 0xf2f4f6 };
  if (z === 'L') return { wall: 'glassLight', roof: 'hip', roofColor: 0x8cc3de };
  if (z === 'F') return { wall: 'brick', roof: 'hip', roofColor: 0xb4503c };
  if (['H', 'N', 'P', 'X', 'E1'].includes(z)) return { wall: 'cream', roof: 'hip', roofColor: 0xb9533f };
  if (z === 'B') return { wall: 'classic', roof: 'flat', roofColor: 0xc5ccd5, parapet: 0xf3f4f6 };
  if (z) return { wall: 'corridor', roof: 'flat', roofColor: 0xc3c9d1, parapet: 0xf5f3ee };
  if (b.kind === 'dormitory') return { wall: 'dorm', roof: 'flat', roofColor: 0xd7a46d, parapet: 0xefdcc0 };
  if (b.kind === 'sports_hall') return { wall: 'hall', roof: 'flat', roofColor: 0x6f93c8, parapet: 0xdfe6ee };
  return { wall: 'plain', roof: b.levels <= 3 ? 'hip' : 'flat', roofColor: b.levels <= 3 ? 0xa65a46 : 0xc9c3b6, parapet: 0xe7dcc5 };
}

const WALLS = {
  corridor: { base: '#f4f2ec', kind: 'corridor' },
  cream: { base: '#efe2c4', kind: 'window', win: '#6f8aa6', frame: '#fbf7ee' },
  brick: { base: '#b8724c', kind: 'window', win: '#5f7896', frame: '#f3e6d4', brick: true },
  classic: { base: '#eef1f4', kind: 'window', win: '#6d8fb2', frame: '#ffffff', wide: true },
  glass: { base: '#e9eef3', kind: 'glass', win: '#5c8fc0' },
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
      const grd = g.createLinearGradient(0, y0, 0, y0 + floorH);
      grd.addColorStop(0, '#7fb0dc'); grd.addColorStop(1, s.win);
      g.fillStyle = grd; g.fillRect(0, y0 + floorH * 0.1, W, floorH * 0.84);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let x = 0; x <= W; x += W / 6) g.fillRect(x - 1.5, y0, 3, floorH);
      g.fillStyle = s.base; g.fillRect(0, y0, W, floorH * 0.1);
      for (let k = 0; k < 6; k++) if (rand() > 0.3) { n.fillStyle = '#ffe1a0'; n.fillRect(k * W / 6 + 3, y0 + floorH * 0.14, W / 6 - 6, floorH * 0.76); }
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
function insideP(pts, x, z) {
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
class Builder {
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
export function buildBuildingDetails(buildings) {
  const B = new Builder();
  const ranges = [];
  const rand = rng(77);
  for (const b of buildings) {
    const start = B.tris;
    const st = styleOf(b);
    const wallHex = WALLS[st.wall].base;
    const h = b.height;
    // plinth: darker band at the foot of the walls
    const plinth = offsetPoly(b.pts, 0.12);
    if (plinth) { B.color(shade(wallHex, 0.72)); B.band(plinth, 0, 0.9); B.ringCap(plinth, b.pts, 0.9); }

    const thickness = (2 * Math.abs(signedArea(b.pts))) / (perimeter(b.pts) || 1);
    let roofDone = false;
    if (st.roof === 'hip') {
      // pitched roof: eaves overhang, then slopes up to an inset ridge outline
      const eave = offsetPoly(b.pts, 0.7) || b.pts;
      for (const k of [0.46, 0.38, 0.3, 0.22, 0.15, 0.1]) {
        const inset = offsetPoly(b.pts, -thickness * k);
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
    if (b.zone && Math.abs(signedArea(b.pts)) > 700) {
      let best = null;
      for (let i = 0; i < b.pts.length; i++) {
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
    pick(face) { for (const [a, z, b] of ranges) if (face >= a && face < z) return b; return null; },
  };
}

/** Perimeter wall (white wall with a darker coping) along data.walls polylines. */
export function buildWalls(walls) {
  const B = new Builder();
  const T = 0.28, H = 2.1;
  for (const w of walls) {
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
  return B.mesh();
}

/** Sign texture for a gate beam. */
function signTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 160); grd.addColorStop(0, '#1f4fbf'); grd.addColorStop(1, '#183d94');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#ffd34d'; g.fillRect(0, 0, 1024, 8); g.fillRect(0, 152, 1024, 8);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 64px "Be Vietnam Pro", system-ui, sans-serif'; g.fillText(text, 512, sub ? 66 : 82);
  if (sub) { g.font = '700 30px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = '#dbe6ff'; g.fillText(sub, 512, 122); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Gates: two pillars, a beam with the university name, and a small guard house at the main gate. */
export function buildGates(pois) {
  const group = new THREE.Group();
  const B = new Builder();
  for (const p of pois.filter((x) => x.kind === 'gate' && x.dir)) {
    const main = p.id === 'gate-main';
    const [x, z] = p.at, [dx, dz] = p.dir;
    const px = -dz, pz = dx; // across the road
    const half = (main ? 9 : 6.5);
    const H = main ? 6.5 : 5;
    const ang = Math.atan2(pz, px);
    B.color(0xe9e4da);
    for (const s of [-1, 1]) B.box(x + px * half * s, z + pz * half * s, 1.4, 1.4, 0, H, ang);
    B.color(0xc2bcb0);
    for (const s of [-1, 1]) B.box(x + px * half * s, z + pz * half * s, 1.7, 1.7, H, 0.35, ang);
    // beam + sign
    B.color(0x1d47ad); B.box(x, z, half * 2 + 1.4, 0.7, H - 1.9, 1.6, ang);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 1.2, 1.35), new THREE.MeshBasicMaterial({ map: signTexture(main ? 'ĐẠI HỌC BÁCH KHOA' : 'CỔNG PHỤ', main ? 'Đại học Đà Nẵng' : 'Đại học Bách khoa – ĐHĐN'), toneMapped: false }));
    for (const s of [-1, 1]) {
      const m = sign.clone();
      m.position.set(x + dx * 0.37 * s, H - 1.1, z + dz * 0.37 * s);
      m.rotation.y = Math.atan2(dx * s, dz * s);
      group.add(m);
    }
    if (main) {
      // guard house with a blue roof beside the gate (as in the campus render)
      const gx = x + px * (half + 5.5) - dx * 4, gz = z + pz * (half + 5.5) - dz * 4;
      B.color(0xf3f1ec); B.box(gx, gz, 4.5, 3.6, 0, 3, ang);
      B.color(0x3d6fc4); B.box(gx, gz, 5.3, 4.4, 3, 0.4, ang);
      B.color(0x8fb2d6); B.box(gx + px * 2.27, gz + pz * 2.27, 0.05, 1.6, 1.1, 1.2, ang);
    }
  }
  group.add(B.mesh());
  return group;
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
function parkBikes(B, pts, rand, fill) {
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
  for (const a of areas.filter((x) => x.kind === 'parking')) {
    if (!a.pts.some(([x, z]) => insideP(boundary, x, z))) continue; // (centroid of an L-shaped lot can fall outside)
    const covered = a.cover !== 'open';
    parkBikes(B, a.pts, rand, covered ? 0.72 : 0.6);
    if (!covered) continue;
    const roof = offsetPoly(a.pts, -0.6) || a.pts; // irregular lots: roof follows the lot outline
    const H = 3.3;
    // tin roof surface
    const shape = new THREE.Shape(roof.map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, H, 0);
    const m = new THREE.Mesh(geo, tin);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    // fascia + steel posts every ~6 m along the edge
    B.color(0x6f8297); B.band(roof, H - 0.25, H);
    B.color(0x9aa5b1);
    for (let i = 0; i < roof.length; i++) {
      const p = roof[i], q = roof[(i + 1) % roof.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.floor(L / 6));
      for (let k = 0; k < n; k++) { const t = k / n; B.box(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0.2, 0.2, 0, H - 0.2); }
    }
  }
  if (B.tris) group.add(B.mesh());
  return group.children.length ? group : null;
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
  return { group, count: spots.length, setNight(on) { headMat.emissiveIntensity = on ? 1.6 : 0; } };
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
