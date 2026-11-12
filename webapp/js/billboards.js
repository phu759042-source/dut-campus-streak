// Two billboards just inside the main gate of the 3D map: "Ủng hộ DUT Campus Streak" (donate QR) and an ad for
// the Mì Quảng Bách Khoa game. Double-sided, so you see them when you start walking at the gate and when you
// walk back out. Clicking one opens the QR (donate) or miquangbk.com (game); see map.js.
import * as THREE from 'three';

const ADS = [
  // side: metres to the right of the road (looking into the campus), w x h: board size (m)
  { id: 'miquang', img: '/ads/miquang.jpg', side: -6.1, w: 3.9, h: 2.19 },
  { id: 'donate', img: '/ads/donate.jpg', side: 6.1, w: 2.3, h: 2.88 },
];
const FWD = 24;      // metres inside the gate
const LIFT = 1.15;   // bottom edge of the board above the ground

/** Returns { group, posts (for collisions), meshes (clickable faces, userData.ad = id), clear (keep trees off: in front of the boards) }. */
export function buildBillboards(pois) {
  const group = new THREE.Group();
  const posts = [], meshes = [], clear = [];
  const gate = pois.find((p) => p.id === 'gate-main');
  if (!gate?.dir) return { group, posts, meshes, clear };
  const [cx, cz] = gate.center || gate.at;
  const [fx, fz] = gate.dir, rx = -fz, rz = fx;   // f = into the campus, r = right-hand side
  const facing = Math.atan2(-fx, -fz);           // front face looks back at the gate (where the walk starts)
  const loader = new THREE.TextureLoader();
  const steel = new THREE.MeshLambertMaterial({ color: 0x39404d });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1b2333 });
  for (const ad of ADS) {
    const x = cx + rx * ad.side + fx * FWD, z = cz + rz * ad.side + fz * FWD;
    const P = (s, f) => [cx + rx * s + fx * f, cz + rz * s + fz * f];
    const s0 = ad.side - ad.w / 2 - 1.5, s1 = ad.side + ad.w / 2 + 1.5;
    clear.push([P(s0, FWD - 14), P(s1, FWD - 14), P(s1, FWD + 2), P(s0, FWD + 2)]);
    const board = new THREE.Group();
    board.position.set(x, 0, z);
    board.rotation.y = facing;
    const tex = loader.load(ad.img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.MeshBasicMaterial({ map: tex }); // lit from inside: readable at night too
    const yMid = LIFT + ad.h / 2;
    for (const back of [false, true]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ad.w, ad.h), face);
      m.position.set(0, yMid, back ? -0.09 : 0.09);
      if (back) m.rotation.y = Math.PI;
      m.userData.ad = ad.id;
      board.add(m);
      meshes.push(m);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ad.w + 0.16, ad.h + 0.16, 0.16), frameMat);
    frame.position.y = yMid;
    frame.castShadow = true;
    board.add(frame);
    for (const s of [-1, 1]) { // two legs
      const px = s * (ad.w / 2 - 0.35);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, LIFT + 0.2, 10), steel);
      leg.position.set(px, (LIFT + 0.2) / 2, 0);
      leg.castShadow = true;
      board.add(leg);
      posts.push([x + Math.cos(facing) * px, z - Math.sin(facing) * px, 0.12]);
    }
    group.add(board);
  }
  return { group, posts, meshes, clear };
}
