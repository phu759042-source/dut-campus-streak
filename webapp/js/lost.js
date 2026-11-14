// The lost things of the "Đồ thất lạc" event on the 3D map (server mode, see js/lost-core.js): a small model of
// each one lying on its spot (bike seat, bike shed floor, classroom desk) with a twinkle over it so it can be
// spotted, and the close-up photo taken when you pick one up (it goes into the confession post, pages/map-lost.js).
import * as THREE from 'three';
import { ITEM, SPOTS, PICK_R } from './lost-core.js';

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const texCache = new Map();
/** Canvas texture, drawn once per key. */
function tex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const pic = (t, extra = {}) => new THREE.MeshLambertMaterial({ map: t, ...extra });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y ?? h / 2, z);
/** Box lying on the ground with a picture on its top face (canvas top = -z, left = -x). */
const topBox = (w, h, d, side, top, x = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, side, side, side], x, h / 2, z);
/** Flat cut-out lying on the ground (transparent parts of the picture are not drawn). */
const decal = (w, d, t, y = 0.002) => { const m = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }), 0, y, 0); m.rotation.x = -Math.PI / 2; m.castShadow = false; return m; };
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
function rand(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// ---------- pictures ----------
function crackLines(g, w, h, r, n, x0, y0, len, col) {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = x0, y = y0, a = r() * Math.PI * 2;
    g.lineWidth = 0.8 + r() * 1.6; g.beginPath(); g.moveTo(x, y);
    for (let k = 0, L = len * (0.4 + r()); k < L; k += 10) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 10; y += Math.sin(a) * 10; g.lineTo(x, y); }
    g.stroke();
  }
}
const phoneBack = () => tex('phone', 256, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#d0172f'); gr.addColorStop(1, '#a80d22');
  g.fillStyle = gr; rr(g, 0, 0, w, h, 34); g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(20, 0, 30, h); // gloss
  g.fillStyle = '#9b0d20'; rr(g, 14, 14, 112, 112, 26); g.fill(); // camera square
  const r = rand(7);
  crackLines(g, w, h, r, 9, w / 2, h / 2, 220, 'rgba(255,240,240,.8)'); // from the broken mark in the middle
  crackLines(g, w, h, r, 6, 30, h - 40, 120, 'rgba(255,235,235,.75)'); // dropped on the corner
  crackLines(g, w, h, r, 4, w - 40, 160, 90, 'rgba(255,235,235,.6)');
  g.fillStyle = '#d9d4d4'; g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.fill(); // the logo spot, shattered
  crackLines(g, w, h, r, 7, w / 2, h / 2, 30, 'rgba(90,20,30,.9)');
  g.fillStyle = 'rgba(60,0,10,.55)'; g.beginPath(); g.moveTo(8, h - 70); g.lineTo(44, h - 46); g.lineTo(14, h - 26); g.fill(); // chipped corner
});
function parkingCard(key, dark) {
  return tex(key, 344, 216, (g, w, h) => {
    const blue = dark ? '#173a8a' : '#2f7fd8';
    g.fillStyle = '#fbfcfe'; rr(g, 0, 0, w, h, 14); g.fill();
    g.fillStyle = blue; g.beginPath(); g.moveTo(0, h * 0.55); g.lineTo(w * 0.72, h * 0.55); g.lineTo(w, h * 0.05); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.strokeStyle = blue; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w * 0.7, h * 0.5); g.lineTo(w * 0.97, 4); g.stroke();
    g.fillStyle = dark ? '#1b1f2a' : blue; g.fillRect(20, 22, 44, 62); // building icon
    g.fillStyle = '#fbfcfe'; for (let y = 28; y < 82; y += 9) g.fillRect(24, y, 36, 3);
    g.fillStyle = dark ? '#1b1f2a' : blue; g.beginPath(); g.moveTo(14, 96); g.quadraticCurveTo(60, 70, 112, 82); g.lineTo(100, 92); g.quadraticCurveTo(60, 86, 14, 104); g.fill();
    g.fillStyle = dark ? '#1b1f2a' : blue; g.font = `800 37px ${FONT}`; g.textBaseline = 'middle';
    g.fillText(`Số: ${key === 'card4536' ? '4536' : '3908'}`, 100, 60);
    g.fillStyle = dark ? '#f5d90a' : '#ffffff'; g.font = `900 50px ${FONT}`; g.textAlign = 'center'; g.fillText('THẺ GỬI XE', w / 2, h * 0.77);
    if (dark) { g.font = `italic 500 13px ${FONT}`; g.fillStyle = '#e8edf7'; g.fillText('Vui lòng giữ vé cẩn thận, mất vé đền 30.000vnđ', w / 2, h * 0.93); }
  });
}
const clipTex = () => tex('clip', 235, 330, (g, w, h) => {
  g.fillStyle = '#f1f1ee'; rr(g, 0, 0, w, h, 14); g.fill();
  const r = rand(3);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(70,70,70,${0.03 + r() * 0.08})`; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 7, 0, 7); g.fill(); }
  g.strokeStyle = '#d5d5d0'; g.lineWidth = 6; g.beginPath(); g.moveTo(26, h - 26); g.lineTo(w - 26, h - 26); g.stroke();
  g.fillStyle = '#d8d8d4'; rr(g, w - 98, h - 120, 82, 76, 6); g.fill();
  g.fillStyle = '#f2c230'; g.beginPath(); g.arc(w - 82, h - 104, 11, 0, 7); g.fill();
  g.fillStyle = '#333'; g.font = `800 15px ${FONT}`; g.fillText('A4', w - 92, h - 58);
  for (let x = w - 60; x < w - 22; x += 3) g.fillRect(x, h - 70, (x % 2) + 1, 16);
});
const combTex = () => tex('comb', 128, 512, (g, w, h) => {
  g.fillStyle = '#f2cfca';
  rr(g, 18, 8, 92, 236, 18); g.fill();               // teeth block
  g.clearRect(26, 8, 66, 210);
  g.fillStyle = '#f2cfca'; for (let y = 10; y < 218; y += 7) g.fillRect(26, y, 66, 3.5); // teeth
  g.beginPath(); g.moveTo(92, 8); g.lineTo(110, 8); g.lineTo(110, 290); g.quadraticCurveTo(116, 360, 104, 470); g.quadraticCurveTo(78, 506, 52, 470);
  g.quadraticCurveTo(44, 380, 56, 300); g.quadraticCurveTo(70, 250, 92, 244); g.fill(); // handle
  g.fillStyle = '#9b9a9d'; g.beginPath(); g.ellipse(80, 418, 22, 30, 0, 0, 7); g.fill(); // panda
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(80, 420, 15, 20, 0, 0, 7); g.fill();
  g.fillStyle = '#555'; g.beginPath(); g.arc(74, 414, 4, 0, 7); g.arc(87, 414, 4, 0, 7); g.fill();
  g.save(); g.translate(86, 330); g.rotate(-Math.PI / 2); g.fillStyle = '#c99d97'; g.font = `600 15px ${FONT}`; g.fillText('Nice day', -30, 0); g.restore();
});
const pouchTex = () => tex('pouch', 384, 256, (g, w, h) => {
  g.fillStyle = '#e9edf2'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(150,160,175,.35)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = '#4c6fae'; g.fillRect(60, 110, 270, 80); // the pen case inside
  g.fillStyle = '#ff7a3d'; g.fillRect(300, 70, 22, 100); // highlighter
  g.fillStyle = '#2f9e44'; g.beginPath(); g.moveTo(80, 40); g.lineTo(140, 170); g.lineTo(20, 170); g.fill(); // tree
  g.fillStyle = '#8b5a2b'; g.fillRect(72, 170, 16, 18);
  for (const [x, y, c] of [[80, 80, '#ffd43b'], [62, 130, '#e03131'], [104, 140, '#ffd43b']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  g.fillStyle = '#e03131'; g.beginPath(); g.ellipse(195, 160, 36, 46, 0, 0, 7); g.fill(); // Santa
  g.fillStyle = '#ffe3d1'; g.beginPath(); g.arc(195, 102, 18, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(195, 122, 20, 14, 0, 0, 7); g.fill();
  g.fillStyle = '#e03131'; g.beginPath(); g.moveTo(176, 92); g.lineTo(214, 92); g.lineTo(222, 66); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(120, 208, 16, 0, 7); g.arc(120, 184, 11, 0, 7); g.fill(); // snowman
  g.fillStyle = '#d6336c'; g.font = `italic 900 30px ${FONT}`; g.textAlign = 'center'; g.fillText('Merry', 290, 44); g.fillText('Christmas', 290, 76);
  g.strokeStyle = '#e03131'; g.lineWidth = 14; g.strokeRect(0, 0, w, h); // red zip edge
});
const keysTex = () => tex('keys', 256, 256, (g) => {
  g.strokeStyle = '#c9cdd2'; g.lineWidth = 5;
  for (const [x, y, r] of [[128, 118, 26], [110, 140, 18], [146, 142, 16]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
  g.fillStyle = '#b8bec6'; // car key and house key
  g.save(); g.translate(100, 130); g.rotate(2.6); g.fillRect(0, -7, 86, 14); g.fillStyle = '#222'; rr(g, -6, -18, 26, 36, 8); g.fill(); g.restore();
  g.fillStyle = '#c3c8cf'; g.save(); g.translate(150, 150); g.rotate(1.2); g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill(); g.fillRect(12, -6, 62, 12); g.restore();
  g.fillStyle = '#f5d33b'; for (let i = 0; i < 12; i++) { g.save(); g.translate(196, 70); g.rotate(i * Math.PI / 6); g.beginPath(); g.ellipse(0, 20, 9, 15, 0, 0, 7); g.fill(); g.restore(); }
  g.fillStyle = '#9a6a2c'; g.beginPath(); g.arc(196, 70, 15, 0, 7); g.fill(); // sunflower
  g.fillStyle = '#e8333a'; g.beginPath(); g.ellipse(112, 212, 26, 18, -0.5, 0, 7); g.ellipse(146, 212, 26, 18, 0.5, 0, 7); g.fill(); // red bow
  g.fillStyle = '#2b9348'; g.beginPath(); g.ellipse(129, 205, 12, 7, 0.8, 0, 7); g.fill();
  g.fillStyle = '#f4c7d4'; rr(g, 186, 168, 52, 44, 14); g.fill(); g.fillStyle = '#e36b8b'; g.font = `700 14px ${FONT}`; g.fillText('福', 204, 196); // pink pouch
  g.strokeStyle = '#d7b7c0'; g.lineWidth = 3; g.beginPath(); g.moveTo(150, 130); g.lineTo(204, 168); g.stroke();
});
const studentTex = () => tex('stucard', 344, 216, (g, w, h) => {
  g.fillStyle = '#fdfdfd'; rr(g, 0, 0, w, h, 14); g.fill();
  g.fillStyle = '#1d4fa3'; g.fillRect(0, 0, w, 50);
  g.fillStyle = '#fff'; g.font = `800 15px ${FONT}`; g.textAlign = 'center'; g.fillText('TRƯỜNG ĐẠI HỌC BÁCH KHOA', w / 2 + 20, 22); g.font = `600 11px ${FONT}`; g.fillText('ĐẠI HỌC ĐÀ NẴNG', w / 2 + 20, 40);
  g.fillStyle = '#d4202c'; g.font = `900 22px ${FONT}`; g.fillText('THẺ SINH VIÊN', w / 2 + 50, 80);
  g.fillStyle = '#dbe8f7'; g.fillRect(18, 62, 82, 106); // photo
  g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(59, 108, 24, 0, 7); g.fill();
  g.fillStyle = '#1f1f1f'; g.beginPath(); g.arc(59, 98, 25, Math.PI, 0); g.fill();
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 3; g.beginPath(); g.arc(59, 112, 11, 0.2, Math.PI - 0.2); g.stroke();
  g.fillStyle = '#2b4d8f'; g.fillRect(36, 140, 46, 28);
  g.fillStyle = '#9aa3b2'; for (let i = 0; i < 4; i++) g.fillRect(118, 100 + i * 18, 150 - i * 20, 7);
  g.fillStyle = '#222'; for (let x = 120; x < 320; x += 4) g.fillRect(x, 182, 1 + (x * 7 % 3), 20);
});
const walletTex = () => tex('wallet', 220, 180, (g, w, h) => {
  g.fillStyle = '#6e4526'; rr(g, 0, 0, w, h, 16); g.fill();
  const r = rand(11);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,220,180' : '30,15,5'},${0.04 + r() * 0.06})`; g.fillRect(r() * w, r() * h, 2, 2); }
  g.strokeStyle = '#c9a27a'; g.setLineDash([7, 5]); g.lineWidth = 2.5; rr(g, 10, 10, w - 20, h - 20, 10); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(255,230,200,.18)'; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.arc(w, h, 40, 0, 7); g.fill(); // worn corners
});
const calcTex = () => tex('calc', 154, 330, (g, w, h) => {
  g.fillStyle = '#3b4048'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9d2c2'; rr(g, 14, 30, w - 28, 62, 6); g.fill();
  g.fillStyle = '#2e3a2b'; g.font = `600 22px monospace`; g.textAlign = 'right'; g.fillText('3.14159', w - 22, 78);
  g.fillStyle = '#dfe3ea'; g.font = `700 11px ${FONT}`; g.textAlign = 'left'; g.fillText('fx-580', 14, 20);
  for (let row = 0; row < 8; row++) for (let col = 0; col < (row < 3 ? 6 : 5); col++) {
    const cw = row < 3 ? 19 : 23, x = 12 + col * (cw + 3), y = 108 + row * 26;
    g.fillStyle = row < 3 ? '#565c66' : row > 5 && col > 2 ? '#3d6fc9' : '#e9ebee'; rr(g, x, y, cw, 18, 5); g.fill();
  }
});
const bookTex = () => tex('book', 340, 480, (g, w, h) => {
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f4e9c'; g.fillRect(0, 0, w, 210);
  g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.textAlign = 'center'; g.fillText('GIẢI TÍCH', w / 2, 110); g.font = `900 60px ${FONT}`; g.fillText('1', w / 2, 178);
  g.strokeStyle = '#1f4e9c'; g.lineWidth = 4; g.beginPath(); for (let x = 30; x < w - 30; x += 4) { const y = 340 - 60 * Math.sin((x - 30) / 40) * Math.exp(-(x - 30) / 260); x === 30 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  g.strokeStyle = '#d6336c'; g.lineWidth = 3; const r = rand(5);
  for (let i = 0; i < 9; i++) { g.beginPath(); let x = 20 + r() * 260, y = 230 + r() * 230; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += 8; y += (r() - 0.5) * 8; g.lineTo(x, y); } g.stroke(); }
});
const starTex = () => tex('star', 128, 128, (g, w) => {
  const c = w / 2, gl = g.createRadialGradient(c, c, 0, c, c, c);
  gl.addColorStop(0, 'rgba(255,255,230,1)'); gl.addColorStop(0.25, 'rgba(255,214,90,.75)'); gl.addColorStop(1, 'rgba(255,190,40,0)');
  g.fillStyle = gl; g.fillRect(0, 0, w, w);
  g.fillStyle = '#fffbe6';
  g.beginPath(); g.moveTo(c, 4); g.lineTo(c + 9, c - 9); g.lineTo(w - 4, c); g.lineTo(c + 9, c + 9); g.lineTo(c, w - 4); g.lineTo(c - 9, c + 9); g.lineTo(4, c); g.lineTo(c - 9, c - 9); g.closePath(); g.fill();
});

