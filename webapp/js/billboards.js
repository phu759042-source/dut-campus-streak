// Two billboards on the inside of the fence along the main gate driveway: an ad for the Mì Quảng Bách Khoa game
// and "Ủng hộ DUT Campus Streak" (donate QR). Side by side on the right-hand wall as you ride in, a few metres past
// the gate pillar, facing the driveway: you glance right on the way in and see both, and they stand in nobody's way.
// Clicking one opens the QR (donate) or miquangbk.com (game); see map.js.
import * as THREE from 'three';

// along: metres inside the gate (centre of the board), w x h: board size (m)
const ADS = [
  { id: 'miquang', img: '/ads/miquang.jpg', along: 7.4, w: 3.9, h: 2.19 },
  { id: 'donate', img: '/ads/donate.jpg', along: 11.15, w: 2.3, h: 2.88 },
];
const WALL = 8.18;   // the right-hand fence of the driveway, metres from the middle of the gate
const OFF = 0.36;    // board face this far in front of the fence line (clear of the fence piers)
const MID = 1.9;     // height of the board centres (tops stick out over the 2.1 m fence, like real banners)

/** Returns { group, posts (for collisions), meshes (clickable faces, userData.ad = id), clear (keep trees off: in front of the boards) }. */
export function buildBillboards(pois) {
  const group = new THREE.Group();
  const posts = [], meshes = [], clear = [];
  const gate = pois.find((p) => p.id === 'gate-main');
  if (!gate?.dir) return { group, posts, meshes, clear };
  const [cx, cz] = gate.center || gate.at;
  const [fx, fz] = gate.dir, rx = -fz, rz = fx;   // f = into the campus, r = right-hand side
  const P = (s, f) => [cx + rx * s + fx * f, cz + rz * s + fz * f];
  const facing = Math.atan2(-rx, -rz);           // the face looks across the driveway (away from the fence)
  const loader = new THREE.TextureLoader();
  const steel = new THREE.MeshLambertMaterial({ color: 0x39404d });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1b2333 });
  const s = WALL - OFF;
  for (const ad of ADS) {
    const [x, z] = P(s, ad.along);
    clear.push([P(WALL - 5, ad.along - ad.w / 2 - 1), P(WALL, ad.along - ad.w / 2 - 1), P(WALL, ad.along + ad.w / 2 + 1), P(WALL - 5, ad.along + ad.w / 2 + 1)]);
    const board = new THREE.Group();
    board.position.set(x, 0, z);
    board.rotation.y = facing;
    const tex = loader.load(ad.img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.MeshBasicMaterial({ map: tex }); // lit from inside: readable at night too
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ad.w, ad.h), face);
    m.position.set(0, MID, 0.09);
    m.userData.ad = ad.id;
    board.add(m);
    meshes.push(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ad.w + 0.16, ad.h + 0.16, 0.16), frameMat);
    frame.position.y = MID;
    frame.castShadow = true;
    board.add(frame);
    // steel brackets back to the fence, top and bottom of each side
    for (const sx of [-1, 1]) for (const y of [MID - ad.h / 2 + 0.25, Math.min(MID + ad.h / 2 - 0.25, 2.0)]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, OFF - 0.1), steel);
      b.position.set(sx * (ad.w / 2 - 0.3), y, -(OFF - 0.1) / 2 - 0.08);
      board.add(b);
    }
    group.add(board);
    // the board stands out 0.4 m from the fence: keep walkers off it
    for (let t = -ad.w / 2 + 0.2; t <= ad.w / 2 - 0.2 + 1e-6; t += 0.4) {
      const [px, pz] = P(s - 0.05, ad.along - t);
      posts.push([px, pz, 0.2]);
    }
  }
  return { group, posts, meshes, clear };
}
