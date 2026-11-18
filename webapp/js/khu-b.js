// Khu B as a walk-in teaching block, from the photo of its front (2024) and the OpenStreetMap outline:
//  - one long bar, 4 floors (ground + 3), open corridors along the front with a concrete parapet, white piers and
//    horizontal sun-shading slats (brise-soleil) in every opening; classrooms behind the corridor, windows at the back
//  - the entrance tower in the middle of the front: stone cladding (đá chẻ) with a round porthole window either side
//    of the door, a flat concrete canopy (mái sảnh) on two slanting wedge legs, breeze-block screens (gạch hoa thông
//    gió) between vertical fins on the floors above, a big blue "B", and on top the zigzag crown with the school name
//    in blue letters and the logo plate
//  - a dog-leg staircase behind the entrance hall and one at each end of the bar; WCs in the block behind the east end
//  - rooms B101-B107 on the ground floor, B201-B207 ... B401-B407 upstairs (boards at the west end of each room)
// The three short wings behind (2 floors) stay plain blocks. Floors above the one you stand on are hidden while you
// are inside, so the follow camera sees your floor (same as Khu H).
import * as THREE from 'three';
import { Builder, insideP, FLOOR_H, canvasTex } from './campus-details.js';
import { latticeTex, stoneTex } from './landmarks.js';

const FH = FLOOR_H, PL = 0.3, SLAB = 0.22, CD = 2.6, NF = 4; // floor height, low plinth, slab, corridor depth, floors
const Y = (k) => PL + k * FH;
const D = 9.0;                    // depth of the bar (front w = 0, back w = D)
const TC = 41.9, TW = 4.6, TF = 0.9; // tower: centre on the front, half width, how far it stands out
const STW = 3.6, RUN = 3.6;       // stair width, length of one flight
const C_WALL = 0xdcdbd4, C_GROUND = 0xefe0b4, C_INNER = 0xf0ece3, C_PIER = 0xf3f2ee, C_RAIL = 0xc9ced4;
const C_FLOOR = 0xcfc6b6, C_ROOMFL = 0xd3cfc6, C_CEIL = 0xf2efe8, C_STAIR = 0x8a8f94, C_STAIR2 = 0x979ca1;
const C_DOOR = 0x7a5a3e, C_FRAME = 0x4b5560, C_PLATE = '#1f4e9c';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
function frame(o, u, w) {
  return {
    o, u, w, ang: Math.atan2(u[1], u[0]),
    at: (a, b) => [o[0] + u[0] * a + w[0] * b, o[1] + u[1] * a + w[1] * b],
    rect(a0, a1, b0, b1) { return [this.at(a0, b0), this.at(a1, b0), this.at(a1, b1), this.at(a0, b1)]; },
  };
}
const boxF = (B, F, a0, a1, b0, b1, y0, h) => {
  const c = F.at((a0 + a1) / 2, (b0 + b1) / 2);
  B.box(c[0], c[1], Math.abs(a1 - a0), Math.abs(b1 - b0), y0, h, F.ang);
};
const spans = (L, gaps) => {
  const out = []; let s = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > s + 0.05) out.push([s, g0]); s = Math.max(s, g1); }
  if (L > s + 0.05) out.push([s, L]);
  return out;
};
const fadeable = (geo, mat) => {
  geo.clearGroups(); geo.addGroup(0, geo.getAttribute('position').count, 0);
  const m = new THREE.Mesh(geo, [mat]); m.castShadow = m.receiveShadow = true; return m;
};

/** The long bar of Khu B in OSM: 18 corners, front from corner 0 to corner 16. */
export const isKhuB = (b) => b.zone === 'B' && (b.osmPts || b.pts)?.length === 18;