// ---------- models (metres, lying on y = 0; `lying`: on a bike seat or the floor rather than a desk) ----------
const MODELS = {
  phone() {
    const g = new THREE.Group(), red = lam(0xb3132b);
    g.add(topBox(0.076, 0.009, 0.151, red, pic(phoneBack())));
    g.add(box(0.034, 0.003, 0.034, lam(0x8f0c1e), -0.019, 0.0105, -0.056));
    for (const [x, z] of [[-0.027, -0.064], [-0.011, -0.048]]) g.add(mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.004, 16), lam(0x111418), x, 0.012, z));
    return g;
  },
  card4536: () => topBox(0.086, 0.002, 0.054, lam(0xe9eef6), pic(parkingCard('card4536', false))),
  card3908: () => topBox(0.086, 0.002, 0.054, lam(0x173a8a), pic(parkingCard('card3908', true))),
  clipboard() {
    const g = new THREE.Group();
    g.add(topBox(0.235, 0.018, 0.33, lam(0xe6e6e2), pic(clipTex())));
    g.add(box(0.11, 0.008, 0.03, lam(0xb9bec4), 0, 0.022, -0.145));
    for (const s of [-1, 1]) g.add(box(0.016, 0.012, 0.03, lam(0x222222), s * 0.06, 0.022, -0.145));
    return g;
  },
  comb: () => decal(0.05, 0.2, combTex(), 0.003),
  pouch() {
    const g = new THREE.Group();
    g.add(topBox(0.24, 0.035, 0.16, lam(0xd9dde3), pic(pouchTex())));
    g.add(box(0.245, 0.008, 0.012, lam(0xd62f3a), 0, 0.034, -0.08));
    return g;
  },
  keys() {
    const g = new THREE.Group(), brown = lam(0xb48a5a);
    g.add(decal(0.13, 0.13, keysTex(), 0.004));
    g.add(mesh(new THREE.SphereGeometry(0.026, 14, 10), brown, -0.045, 0.024, -0.035)); // crochet bear
    for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), brown, -0.045 + s * 0.017, 0.044, -0.042));
    return g;
  },
  helmet() {
    const g = new THREE.Group();
    const shell = mesh(new THREE.SphereGeometry(0.14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x22b5a6, { side: THREE.DoubleSide }));
    shell.scale.set(1, 0.85, 1.1); g.add(shell);
    const visor = mesh(new THREE.SphereGeometry(0.146, 20, 8, -0.9, 1.8, 0.95, 0.55), new THREE.MeshLambertMaterial({ color: 0x223040, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    visor.scale.set(1, 0.85, 1.1); g.add(visor);
    const rim = mesh(new THREE.TorusGeometry(0.14, 0.008, 6, 32), lam(0x1d1d1d), 0, 0.006, 0);
    rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.1, 1); g.add(rim);
    // white racing stripe front to back over the top, so it reads as a helmet from above
    const stripe = mesh(new THREE.TorusGeometry(0.141, 0.014, 6, 24, Math.PI), lam(0xf4f4f4), 0, 0, 0);
    stripe.rotation.y = Math.PI / 2; stripe.scale.set(1.1, 0.85, 1); g.add(stripe);
    return g;
  },
  stucard: () => topBox(0.086, 0.002, 0.054, lam(0xf2f2f2), pic(studentTex())),
  wallet: () => topBox(0.11, 0.022, 0.09, lam(0x5c3a20), pic(walletTex())),
  earbuds() {
    const g = new THREE.Group(), white = lam(0xf6f6f4);
    const c = mesh(new THREE.CapsuleGeometry(0.021, 0.024, 6, 16), white, 0, 0.016, 0); c.rotation.x = Math.PI / 2; c.scale.set(1.15, 1, 0.75); g.add(c);
    g.add(mesh(new THREE.SphereGeometry(0.003, 8, 6), lam(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.6 }), 0, 0.031, 0.014)); // charging light
    return g;
  },
  calc: () => topBox(0.077, 0.014, 0.165, lam(0x30353c), pic(calcTex())),
  charger() {
    const g = new THREE.Group(), black = lam(0x1c1c1e);
    g.add(box(0.11, 0.03, 0.055, black, 0, 0.015, 0));
    const coil = mesh(new THREE.TorusGeometry(0.045, 0.004, 6, 28), black, 0.11, 0.004, 0.01); coil.rotation.x = Math.PI / 2; g.add(coil);
    const coil2 = mesh(new THREE.TorusGeometry(0.04, 0.004, 6, 28), black, 0.112, 0.012, 0.012); coil2.rotation.x = Math.PI / 2; g.add(coil2);
    return g;
  },
  glasses() {
    const g = new THREE.Group(), black = lam(0x15171a), lens = new THREE.MeshLambertMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35 });
    for (const s of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 24), black, s * 0.032, 0.026, 0); g.add(ring);
      const l = mesh(new THREE.CircleGeometry(0.025, 20), lens, s * 0.032, 0.026, 0); g.add(l);
      g.add(box(0.004, 0.004, 0.12, black, s * 0.058, 0.03, 0.06));
    }
    g.add(box(0.014, 0.004, 0.004, black, 0, 0.034, 0));
    return g;
  },
  bottle(lying) {
    const g = new THREE.Group(), inner = new THREE.Group();
    inner.add(mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.2, 20), new THREE.MeshLambertMaterial({ color: 0x7fc3ff, transparent: true, opacity: 0.45 }), 0, 0.1, 0));
    inner.add(mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.1, 20), new THREE.MeshLambertMaterial({ color: 0xc98a2e, transparent: true, opacity: 0.8 }), 0, 0.05, 0));
    inner.add(mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.035, 16), lam(0x1d3f8f), 0, 0.217, 0));
    if (lying) { inner.rotation.z = Math.PI / 2; inner.position.set(0.11, 0.034, 0); }
    g.add(inner);
    return g;
  },
  umbrella() {
    const g = new THREE.Group(), navy = lam(0x1f2d5a), black = lam(0x161616);
    const body = mesh(new THREE.CylinderGeometry(0.02, 0.032, 0.27, 12), navy, 0, 0.032, 0); body.rotation.z = Math.PI / 2; g.add(body);
    const strap = mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.02, 12), black, 0.03, 0.032, 0); strap.rotation.z = Math.PI / 2; g.add(strap);
    const hook = mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16, Math.PI), black, -0.175, 0.03, 0.025); hook.rotation.x = Math.PI / 2; g.add(hook);
    const sh = mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8), black, -0.15, 0.03, 0); sh.rotation.z = Math.PI / 2; g.add(sh);
    return g;
  },
  raincoat() {
    const g = new THREE.Group(), green = lam(0x3fa34d, { flatShading: true });
    const a = mesh(new THREE.SphereGeometry(0.15, 12, 8), green, 0, 0.03, 0); a.scale.set(1, 0.28, 0.75); g.add(a);
    const b = mesh(new THREE.SphereGeometry(0.11, 10, 7), green, 0.07, 0.05, 0.03); b.scale.set(1, 0.35, 0.8); g.add(b);
    return g;
  },
  book() {
    const g = new THREE.Group();
    g.add(topBox(0.17, 0.022, 0.24, lam(0xf1ece0), pic(bookTex())));
    return g;
  },
};
// drawn bigger than real so they can be seen from a walking height
const SCALE = { phone: 1.6, card4536: 1.8, card3908: 1.8, clipboard: 1.15, comb: 1.5, pouch: 1.3, keys: 1.6, helmet: 1, stucard: 1.8,
  wallet: 1.5, earbuds: 1.7, calc: 1.4, charger: 1.4, glasses: 1.6, bottle: 1.25, umbrella: 1.3, raincoat: 1.1, book: 1.2 };
