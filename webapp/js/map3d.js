// 3D campus scene (Three.js). Builds ground, roads, lawns, water, buildings and trees from data/campus.json
// (OpenStreetMap footprints, metres; +x = south/right, -z = east/up like the official campus map).
// Renders on demand: only while the camera moves or something animates.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWalker } from './walk.js';
import { styleOf, wallMaterials, buildBuildingDetails, buildWalls, buildGates, buildCanopies, buildLamps, avenueTreeSpots } from './campus-details.js';

export const FLOOR_H = 3.4;
const NORTH = new THREE.Vector3(-1, 0, 0); // +x points south in this map

const PALETTE = {
  light: {
    sky: 0xcfe2ff, ground: 0xe4e9e1, campus: 0xeef2e6, road: 0xb7bfcc, foot: 0xe3d6c3, grass: 0x9fd08a,
    park: 0x8cc77a, water: 0x6fb7e8, parking: 0xc9ced8, pitch: 0x7cc46b, track: 0xd2876a, wall: 0xffffff,
    hemiSky: 0xffffff, hemiGround: 0xb7c4a8, hemi: 1.15, sun: 2.1, fogNear: 700, fogFar: 1900, glow: 0,
  },
  dark: {
    sky: 0x0b1428, ground: 0x1a2232, campus: 0x1f2a3b, road: 0x3a4558, foot: 0x4a4740, grass: 0x2f5a3a,
    park: 0x2b5535, water: 0x1f4f7a, parking: 0x343c4c, pitch: 0x2e5b33, track: 0x6e4136, wall: 0xb9bfcc,
    hemiSky: 0x8fa6d8, hemiGround: 0x1b2333, hemi: 0.75, sun: 0.55, fogNear: 600, fogFar: 1700, glow: 1,
  },
};

const ROOF = {
  red: 0xb95a4c, gray: 0xc4ccd6, teal: 0x6fbcc9, white: 0xeef0f2, orange: 0xd6a066, blue: 0x7f9fcf, sand: 0xd9cdb5,
};
export function roofColor(b) {
  if (['H', 'N', 'P', 'X', 'E1'].includes(b.zone)) return ROOF.red;
  if (b.zone === 'L') return ROOF.teal;
  if (b.zone === 'S') return ROOF.white;
  if (b.kind === 'dormitory') return ROOF.orange;
  if (b.kind === 'sports_hall') return ROOF.blue;
  if (b.zone) return ROOF.gray;
  return ROOF.sand;
}