function layout(P) {
  const o = P[0], L = len(sub(P[16], o)), u = unit(sub(P[16], o));
  let w = [-u[1], u[0]];
  if (dot(w, sub(P[1], o)) < 0) w = [u[1], -u[0]];
  const F = frame(o, u, w);
  // WC block behind the east end (OSM corners 9-11)
  const wc0 = dot(sub(P[9], o), u), wc1 = dot(sub(P[11], o), u), wcD = dot(sub(P[10], o), w);
  const outline = [F.at(0, 0), F.at(TC - TW, 0), F.at(TC - TW, -TF), F.at(TC + TW, -TF), F.at(TC + TW, 0), F.at(L, 0),
    F.at(L, D), F.at(wc1, D), F.at(wc1, wcD), F.at(wc0, wcD), F.at(wc0, D), F.at(0, D)];
  return { F, L, wc0, wc1, wcD, outline };
}
/** Outline the map uses for the bar (minimap, selection, walker): front with the tower, WC block behind. */
export const khuBOutline = (pts) => layout(pts).outline;

/** The blue name on the crown: "TRƯỜNG ĐẠI HỌC BÁCH KHOA" in capitals, as on the building. */
function nameTex() {
  return canvasTex(1024, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#2350b8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = 84; do { g.font = `800 ${s}px "Be Vietnam Pro", Arial, sans-serif`; s -= 2; } while (g.measureText('TRƯỜNG ĐẠI HỌC BÁCH KHOA').width > w - 20);
    g.fillText('TRƯỜNG ĐẠI HỌC BÁCH KHOA', w / 2, h / 2 + 4);
  });
}
function letterTex(ch) {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#2350b8'; g.font = '900 230px "Be Vietnam Pro", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, w / 2, h / 2 + 12);
  });
}
function logoTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2350b8'; g.fillRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#f4f6f8'; g.font = '900 120px "Be Vietnam Pro", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BK', w / 2, h / 2 + 8);
  });
}