const TURN = { clipboard: 0.4, book: -0.3, calc: 0.5, phone: 0.9, card4536: 0.3, card3908: -0.5, stucard: 0.7, comb: 1.2, pouch: 0.2, glasses: 0.4 };

/** A fresh model of thing k, as it lies on a spot of `kind` (0 seat, 1 floor, 2 desk, 3 teacher's desk). */
export function makeThing(k, kind = 2) {
  const f = MODELS[k];
  const g = f ? f(kind < 2) : new THREE.Group();
  return g.isGroup ? g : new THREE.Group().add(g);
}

// ---------- the photo for the confession post ----------
const surfaceTex = (kind) => tex('surface' + kind, 512, 512, (g, w, h) => {
  const r = rand(17 + kind);
  if (kind >= 2) { // desk top: light wood (the teacher's desk darker)
    g.fillStyle = kind === 3 ? '#8a5a3c' : '#c08f5e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${kind === 3 ? '40,20,10' : '90,55,25'},${0.06 + r() * 0.12})`; g.lineWidth = 1 + r() * 3; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 30, w * 0.7, y + (r() - 0.5) * 30, w, y + (r() - 0.5) * 20); g.stroke(); }
    return;
  }
  g.fillStyle = '#8d8f91'; g.fillRect(0, 0, w, h); // concrete floor of the bike shed
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.12})`; g.fillRect(r() * w, r() * h, 2, 2); }
  g.fillStyle = 'rgba(30,30,30,.18)'; g.beginPath(); g.ellipse(w * 0.75, h * 0.3, 70, 40, 0.4, 0, 7); g.fill(); // oil stain
  if (kind === 1) { g.fillStyle = 'rgba(240,200,40,.75)'; g.fillRect(0, h * 0.82, w, 18); return; } // painted line
  g.fillStyle = '#1e1f22'; rr(g, w * 0.2, -20, w * 0.6, h + 40, 120); g.fill(); // the bike seat
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 3; g.setLineDash([10, 8]); rr(g, w * 0.24, -10, w * 0.52, h + 20, 100); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, w * 0.3, 40, w * 0.12, h - 80, 40); g.fill();
});

/** Close-up photo of thing k as it lies on spot s (a phone camera shot from above). Resolves with a JPEG data URL. */
export async function photoOf(k, s) {
  const kind = SPOTS[s]?.[3] ?? 2, W = 720;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    r.setSize(W, W, false); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const thing = makeThing(k, kind);
    thing.rotation.y = (TURN[k] || 0) * 0.6;
    thing.traverse((o) => { o.castShadow = true; });
    scene.add(thing);
    const bb = new THREE.Box3().setFromObject(thing), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y * 0.9, 0.06);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 5, span * 5), pic(surfaceTex(kind)));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    sun.position.set(c.x + span * 1.2, span * 4, c.z + span * 0.8); sun.target.position.copy(c); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -span * 2, right: span * 2, top: span * 2, bottom: -span * 2, near: 0.01, far: span * 10 });
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    const cam = new THREE.PerspectiveCamera(36, 1, 0.005, 20), d = span * 1.85 + size.y * 1.5;
    cam.position.set(c.x + d * 0.12, c.y + d * 0.9, c.z + d * 0.48); cam.lookAt(c.x, c.y * 0.5, c.z);
    r.render(scene, cam);
    // a little phone-camera look: vignette and the date stamp
    const out = document.createElement('canvas'); out.width = out.height = W;
    const g = out.getContext('2d');
    g.drawImage(r.domElement, 0, 0);
    const v = g.createRadialGradient(W / 2, W / 2, W * 0.3, W / 2, W / 2, W * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = v; g.fillRect(0, 0, W, W);
    const now = new Date(), p2 = (n) => String(n).padStart(2, '0');
    g.font = `700 26px ${FONT}`; g.fillStyle = '#ffb347'; g.textAlign = 'right'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4;
    g.fillText(`${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`, W - 24, W - 24);
    thing.traverse((o) => o.geometry?.dispose());
    ground.geometry.dispose();
    return out.toDataURL('image/jpeg', 0.86);
  } finally {
    r.dispose(); r.forceContextLoss();
  }
}

// ---------- the things on the map ----------
/**
 * map: the scene from map3d.js. Returns { set([[k, spot], ...]), add(k, s), remove(k), near() -> { k, s, d } | null,
 * spots(): [[k, s], ...], dispose() }.
 */
export function createLost(map) {
  const group = new THREE.Group();
  map.scene.add(group);
  const starMat = new THREE.SpriteMaterial({ map: starTex(), transparent: true, depthWrite: false });
  const on = new Map(); // k -> { s, obj, star, phase }
  function remove(k) {
    const o = on.get(k); if (!o) return;
    group.remove(o.obj, o.star);
    o.obj.traverse((m) => m.geometry?.dispose());
    o.star.material.dispose();
    on.delete(k);
    map.requestRender();
  }
  function add(k, s) {
    const sp = SPOTS[s];
    if (!sp || !ITEM[k]) return;
    remove(k);
    const obj = makeThing(k, sp[3]);
    obj.scale.setScalar(SCALE[k] || 1.4);
    obj.position.set(sp[0], sp[2], sp[1]);
    obj.rotation.y = sp[5] + (TURN[k] || 0);
    obj.traverse((m) => { if (m.isMesh) m.castShadow = false; }); // tiny: shadows cost more than they show
    const star = new THREE.Sprite(starMat.clone());
    star.position.set(sp[0], sp[2] + 0.42, sp[1]);
    star.scale.setScalar(0.4);
    group.add(obj, star);
    on.set(k, { s, obj, star, phase: Math.random() * 6 });
    map.requestRender();
  }
  function set(list) {
    for (const k of [...on.keys()]) remove(k);
    for (const [k, s] of list || []) add(k, s);
  }
  let t = 0;
  const unhook = map.addFrameHook((dt) => {
    t += dt;
    for (const o of on.values()) {
      const sp = SPOTS[o.s], hidden = sp[4] === 2 && map.hiddenAt?.(sp[0], sp[1], sp[2]);
      o.obj.visible = o.star.visible = !hidden;
      const w = 0.5 + 0.5 * Math.sin(t * 3.2 + o.phase);
      o.star.scale.setScalar(0.26 + 0.2 * w);
      o.star.material.opacity = 0.45 + 0.55 * w;
      o.star.material.rotation = t * 0.8 + o.phase;
      o.star.position.y = sp[2] + 0.4 + 0.05 * Math.sin(t * 1.7 + o.phase);
    }
    return false;
  });
  /** The thing within reach of your student (on foot), nearest first. */
  function near() {
    const me = map.self();
    if (!me || (me[4] !== 0 && me[4] !== 3)) return null;
    let best = null;
    for (const [k, o] of on) {
      const sp = SPOTS[o.s], d = Math.hypot(sp[0] - me[0], sp[1] - me[1]), dy = sp[2] - me[2];
      if (d < PICK_R && dy > -0.6 && dy < 1.7 && (!best || d < best.d)) best = { k, s: o.s, d };
    }
    return best;
  }
  return {
    set, add, remove, near,
    spots: () => [...on.entries()].map(([k, o]) => [k, o.s]),
    dispose() { unhook(); set([]); map.scene.remove(group); },
  };
}