// ---------- small geometry helpers ----------
const toShape = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
export function centroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f; cx += (pts[j][0] + pts[i][0]) * f; cz += (pts[j][1] + pts[i][1]) * f;
  }
  if (Math.abs(a) < 1e-6) return [pts[0][0], pts[0][1]];
  return [cx / (3 * a), cz / (3 * a)];
}
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
}
export function inside(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function bbox(list) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const pts of list) for (const [x, z] of pts) {
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

function flatShapes(list, y) {
  const geos = list.map((pts) => {
    const g = new THREE.ShapeGeometry(toShape(pts));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  });
  return geos.length ? mergeGeometries(geos) : null;
}

/** Flat ribbon along a polyline (roads/paths). */
function ribbons(lines, y) {
  const pos = [], idx = [];
  for (const { pts, w } of lines) {
    const n = pts.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      let s = 1;
      if (i > 0 && i < n - 1) {
        let ex = p[0] - a[0], ez = p[1] - a[1];
        const l2 = Math.hypot(ex, ez) || 1; ex /= l2; ez /= l2;
        s = 1 / Math.max(0.45, ex * dx + ez * dz); // miter
      }
      const h = (w / 2) * s;
      pos.push(p[0] - dz * h, y, p[1] + dx * h, p[0] + dz * h, y, p[1] - dx * h);
    }
    for (let i = 0; i < n - 1; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    // round-ish caps at the ends so joins between separate ways look continuous
    for (const p of [pts[0], pts[n - 1]]) {
      const c = pos.length / 3; const seg = 8, r = w / 2;
      pos.push(p[0], y, p[1]);
      for (let k = 0; k <= seg; k++) { const t = (k / seg) * Math.PI * 2; pos.push(p[0] + Math.cos(t) * r, y, p[1] + Math.sin(t) * r); }
      for (let k = 1; k <= seg; k++) idx.push(c, c + k + 1, c + k);
    }
  }
  // make every triangle face up (consistent winding -> no dark back faces)
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
    if (cross > 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // all faces point up; fix any that came out downward
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// ---------- the scene ----------
export function createCampus(container, data, { dark = false, mobile = false, onPick, onFrame, onNear, onInteract, onExitWalk, onView } = {}) {
  let needs = true, raf = 0, disposed = false;
  function requestRender() { needs = true; }
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 700, 1900);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = 1.32;
  controls.minDistance = 35;
  controls.maxDistance = 1500;
  controls.zoomToCursor = true;

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb7c4a8, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2);
  sun.position.set(-260, 420, -180); // late-morning sun from the east/north-east
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 480, bottom: -480, near: 50, far: 1300 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);

  const mats = {};
  const matOf = (key) => (mats[key] ??= new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));

  // ground + campus
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), matOf('ground'));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; ground.receiveShadow = true;
  scene.add(ground);
  const campusMesh = new THREE.Mesh(flatShapes([data.boundary], 0), matOf('campus'));
  campusMesh.receiveShadow = true;
  scene.add(campusMesh);

  // areas
  const byKind = (k) => data.areas.filter((a) => a.kind === k).map((a) => a.pts);
  const layers = [['parking', 0.08], ['grass', 0.12], ['track', 0.16], ['pitch', 0.2], ['water', 0.24]];
  for (const [k, y] of layers) {
    const g = flatShapes(byKind(k), y);
    if (!g) continue;
    const m = new THREE.Mesh(g, matOf(k));
    m.receiveShadow = true;
    scene.add(m);
  }
  const roads = new THREE.Mesh(ribbons(data.roads.filter((r) => !r.foot), 0.3), matOf('road'));
  const foot = new THREE.Mesh(ribbons(data.roads.filter((r) => r.foot), 0.34), matOf('foot'));
  roads.receiveShadow = foot.receiveShadow = true;
  scene.add(roads, foot);

  // buildings (facade style per zone, see campus-details.js)
  const walls = wallMaterials();
  const roofMats = new Map();
  const roofMat = (c) => { if (!roofMats.has(c)) roofMats.set(c, new THREE.MeshLambertMaterial({ color: c })); return roofMats.get(c); };
  const buildings = [];
  const pickables = [];
  for (const b of data.buildings) {
    const h = b.height || b.levels * FLOOR_H + 0.8; // real height when known (e.g. Nhà S 42 m)
    const geo = new THREE.ExtrudeGeometry(toShape(b.pts), { depth: h, bevelEnabled: false });
    if (b.height) {
      // stretch the window texture so it shows exactly `levels` rows of windows
      const uv = geo.getAttribute('uv'), k = (b.levels * FLOOR_H) / b.height;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * k);
    }
    geo.rotateX(-Math.PI / 2);
    const st = styleOf(b);
    const mesh = new THREE.Mesh(geo, [roofMat(st.roofColor), walls.get(st.wall)]);
    mesh.castShadow = mesh.receiveShadow = true;
    const [cx, cz] = centroid(b.pts);
    const info = { ...b, height: h, center: [cx, cz], area: polyArea(b.pts), mesh };
    mesh.userData.building = info;
    buildings.push(info);
    pickables.push(mesh);
    scene.add(mesh);
  }

  // roofs, parapets, plinths, rooftop units, entrance canopies (one merged mesh)
  const details = buildBuildingDetails(buildings);
  scene.add(details.mesh);
  const clickables = [...pickables, details.mesh];
  // perimeter wall, gates, parking canopies
  if (data.walls?.length) scene.add(buildWalls(data.walls));
  const gates = buildGates(data.pois, [-30, -10]);
  scene.add(gates.group);
  const canopies = buildCanopies(data.areas, data.boundary);
  if (canopies) scene.add(canopies);

  // selection outline
  const outline = new THREE.Group();
  scene.add(outline);
  const outlineMat = new THREE.LineBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0.95 });
  function setSelected(list) {
    outline.clear();
    for (const b of list) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(b.mesh.geometry, 30), outlineMat);
      e.scale.setScalar(1.002);
      outline.add(e);
    }
    requestRender();
  }

  // trees (instanced, seeded so they never move) + street lamps
  const blockedBoxes = [...data.buildings.map((b) => b.pts), ...byKind('water'), ...byKind('pitch'), ...byKind('track'), ...byKind('parking')].map((p) => [p, bbox([p])]);
  const isBlocked = (x, z, m = 3) => blockedBoxes.some(([p, b]) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m && inside(p, x, z));
  const lamps = buildLamps(data.roads, data.boundary, (x, z) => isBlocked(x, z, 1.5));
  scene.add(lamps.group);
  {
    const rand = rng(20261110);
    const spots = [];
    for (const g of byKind('grass')) {
      const bb = bbox([g]);
      const n = Math.min(60, Math.floor(polyArea(g) / 110));
      for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
        const x = bb.minX + rand() * (bb.maxX - bb.minX), z = bb.minZ + rand() * (bb.maxZ - bb.minZ);
        if (!inside(g, x, z)) continue;
        if (isBlocked(x, z)) continue;
        if (!inside(data.boundary, x, z)) continue;
        spots.push([x, z, 0.75 + rand() * 0.6, rand()]);
        k++;
      }
    }
    // avenue trees along the campus roads (like the boulevard from the main gate)
    for (const t of avenueTreeSpots(data.roads, data.boundary, (x, z) => isBlocked(x, z, 2.5), rand)) {
      if (!spots.some((s) => Math.abs(s[0] - t[0]) + Math.abs(s[1] - t[1]) < 4)) spots.push(t);
    }
    const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 3, 5); trunkG.translate(0, 1.5, 0);
    const crownG = new THREE.IcosahedronGeometry(2.6, 0); crownG.translate(0, 4.6, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x8a6a4a }), spots.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    spots.forEach(([x, z, sc, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
      m.compose(p.set(x, 0, z), q, s.setScalar(sc));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, col.setHSL(0.27 + r * 0.08, 0.45, 0.36 + r * 0.12));
    });
    trunks.castShadow = crowns.castShadow = true;
    scene.add(trunks, crowns);
  }

  // theme
  function setTheme(isDark) {
    const P = PALETTE[isDark ? 'dark' : 'light'];
    scene.background = new THREE.Color(P.sky);
    scene.fog.color.set(P.sky); scene.fog.near = P.fogNear; scene.fog.far = P.fogFar;
    for (const k of ['ground', 'campus', 'road', 'foot', 'grass', 'water', 'parking', 'pitch', 'track']) matOf(k).color.set(P[k]);
    walls.setNight(isDark, P.wall);
    lamps.setNight(isDark);
    hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemi;
    sun.intensity = P.sun;
    sun.color.set(isDark ? 0xaabbff : 0xfff4e0);
    requestRender();
  }
  setTheme(dark);

  // ---------- camera ----------
  const all = bbox([data.boundary]);
  const home = { target: new THREE.Vector3(-30, 0, -10), pos: new THREE.Vector3(-30, 470, 430) };
  // portrait screens (phones) need the camera further back to fit the campus
  const fit = () => THREE.MathUtils.clamp(1.12 / (camera.aspect || 1), 1, 1.8);
  const portrait = () => (camera.aspect || 1) < 0.85;
  const placeHome = () => {
    const off = home.pos.clone().sub(home.target);
    if (portrait()) off.set(0, off.length() * 0.9, off.length() * 0.42); // look more from above on phones
    off.multiplyScalar(fit());
    if (portrait()) home.target.x = -75; // centre the full campus width on narrow screens
    camera.position.copy(home.target).add(off);
    controls.target.copy(home.target);
  };

  let anim = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function flyTo(target, distance, { polar = 0.85, azimuth = null, ms = 1100 } = {}) {
    const fromPos = camera.position.clone(), fromTarget = controls.target.clone();
    const az = azimuth ?? controls.getAzimuthalAngle();
    const toTarget = new THREE.Vector3(target[0], target[1] ?? 0, target[2]);
    const off = new THREE.Vector3().setFromSphericalCoords(distance, polar, az);
    const toPos = toTarget.clone().add(off);
    anim = { t0: performance.now(), ms, fromPos, fromTarget, toPos, toTarget };
    requestRender();
  }
  function focusBox(b, h = 20) {
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 30);
    flyTo([(b.minX + b.maxX) / 2, h * 0.4, (b.minZ + b.maxZ) / 2], Math.min(900, (size * 1.9 + 70) * fit()));
  }
  const goHome = () => flyTo([home.target.x, 0, home.target.z], home.pos.distanceTo(home.target) * fit(), { polar: portrait() ? 0.44 : Math.acos((home.pos.y - home.target.y) / home.pos.distanceTo(home.target)), azimuth: 0 });
  const faceNorth = () => flyTo([controls.target.x, controls.target.y, controls.target.z], camera.position.distanceTo(controls.target), { polar: controls.getPolarAngle(), azimuth: Math.PI / 2 });

  // keep the camera over the campus area
  const LIM = { minX: all.minX - 150, maxX: all.maxX + 150, minZ: all.minZ - 150, maxZ: all.maxZ + 150 };
  controls.addEventListener('change', () => {
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, LIM.minX, LIM.maxX), cz = THREE.MathUtils.clamp(t.z, LIM.minZ, LIM.maxZ);
    if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
    if (t.y !== 0 && !anim) t.y = 0;
    requestRender();
  });

  // ---------- walk mode ----------
  const walker = createWalker({ scene, camera, el: renderer.domElement, data, pickables, extraSolids: gates.solids, limits: LIM, onNear, onInteract, onExit: onExitWalk, onView });
  function startWalk(at, lookAt) {
    let x, z, facing;
    if (at) {
      // start in front of the chosen place, facing it
      [x, z] = walker.freeSpot(at[0], at[1]);
      const t = lookAt || at;
      facing = Math.atan2(t[0] - x, t[1] - z);
      if (!Number.isFinite(facing) || (x === t[0] && z === t[1])) facing = Math.PI; // default: walk "up" the map
    } else {
      const gate = data.pois.find((p) => p.id === 'gate-main');
      const [gx, gz] = gate ? gate.at : [0, 0];
      const cx = -60, cz = -40; // towards the middle of the campus
      const L = Math.hypot(cx - gx, cz - gz) || 1;
      x = gx + ((cx - gx) / L) * 14; z = gz + ((cz - gz) / L) * 14;
      facing = Math.atan2(cx - gx, cz - gz);
    }
    anim = null;
    controls.enabled = false;
    walker.enter({ x, z, facing });
    requestRender();
  }
  function stopWalk() {
    if (!walker.state.on) return;
    const { x, z } = walker.state;
    walker.exit();
    controls.enabled = true;
    controls.target.set(x, 0, z);
    flyTo([x, 0, z], 230, { polar: 0.9, azimuth: walker.state.yaw });
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; anim = null; });
  el.addEventListener('pointerup', (e) => {
    if (document.pointerLockElement) return; // mouse-look: clicks are not for picking
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(clickables, false)[0];
    onPick?.(hit ? (hit.object === details.mesh ? details.pick(hit.faceIndex) : hit.object.userData.building) : null);
  });

  // ---------- render loop (on demand) ----------
  const v = new THREE.Vector3();
  function project(x, y, z) {
    v.set(x, y, z).project(camera);
    if (v.z > 1) return null;
    const r = el.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, depth: v.z };
  }
  function compassAngle() {
    // angle of map north on screen, radians clockwise from screen-up
    const az = walker.state.on ? walker.state.yaw : controls.getAzimuthalAngle();
    const fwd = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    return Math.atan2(NORTH.dot(right), NORTH.dot(fwd));
  }
  let last = performance.now();
  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (walker.state.on) {
      const look = walker.update(dt);
      controls.target.copy(look); // used for label distance
      needs = true;
    } else if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / anim.ms), k = ease(t);
      camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
      controls.target.lerpVectors(anim.fromTarget, anim.toTarget, k);
      if (t >= 1) anim = null;
      needs = true;
    }
    if (!walker.state.on && controls.update()) needs = true;
    if (!needs) return;
    needs = false;
    renderer.render(scene, camera);
    const w = walker.state;
    onFrame?.({ project, compass: compassAngle(), distance: w.on ? 60 : camera.position.distanceTo(controls.target) / fit(),
      walk: w.on ? { x: w.x, z: w.z, heading: w.heading, yaw: w.yaw } : null });
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  placeHome();
  tick();

  return {
    /** debug: { calls, triangles, ms } for one synchronous frame */
    measure() {
      const gl = renderer.getContext();
      const t = performance.now();
      renderer.render(scene, camera); gl.finish();
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, ms: +(performance.now() - t).toFixed(1) };
    },
    /** debug: advance walk mode by `sec` seconds at 60 fps synchronously, then draw */
    _step(sec) {
      for (let i = 0; i < Math.round(sec * 60); i++) if (walker.state.on) { const l = walker.update(1 / 60); controls.target.copy(l); }
      needs = true;
      last = performance.now();
      const w = walker.state;
      renderer.render(scene, camera);
      onFrame?.({ project, compass: compassAngle(), distance: 60, walk: w.on ? { x: w.x, z: w.z, heading: w.heading, yaw: w.yaw } : null });
      return { x: +w.x.toFixed(1), z: +w.z.toFixed(1), y: +w.y.toFixed(2), near: w.nearIdx >= 0 ? data.buildings[w.nearIdx].zone || data.buildings[w.nearIdx].name : null };
    },
    buildings,
    bounds: all,
    flyTo, focusBox, goHome, faceNorth, setSelected, setTheme, requestRender,
    startWalk, stopWalk, walking: () => walker.state.on,
    setJoy: (x, y) => walker.setJoy(x, y), toggleLock: () => walker.toggleLock(), setFirstPerson: (on) => walker.setFirstPerson(on), jump: () => walker.jump(), teleport: (x, z, lookAt) => walker.teleport(x, z, lookAt),
    zoom(f) { flyTo([controls.target.x, controls.target.y, controls.target.z], THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * f, controls.minDistance, controls.maxDistance), { polar: controls.getPolarAngle(), ms: 350 }); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      walker.dispose();
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