export function buildKhuB(b, out) {
  const P = b.osmPts || b.pts;
  const { F, L, wc0, wc1, wcD, outline } = layout(P);
  const group = new THREE.Group();
  const lv = Array.from({ length: NF + 1 }, () => ({ B: new Builder(), G: new Builder(), group: new THREE.Group() }));
  const wall = (a, c, y0, y1) => out.walls.push({ a, b: c, y0, y1 });
  const seg = (k, p, q, y0, h, color, t = 0.2, collide = true) => {
    const l = len(sub(q, p)); if (l < 0.05) return;
    const B = lv[k].B; B.color(color);
    B.box((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, l, t, y0, h, Math.atan2(q[1] - p[1], q[0] - p[0]));
    if (collide) wall(p, q, y0, y0 + h);
  };
  const plane = (k, w, h, mat, a, bb, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const p = F.at(a, bb); m.position.set(p[0], y, p[1]); m.rotation.y = Math.atan2(-F.w[0], -F.w[1]);
    lv[k].group.add(m); return m;
  };
  const solid = (a0, a1, b0, b1) => out.solids.push(F.rect(a0, a1, b0, b1));

  // stairs: west end, behind the entrance hall, east end (u ranges)
  const S = [[0.25, 0.25 + STW], [TC - STW / 2, TC + STW / 2], [L - 0.25 - STW, L - 0.25]];
  const B2 = D - 0.12; // back of the landings

  // ---------- floors ----------
  lv[0].B.color(0xb9b2a5); lv[0].B.band(outline, 0, PL);
  for (let k = 0; k < NF; k++) {
    const B = lv[k].B, y = Y(k);
    const pieces = k === 0 ? [F.rect(0, L, 0, D), F.rect(TC - TW, TC + TW, -TF, 0)]
      : [F.rect(0, L, 0, CD), F.rect(TC - TW, TC + TW, -TF, 0), F.rect(S[0][1], S[1][0], CD, D), F.rect(S[1][1], S[2][0], CD, D)];
    for (const pts of pieces) {
      B.color(C_FLOOR); B.cap(pts, y);
      if (k > 0) { B.color(C_CEIL); B.cap(pts, y - SLAB); }
      out.surfaces.push({ pts, y });
    }
    if (k > 0) { B.color(0xe2ddd3); for (const [ua, ub] of S) B.band(F.rect(ua, ub, CD, B2), y - SLAB, y); }
  }
  // WC block behind the east end: closed, full height
  { const pts = F.rect(wc0, wc1, D, wcD); const B = lv[0].B; B.color(C_WALL); B.band(pts, 0, Y(NF)); out.solids.push(pts);
    lv[NF].B.color(0xb7bcc2); lv[NF].B.cap(pts, Y(NF) + 0.05); }

  // ---------- front: open corridors (piers, parapet, sun-shading slats) ----------
  const piers = [];
  for (const [s, e] of [[0, TC - TW], [TC + TW, L]]) {
    const n = Math.max(1, Math.round((e - s) / 3.9));
    for (let i = 0; i <= n; i++) piers.push(s + ((e - s) * i) / n);
  }
  for (let k = 0; k < NF; k++) {
    const B = lv[k].B, y0 = Y(k);
    for (const [s, e] of [[0, TC - TW], [TC + TW, L]]) {
      // slab edge / beam over the opening
      B.color(C_WALL); boxF(B, F, s, e, -0.05, 0.22, y0 + 2.75, FH - 2.75);
      if (k > 0) {
        B.color(C_WALL); boxF(B, F, s, e, -0.05, 0.2, y0, 1.0);            // parapet
        B.color(C_RAIL); boxF(B, F, s, e, 0.02, 0.14, y0 + 1.0, 0.06);
        wall(F.at(s, 0.08), F.at(e, 0.08), y0, y0 + 1.05);
      } else {
        B.color(0xb9b2a5); boxF(B, F, s, e, -0.05, 0.2, 0, PL);
      }
      // brise-soleil: two horizontal concrete slats in the upper part of every opening, standing out a little
      B.color(0xe9e8e3);
      for (const yy of [y0 + 1.95, y0 + 2.4]) boxF(B, F, s, e, -0.55, 0.05, yy, 0.09);
    }
    for (const a of piers) {
      B.color(C_PIER); boxF(B, F, a - 0.2, a + 0.2, -0.6, 0.25, y0, FH);
      if (k === 0) solid(a - 0.2, a + 0.2, -0.6, 0.25);
    }
  }
  // ends of the corridor: wall with an opening on the ground floor
  for (let k = 0; k < NF; k++) {
    seg(k, F.at(0, 0), F.at(0, CD), k ? Y(k) : 0, k ? FH : FH + PL, C_WALL, 0.24, k > 0);
    seg(k, F.at(L, 0), F.at(L, CD), k ? Y(k) : 0, k ? FH : FH + PL, C_WALL, 0.24, k > 0);
  }

  // ---------- back and end walls (classroom windows) ----------
  const backWall = (k, a0, a1, windows) => {
    const B = lv[k].B, G = lv[k].G, y0 = Y(k), c = k === 0 ? C_GROUND : C_WALL;
    const yb = k === 0 ? 0 : y0;
    wall(F.at(a0, D - 0.1), F.at(a1, D - 0.1), yb, y0 + FH);
    if (!windows) { B.color(c); boxF(B, F, a0, a1, D - 0.22, D, yb, y0 + FH - yb); return; }
    const W = a1 - a0, n = Math.max(1, Math.round(W / 3.3)), bay = W / n, ww = Math.min(2.0, bay - 0.8);
    B.color(c); boxF(B, F, a0, a1, D - 0.22, D, yb, y0 + 0.95 - yb); boxF(B, F, a0, a1, D - 0.22, D, y0 + 2.45, FH - 2.45);
    for (let i = 0; i < n; i++) {
      const c0 = a0 + bay * i + (bay - ww) / 2, c1 = c0 + ww;
      B.color(c); boxF(B, F, a0 + bay * i, c0, D - 0.22, D, y0 + 0.95, 1.5); boxF(B, F, c1, a0 + bay * (i + 1), D - 0.22, D, y0 + 0.95, 1.5);
      B.color(C_FRAME); boxF(B, F, (c0 + c1) / 2 - 0.03, (c0 + c1) / 2 + 0.03, D - 0.18, D - 0.06, y0 + 0.95, 1.5);
      G.color(0xbfdcef); boxF(G, F, c0, c1, D - 0.13, D - 0.11, y0 + 0.95, 1.5);
      B.color(0xe9e8e3); boxF(B, F, c0 - 0.15, c1 + 0.15, D, D + 0.45, y0 + 2.5, 0.08); // small sun shade over the window
    }
  };
  for (let k = 0; k < NF; k++) {
    backWall(k, 0, S[0][1], false);
    backWall(k, S[0][1], S[1][0], true);
    backWall(k, S[1][0], S[1][1], false);
    backWall(k, S[1][1], S[2][0], true);
    backWall(k, S[2][0], L, false);
    for (const a of [0, L]) { // end walls: plain, one window halfway along
      const B = lv[k].B, y0 = Y(k), yb = k === 0 ? 0 : y0, c = k === 0 ? C_GROUND : C_WALL;
      const E = frame(F.at(a, CD), F.w, [a ? F.u[0] : -F.u[0], a ? F.u[1] : -F.u[1]]), Lw = D - CD;
      wall(F.at(a, CD), F.at(a, D), yb, y0 + FH);
      B.color(c); boxF(B, E, 0, Lw / 2 - 0.7, -0.12, 0.12, yb, y0 + FH - yb); boxF(B, E, Lw / 2 + 0.7, Lw, -0.12, 0.12, yb, y0 + FH - yb);
      boxF(B, E, Lw / 2 - 0.7, Lw / 2 + 0.7, -0.12, 0.12, yb, y0 + 1.0 - yb); boxF(B, E, Lw / 2 - 0.7, Lw / 2 + 0.7, -0.12, 0.12, y0 + 2.4, FH - 2.4);
      lv[k].G.color(0xbfdcef); boxF(lv[k].G, E, Lw / 2 - 0.7, Lw / 2 + 0.7, -0.01, 0.01, y0 + 1.0, 1.4);
    }
  }

  // ---------- entrance tower ----------
  {
    const stone = (w, h, a, y) => { const m = new THREE.MeshLambertMaterial({ map: stoneTex() }); m.map.repeat.set(w / 2.5, h / 2.3); m.map.needsUpdate = true; return plane(0, w, h, m, a, -TF - 0.02, y); };
    // ground floor: stone either side of the door, a round porthole in each, the door opening in the middle
    for (const sd of [-1, 1]) {
      const a0 = TC + sd * 1.6, a1 = TC + sd * TW, mid = (a0 + a1) / 2, w = Math.abs(a1 - a0);
      stone(w, FH + PL, mid, (FH + PL) / 2);
      lv[0].B.color(0x6d645a); boxF(lv[0].B, F, Math.min(a0, a1), Math.max(a0, a1), -TF, -TF + 0.3, 0, FH + PL);
      wall(F.at(a0, -TF + 0.15), F.at(a1, -TF + 0.15), 0, Y(1));
      const p = F.at(mid, -TF - 0.04);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 24), new THREE.MeshLambertMaterial({ color: 0xf2f1ec }));
      ring.position.set(p[0], 2.0, p[1]); ring.rotation.y = Math.atan2(-F.w[0], -F.w[1]); lv[0].group.add(ring);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), new THREE.MeshLambertMaterial({ color: 0x2f3a43 }));
      hole.position.set(p[0], 2.0, p[1] ); hole.rotation.y = ring.rotation.y; lv[0].group.add(hole);
      // tower side walls (from the front of the tower back to the corridor line), every floor
      for (let k = 0; k < NF; k++) seg(k, F.at(TC + sd * TW, -TF), F.at(TC + sd * TW, 0), k ? Y(k) : 0, k ? FH : FH + PL, k ? C_WALL : 0x6d645a, 0.3);
    }
    lv[0].B.color(C_WALL); boxF(lv[0].B, F, TC - 1.6, TC + 1.6, -TF, -TF + 0.3, PL + 2.8, FH - 2.8); // lintel over the door
    // upper floors: breeze-block screens between vertical concrete fins, the blue B in the middle
    const lat = latticeTex(16, 6);
    for (let k = 1; k < NF; k++) {
      const B = lv[k].B, y0 = Y(k);
      for (let i = 0; i < 4; i++) {
        const a0 = TC - TW + 0.35 + i * ((2 * TW - 0.7) / 4), a1 = a0 + (2 * TW - 0.7) / 4;
        const m = new THREE.MeshLambertMaterial({ map: lat.clone(), side: THREE.DoubleSide }); m.map.repeat.set((a1 - a0 - 0.3) / 0.6 / 4, (FH - 0.9) / 0.6 / 4); m.map.needsUpdate = true;
        plane(k, a1 - a0 - 0.3, FH - 0.9, m, (a0 + a1) / 2, -TF - 0.05, y0 + 0.35 + (FH - 0.9) / 2);
      }
      B.color(C_WALL);
      for (let i = 0; i <= 4; i++) { const a = TC - TW + 0.35 + i * ((2 * TW - 0.7) / 4); boxF(B, F, a - 0.15, a + 0.15, -TF - 0.55, -TF + 0.1, y0 - SLAB, FH + SLAB); }
      boxF(B, F, TC - TW, TC + TW, -TF - 0.55, -TF + 0.1, y0 - SLAB, 0.35); // slab band
      boxF(B, F, TC - TW, TC - TW + 0.35, -TF - 0.55, 0, y0 - SLAB, FH + SLAB); boxF(B, F, TC + TW - 0.35, TC + TW, -TF - 0.55, 0, y0 - SLAB, FH + SLAB);
      boxF(B, F, TC - TW, TC + TW, -TF - 0.55, -TF + 0.1, y0 + FH - 0.55, 0.55 - SLAB);
      wall(F.at(TC - TW, -TF), F.at(TC + TW, -TF), y0, y0 + FH);
    }
    { const m = new THREE.MeshLambertMaterial({ map: letterTex('B'), transparent: true }); plane(2, 1.5, 1.5, m, TC, -TF - 0.62, Y(2) - 0.05); }
    // the canopy (mái sảnh): a thick flat slab standing out from the tower on two slanting wedge legs
    {
      const B = lv[0].B, y0 = PL + 2.75, a0 = TC - 3.4, a1 = TC + 3.4, b0 = -TF - 5.6, b1 = -TF;
      B.color(0xd9d8d2); boxF(B, F, a0, a1, b0, b1, y0, 0.55);
      B.color(0xc9c8c1); B.cap(F.rect(a0, a1, b0, b1), y0 - 0.001);
      // legs: narrow at the foot, wide under the slab, leaning out towards the front corners
      for (const sd of [-1, 1]) {
        const ax = TC + sd * 3.1, foot = [[ax - 0.22, b0 + 1.6], [ax + 0.22, b0 + 1.6], [ax + 0.22, b0 + 2.2], [ax - 0.22, b0 + 2.2]];
        const head = [[ax - 0.3, b0 + 0.2], [ax + 0.3, b0 + 0.2], [ax + 0.3, b0 + 2.6], [ax - 0.3, b0 + 2.6]];
        const f = foot.map(([a, bb]) => { const p = F.at(a, bb); return [p[0], 0, p[1]]; });
        const h = head.map(([a, bb]) => { const p = F.at(a, bb); return [p[0], y0, p[1]]; });
        B.color(0xcfcec7);
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; B.quad(f[i], f[j], h[j], h[i]); }
        solid(ax - 0.25, ax + 0.25, b0 + 1.55, b0 + 2.25);
      }
      // entrance steps under the canopy up to the floor
      B.color(0xbdb7ac); boxF(B, F, TC - 1.6, TC + 1.6, -TF - 0.9, -TF, 0, PL / 2);
      out.surfaces.push({ pts: F.rect(TC - 1.6, TC + 1.6, -TF - 0.9, -TF + 0.05), y: PL / 2 });
    }
    // above the roof: the tower box, its zigzag crown, the name and the logo
    const top = Y(NF) + 1.6, tw = F.rect(TC - TW, TC + TW, -TF, 6.5), B = lv[NF].B;
    B.color(0xeef0ee); B.band(tw, Y(NF), top); B.cap(tw, top);
    for (let i = 0; i < 4; i++) {
      const a = tw[i], c = tw[(i + 1) % 4], l = len(sub(c, a)), n = Math.max(2, Math.round(l / 0.9));
      const Pt = (t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
      for (let k = 0; k < n; k++) {
        const p0 = Pt(k / n), p1 = Pt((k + 0.5) / n), p2 = Pt((k + 1) / n);
        B.color(0xf6f6f2);
        B.tri([p0[0], top, p0[1]], [p2[0], top, p2[1]], [p1[0], top + 1.0, p1[1]]);
      }
    }
    plane(NF, 2 * TW - 0.4, 0.95, new THREE.MeshBasicMaterial({ map: nameTex(), transparent: true }), TC, -TF - 0.03, Y(NF) + 0.75);
    plane(NF, 1.25, 1.25, new THREE.MeshLambertMaterial({ map: logoTex() }), TC, -TF - 0.04, top + 0.75);
    B.color(0xdfe1e3); boxF(B, F, TC - 0.7, TC + 0.7, -TF + 0.02, -TF + 0.2, top, 1.4);
  }

  // ---------- rooms ----------
  const label = (k, a, bb, y, text) => {
    const wide = text.length > 6, cw = wide ? 384 : 192, c = document.createElement('canvas'); c.width = cw; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = C_PLATE; g.fillRect(0, 0, cw, 64); g.fillStyle = '#fff';
    g.font = `800 ${wide ? 30 : 40}px "Be Vietnam Pro", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wide ? 1.2 : 0.6, 0.2), new THREE.MeshBasicMaterial({ map: t }));
    const p = F.at(a, bb); m.position.set(p[0], y, p[1]); m.rotation.y = Math.atan2(-F.w[0], -F.w[1]);
    lv[k].group.add(m);
  };
  /** Corridor wall of a room: windows between the two doors (you see into the class from the corridor). */
  function glassWall(k, a0, a1, gaps) {
    const B = lv[k].B, G = lv[k].G, y0 = Y(k), bb = CD;
    for (const [s0, s1] of spans(a1 - a0, gaps.map(([g0, g1]) => [g0 - a0, g1 - a0]))) {
      const u0 = a0 + s0, u1 = a0 + s1;
      wall(F.at(u0, bb), F.at(u1, bb), y0, y0 + FH);
      B.color(C_INNER); boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0, 1.0); boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0 + 2.2, FH - 2.2);
      if (u1 - u0 < 1.2) { boxF(B, F, u0, u1, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2); continue; }
      const n = Math.max(1, Math.round((u1 - u0 - 0.6) / 1.4));
      B.color(C_FRAME);
      for (let i = 0; i <= n; i++) { const x = u0 + 0.3 + ((u1 - u0 - 0.6) * i) / n; boxF(B, F, x - 0.03, x + 0.03, bb - 0.06, bb + 0.06, y0 + 1.0, 1.2); }
      B.color(C_INNER); boxF(B, F, u0, u0 + 0.3, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2); boxF(B, F, u1 - 0.3, u1, bb - 0.1, bb + 0.1, y0 + 1.0, 1.2);
      G.color(0xbfdcef); boxF(G, F, u0 + 0.3, u1 - 0.3, bb - 0.01, bb + 0.01, y0 + 1.0, 1.2);
    }
    for (const g of gaps) { B.color(C_INNER); boxF(B, F, g[0], g[1], bb - 0.1, bb + 0.1, y0 + 2.2, FH - 2.2); }
  }
  function classroom(k, a0, a1, name) {
    const B = lv[k].B, y0 = Y(k), mid = (CD + D) / 2;
    B.color(C_ROOMFL); B.cap(F.rect(a0 + 0.1, a1 - 0.1, CD + 0.1, D - 0.24), y0 + 0.012);
    const g1 = [a0 + 0.6, a0 + 1.6], g2 = [a1 - 1.6, a1 - 0.6];
    glassWall(k, a0, a1, [g1, g2]);
    B.color(C_DOOR); for (const g of [g1, g2]) boxF(B, F, g[0] + 0.02, g[0] + 0.07, CD + 0.1, CD + 1.0, y0, 2.1); // doors swung open
    seg(k, F.at(a0, CD), F.at(a0, D - 0.2), y0, FH, C_INNER); seg(k, F.at(a1, CD), F.at(a1, D - 0.2), y0, FH, C_INNER);
    // board on the west wall, teacher's desk
    B.color(0x2f4a3a); boxF(B, F, a0 + 0.1, a0 + 0.16, CD + 1.2, D - 1.4, y0 + 0.95, 1.2);
    B.color(0xd8d2c4); boxF(B, F, a0 + 0.1, a0 + 0.2, CD + 1.1, D - 1.3, y0 + 0.9, 0.05);
    B.color(C_DOOR); boxF(B, F, a0 + 1.2, a0 + 1.9, mid - 0.6, mid + 0.6, y0, 0.78); wall(F.at(a0 + 1.55, mid - 0.6), F.at(a0 + 1.55, mid + 0.6), y0, y0 + 0.85);
    // rows of long desks with benches, an aisle in the middle
    for (let a = a0 + 2.8; a < a1 - 0.9; a += 1.3) for (const [b0, b1] of [[CD + 0.8, mid - 0.55], [mid + 0.55, D - 0.6]]) {
      B.color(0xb98a5a); boxF(B, F, a - 0.25, a + 0.25, b0, b1, y0 + 0.72, 0.05);
      B.color(0x7a5a3e); boxF(B, F, a - 0.24, a - 0.2, b0, b1, y0 + 0.3, 0.42);
      B.color(0x8c6a4a); boxF(B, F, a + 0.45, a + 0.75, b0, b1, y0 + 0.42, 0.05); boxF(B, F, a + 0.58, a + 0.62, b0, b1, y0, 0.42);
      wall(F.at(a + 0.25, b0), F.at(a + 0.25, b1), y0, y0 + 0.85);
    }
    label(k, (g1[0] + g1[1]) / 2, CD - 0.13, y0 + 2.45, 'B' + name);
  }
  const west = [S[0][1], S[1][0]], east = [S[1][1], S[2][0]];
  for (let k = 0; k < NF; k++) {
    const qw = (west[1] - west[0]) / 4, qe = (east[1] - east[0]) / 3;
    for (let i = 0; i < 4; i++) classroom(k, west[0] + qw * i, west[0] + qw * (i + 1), `${k + 1}0${i + 1}`);
    for (let i = 0; i < 3; i++) classroom(k, east[0] + qe * i, east[0] + qe * (i + 1), `${k + 1}0${i + 5}`);
    // WC sign by the east stairs (the WCs are in the block behind)
    label(k, S[2][0] + STW / 2, B2 - 0.02, Y(k) + FH / 2 + 0.7, 'WC');
  }

  // ---------- stairs: dog-leg, first flight from the corridor towards the back, landing, back to the next floor ----------
  function flight(k, a0, a1, bS, bE, yS, yE, rail) {
    const B = lv[k].B, n = 10, Lf = Math.abs(bE - bS), d = Math.sign(bE - bS), tr = Lf / n;
    for (let i = 0; i < n; i++) {
      const bc = bS + d * (i + 0.5) * tr, tp = yS + ((yE - yS) * (i + 1)) / n;
      B.color(i % 2 ? C_STAIR : C_STAIR2); boxF(B, F, a0, a1, bc - tr / 2, bc + tr / 2, tp - 0.17, 0.17);
    }
    const p0 = F.at(a0, bS), p1 = F.at(a1, bS), p2 = F.at(a1, bE), p3 = F.at(a0, bE);
    B.color(0xe2ddd3); B.quad([p0[0], yS - 0.2, p0[1]], [p1[0], yS - 0.2, p1[1]], [p2[0], yE - 0.25, p2[1]], [p3[0], yE - 0.25, p3[1]]);
    B.color(C_RAIL);
    const a = F.at(rail, bS), c = F.at(rail, bE); B.quad([a[0], yS + 0.92, a[1]], [c[0], yE + 0.92, c[1]], [c[0], yE + 0.98, c[1]], [a[0], yS + 0.98, a[1]]);
    out.surfaces.push({ pts: F.rect(a0, a1, Math.min(bS, bE), Math.max(bS, bE)), ramp: { o: F.at(a0, bS), u: d > 0 ? F.w : [-F.w[0], -F.w[1]], len: Lf, y0: yS, y1: yE, steps: n } });
  }
  for (const [ua, ub] of S) {
    const um = (ua + ub) / 2, half = FH / 2, b0 = CD;
    for (let k = 0; k < NF - 1; k++) {
      const y = Y(k), B = lv[k].B;
      flight(k, ua, um - 0.06, b0, b0 + RUN, y, y + half, um - 0.1);
      B.color(C_STAIR2); boxF(B, F, ua, ub, b0 + RUN, B2, y + half - 0.2, 0.2);
      out.surfaces.push({ pts: F.rect(ua, ub, b0 + RUN, B2), y: y + half });
      flight(k, um + 0.06, ub, b0 + RUN, b0, y + half, y + FH, um + 0.1);
    }
    for (let k = 0; k < NF; k++) {
      lv[k].B.color(0xe2ddd3); boxF(lv[k].B, F, um - 0.06, um + 0.06, b0, b0 + RUN, Y(k) - (k ? FH / 2 : 0), k ? FH / 2 + 0.3 : 0.3);
      // side walls of the stair well (not along the outer end walls)
      if (ua > 1) seg(k, F.at(ua, b0), F.at(ua, D - 0.2), Y(k), FH, C_INNER);
      if (ub < L - 1) seg(k, F.at(ub, b0), F.at(ub, D - 0.2), Y(k), FH, C_INNER);
    }
    wall(F.at(um, b0), F.at(um, b0 + RUN), Y(0) - 1, Y(NF - 1) + 1.2);
    // top floor: railing across the flight that would go further up
    const B = lv[NF - 1].B; B.color(C_RAIL);
    boxF(B, F, ua, um, b0 - 0.03, b0 + 0.03, Y(NF - 1) + 0.92, 0.06);
    for (let a = ua + 0.1; a < um; a += 0.5) boxF(B, F, a - 0.02, a + 0.02, b0 - 0.02, b0 + 0.02, Y(NF - 1), 0.95);
    wall(F.at(ua, b0), F.at(um, b0), Y(NF - 1), Y(NF - 1) + 1.0);
  }
  // entrance hall: the side bits of the tower bay between the stairs and the rooms stay open (lobby)
  for (let k = 0; k < NF; k++) for (const sd of [-1, 1]) seg(k, F.at(TC + sd * TW, CD), F.at(TC + sd * TW, D - 0.2), Y(k), FH, C_INNER);

  // ---------- roof: flat, with a parapet ----------
  {
    const B = lv[NF].B, y = Y(NF), roof = F.rect(0, L, -0.05, D);
    B.color(C_CEIL); B.cap(F.rect(0, L, -0.05, D), y - SLAB);
    B.color(0xb3b8bd); B.cap(roof, y);
    B.color(C_WALL); B.band(F.rect(-0.1, L + 0.1, -0.3, D + 0.1), y - SLAB - 0.35, y + 0.7);
    B.cap(F.rect(-0.1, L + 0.1, -0.3, D + 0.1), y - SLAB - 0.35);
  }

  // ---------- meshes ----------
  const meshes = [];
  lv.forEach((Lv, k) => {
    if (Lv.B.tris) {
      const m = fadeable(Lv.B.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.userData.building = b; Lv.group.add(m); meshes.push(m);
    }
    if (Lv.G.tris) {
      const g = Lv.G.mesh({ transparent: true, opacity: 0.3, depthWrite: false }); g.castShadow = false; g.renderOrder = 3;
      Lv.group.add(g);
    }
    group.add(Lv.group);
  });
  group.traverse((o) => { if (o.isMesh && !o.material?.transparent) { o.castShadow = true; o.receiveShadow = true; } });
  // no trees in the way: the canopy and the drive in front of it, a strip along the corridors
  out.clear.push(F.rect(TC - 6, TC + 6, -TF - 8, 0), F.rect(-0.5, L + 0.5, -1.6, 0));
  const indoor = F.rect(0, L, -TF, D);
  let shown = -1;
  return {
    group, meshes, indoor,
    hides: (x, z, y) => shown >= 0 && shown < 9 && y > Y(shown) + FH - 0.5 && insideP(indoor, x, z),
    update(st) {
      const inside = st && st.on && !st.fp && insideP(indoor, st.x, st.z);
      const lev = inside ? THREE.MathUtils.clamp(Math.floor((st.y - PL + 0.8) / FH), 0, NF - 1) : 9;
      if (lev === shown) return;
      shown = lev;
      lv.forEach((Lv, k) => { Lv.group.visible = k <= lev; });
    },
  };
}
