// /map: 3D map of the DUT campus. Public (no login needed) so new students can explore it.
// Three.js is loaded only when this page opens.
import { html, useState, useEffect, useRef } from 'preact';
import { appStore, loadTodayClasses, fmtTime, readLocal, writeLocal, supabase } from '../lib.js';
import { Icon, Spinner, toast, openSheet } from '../ui.js';
import { back, navigate } from '../router.js';
import { WorldLayer, editLook, savedLook } from './map-world.js';
import { devName } from '../world.js';

// Zone names as printed on the official campus map.
const ZONE_META = {
  A: { title: 'Khu A', sub: 'Phòng học khu A' },
  B: { title: 'Khu B', sub: 'Cạnh nhà xe khu B' },
  C1: { title: 'Khu C1', group: 'C' }, C2: { title: 'Khu C2', group: 'C' }, C3: { title: 'Khu C3', group: 'C' },
  D: { title: 'Khu D' },
  E1: { title: 'Khu E1', group: 'E' }, E2: { title: 'Khu E2', group: 'E' },
  F: { title: 'Khu F', sub: 'Cạnh Hội trường F', keywords: 'hoi truong' },
  G: { title: 'Khu G' }, H: { title: 'Khu H' }, I: { title: 'Khu I' }, K: { title: 'Khu K' },
  L: { title: 'Khu L', sub: 'Trung tâm Học liệu', keywords: 'thu vien hoc lieu trung tam hoc lieu library' },
  M: { title: 'Khu M' }, N: { title: 'Khu N' }, P: { title: 'Khu P' },
  S: { title: 'Nhà S', facts: ['10 tầng nổi, cao 42 m', 'Tổng diện tích sàn 7.330 m²'] }, X: { title: 'Khu X' },
};
const GROUPS = { C: 'Khu C (C1, C2, C3)', E: 'Khu E (E1, E2)' };

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();
const isMobile = () => matchMedia('(pointer: coarse)').matches || innerWidth < 700;

/** Build the list of things that can be searched for / selected. */
function buildTargets(scene, data, A) {
  const { bbox } = A;
  const T = [];
  const byZone = {};
  for (const b of scene.buildings) if (b.zone) (byZone[b.zone] ||= []).push(b);
  const fromBuildings = (key, title, sub, list, extra = {}) => {
    const box = bbox(list.map((b) => b.pts));
    const top = Math.max(...list.map((b) => b.height));
    const main = list.reduce((a, b) => (b.area > a.area ? b : a));
    return { key, title, sub, kind: 'zone', buildings: list, box, height: top, anchor: [main.center[0], main.height + 3, main.center[1]], ...extra };
  };
  for (const [z, list] of Object.entries(byZone)) {
    const m = ZONE_META[z] || { title: `Khu ${z}` };
    const osm = [...new Set(list.map((b) => b.name).filter(Boolean))].filter((n) => norm(n) !== norm(m.title));
    T.push(fromBuildings(z, m.title, m.sub, list, { zone: z, letter: m.group || z, osm, keywords: m.keywords || '', label: true, facts: m.facts }));
  }
  for (const [g, title] of Object.entries(GROUPS)) {
    const list = scene.buildings.filter((b) => b.zone && ZONE_META[b.zone]?.group === g);
    if (list.length) T.push(fromBuildings(g, title, null, list, { zone: g, letter: g, group: true }));
  }
  // named non-zone buildings (dormitories, canteen, sports hall, ...)
  const dorms = scene.buildings.filter((b) => b.kind === 'dormitory');
  for (const b of scene.buildings) {
    if (b.zone || !b.name) continue;
    const isDorm = b.kind === 'dormitory' && /^Nhà \d/.test(b.name);
    const title = isDorm ? `KTX ${b.name}` : b.name;
    T.push(fromBuildings(`b${b.id}`, title, isDorm ? 'Ký túc xá sinh viên' : null, [b], {
      kind: 'building', keywords: isDorm ? 'ktx ky tuc xa' : b.name === 'Căn tin' ? 'can tin nha an canteen an uong' : b.kind === 'sports_hall' ? 'gdtc the chat the duc nha thi dau' : '',
      label: true, minor: true,
    }));
  }
  if (dorms.length) T.push(fromBuildings('ktx', 'Ký túc xá (KTX)', `${dorms.length} nhà ở sinh viên`, dorms, { kind: 'group', keywords: 'ktx ky tuc xa o noi tru' }));
  for (const a of data.areas.filter((x) => x.kind === 'track')) {
    const box = bbox([a.pts]);
    T.push({ key: 'track', title: 'Sân vận động', sub: 'Sân bóng và đường chạy', kind: 'area', buildings: [], box, height: 2,
      anchor: [(box.minX + box.maxX) / 2, 3, (box.minZ + box.maxZ) / 2], keywords: 'san van dong san bong duong chay the thao', label: true, minor: true });
  }
  for (const p of data.pois) {
    const [x, z] = p.at;
    T.push({ key: p.id, title: p.name, sub: p.sub, kind: 'poi', buildings: [], box: { minX: x - 25, maxX: x + 25, minZ: z - 25, maxZ: z + 25 }, height: 4,
      anchor: [x, 5, z], keywords: p.kind === 'gate' ? 'cong vao' : 'nha xe gui xe do xe parking', label: true, poi: p.kind });
  }
  return T;
}

/** Query -> matching targets (room codes such as F305 map to their zone). */
function search(targets, q) {
  const n = norm(q).replace(/\s+/g, ' ');
  if (!n) return [];
  const out = [];
  const room = n.replace(/\s/g, '').match(/^([a-z])(\d{3,4})$/);
  if (room) {
    const letter = room[1].toUpperCase();
    const t = targets.find((x) => x.key === letter) || targets.find((x) => x.group && x.key === letter);
    if (t) out.push({ ...t, roomHit: `${letter}${room[2]}` });
  }
  const exact = targets.find((x) => norm(x.key) === n.replace(/\s/g, '') || norm(x.title) === n);
  if (exact && !out.some((o) => o.key === exact.key)) out.push(exact);
  for (const t of targets) {
    if (out.some((o) => o.key === t.key)) continue;
    const hay = norm(`${t.title} ${t.sub || ''} ${t.keywords || ''} ${(t.osm || []).join(' ')}`);
    if (hay.includes(n)) out.push(t);
  }
  return out.slice(0, 8);
}

// "Front" of a place = its side towards the bottom of the map (main road / entrances, like the blue circle at Khu A).
const centerOf = (t) => [(t.box.minX + t.box.maxX) / 2, (t.box.minZ + t.box.maxZ) / 2];
function doorOf(t) {
  const b = (t.buildings || []).find((x) => x.entrance_edge != null);
  if (!b) return null;
  const p = b.pts, i = b.entrance_edge, a = p[i], c = p[(i + 1) % p.length];
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let nx = c[1] - a[1], nz = -(c[0] - a[0]);
  const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
  const c2 = centerOf(t);
  if ((mx + nx - c2[0]) ** 2 + (mz + nz - c2[1]) ** 2 < (mx - c2[0]) ** 2 + (mz - c2[1]) ** 2) { nx = -nx; nz = -nz; }
  return { spot: [mx + nx * 7, mz + nz * 7], door: [mx, mz] };
}
const frontOf = (t) => (t.kind === 'poi' ? centerOf(t) : doorOf(t)?.spot || [(t.box.minX + t.box.maxX) / 2, t.box.maxZ + 5]);
const lookOf = (t) => doorOf(t)?.door || centerOf(t);

function roomLetter(room) {
  const m = String(room || '').trim().toUpperCase().match(/^([A-Z])\s*\d/);
  return m ? m[1] : null;
}

/** On-screen joystick for phones. onMove(x, y) with x right, y forward, both -1..1. */
function Joystick({ onMove }) {
  const ref = useRef(), knob = useRef(), id = useRef(null);
  const R = 46;
  const upd = (e) => {
    const r = ref.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / R, -dy / R);
  };
  const end = (e) => {
    if (id.current !== e.pointerId) return;
    id.current = null;
    knob.current.style.transform = '';
    onMove(0, 0);
  };
  return html`<div class="joy" ref=${ref} aria-label="Cần điều khiển"
    onPointerDown=${(e) => { e.preventDefault(); id.current = e.pointerId; try { ref.current.setPointerCapture(e.pointerId); } catch { /* synthetic */ } upd(e); }}
    onPointerMove=${(e) => { if (id.current === e.pointerId) upd(e); }} onPointerUp=${end} onPointerCancel=${end}>
    <span class="joy-knob" ref=${knob}></span></div>`;
}

/** Top-down picture of the campus for the walk-mode minimap (drawn once). */
function minimapImage(data, A, dark) {
  const S = 1.5;
  const b = A.bbox([data.boundary]);
  const pad = 160;
  const minX = b.minX - pad, minZ = b.minZ - pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.maxX - b.minX + pad * 2) * S); c.height = Math.ceil((b.maxZ - b.minZ + pad * 2) * S);
  const g = c.getContext('2d');
  const P = (x, z) => [(x - minX) * S, (z - minZ) * S];
  const trace = (pts) => pts.forEach(([x, z], i) => { const [px, pz] = P(x, z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
  const poly = (pts, fill) => { g.beginPath(); trace(pts); g.closePath(); g.fillStyle = fill; g.fill(); };
  g.fillStyle = dark ? '#1a2232' : '#e4e9e1'; g.fillRect(0, 0, c.width, c.height);
  poly(data.boundary, dark ? '#223047' : '#eef2e6');
  const AREA = { grass: dark ? '#2f5a3a' : '#a8d896', water: '#6fb7e8', parking: dark ? '#343c4c' : '#cfd4dc', pitch: dark ? '#2e5b33' : '#86c873', track: '#d2876a', dirt: dark ? '#6e5c40' : '#d8c39a' };
  for (const a of data.areas) poly(a.pts, AREA[a.kind] || '#ccc');
  g.lineCap = g.lineJoin = 'round';
  for (const rd of data.roads) {
    g.beginPath(); trace(rd.pts);
    g.strokeStyle = rd.foot ? (dark ? '#5a5548' : '#e8dcc8') : (dark ? '#46526a' : '#c2c9d4');
    g.lineWidth = rd.w * S; g.stroke();
  }
  for (const bd of data.buildings) poly(bd.pts, bd.zone ? (dark ? '#8d97ad' : '#7d8799') : (dark ? '#6b7385' : '#a3aab6'));
  return { canvas: c, S, minX, minZ };
}

function drawMinimap(cv, mm, w) {
  if (!cv || !mm) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = cv.clientWidth || 140;
  if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
  const rot = -Math.PI / 2 - Math.atan2(fz, fx); // camera forward points up on the minimap
  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip();
  g.translate(size / 2, size / 2);
  g.rotate(rot);
  const zoom = 1.1;
  g.scale(zoom / mm.S, zoom / mm.S);
  g.drawImage(mm.canvas, -(w.x - mm.minX) * mm.S, -(w.z - mm.minZ) * mm.S);
  g.restore();
  // player arrow (heading (sin h, cos h) in map x/z)
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(rot + Math.atan2(Math.cos(w.heading), Math.sin(w.heading)));
  g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -6.5); g.lineTo(-2.5, 0); g.lineTo(-6, 6.5); g.closePath();
  g.fillStyle = '#2f6bff'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fill();
  g.restore();
}

// Day / night for the map only. 'day' | 'night' chosen with the button; unset = follow the app theme.
const TIME_KEY = 'cs-map-time';
const appIsDark = () => document.documentElement.dataset.theme === 'dark';
function mapNight() {
  let v = null;
  try { v = readLocal(TIME_KEY); } catch { /* storage off */ }
  return v === 'night' ? true : v === 'day' ? false : appIsDark();
}

// Live viewers (Supabase Realtime presence: every open map tab joins one channel, nothing is stored)
// and the visit counter (hit_page_view RPC: one visit per browser session, totals for all time and today).
function useMapStats() {
  const [online, setOnline] = useState(0);
  const [visits, setVisits] = useState(null);
  useEffect(() => {
    let alive = true;
    let counted = false;
    try { counted = sessionStorage.getItem('cs-map-visit') === '1'; } catch { /* storage off */ }
    const load = (count) => supabase.rpc('hit_page_view', { p_page: 'map', p_count: count }).then(({ data, error }) => {
      if (!alive || error || !data) return;
      if (count) { counted = true; try { sessionStorage.setItem('cs-map-visit', '1'); } catch { /* storage off */ } }
      setVisits(data);
    }, () => {});
    load(!counted);
    const timer = setInterval(() => { if (!document.hidden) load(false); }, 120000);
    const key = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
    const ch = supabase.channel('map-online', { config: { presence: { key } } });
    ch.on('presence', { event: 'sync' }, () => { if (alive) setOnline(Object.keys(ch.presenceState()).length); })
      .subscribe((status) => { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
    return () => { alive = false; clearInterval(timer); supabase.removeChannel(ch); };
  }, []);
  return { online, visits };
}
const fmtCount = (n) => Number(n || 0).toLocaleString('vi-VN');

/** The billboards at the main gate: the game ad opens its site, the donate one shows the QR big enough to scan. */
function showAd(id) {
  if (document.pointerLockElement) document.exitPointerLock();
  if (id === 'miquang') { window.open('https://miquangbk.com/', '_blank', 'noopener'); return; }
  openSheet(() => html`<div class="donate-sheet">
    <p class="muted">Nếu thấy DUT Campus Streak có ích, bạn có thể ủng hộ nhóm làm web bằng cách quét mã bên dưới (MB Bank, VietQR). Cảm ơn bạn rất nhiều!</p>
    <img class="donate-qr" src="/ads/donate-qr.png" alt="Mã QR chuyển khoản MB Bank, chủ tài khoản Nguyen Tan Phu" />
    <a class="btn btn-ghost btn-sm" href="/ads/donate-qr.png" download="ung-ho-campus-streak.png">Tải ảnh mã QR</a>
  </div>`, { title: 'Ủng hộ DUT Campus Streak' });
}

export function MapPage() {
  const host = useRef();
  const labelsRef = useRef();
  const sceneRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [err, setErr] = useState('');
  const [targets, setTargets] = useState([]);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [focusSearch, setFocusSearch] = useState(false);
  const [compass, setCompass] = useState(0);
  const [hint, setHint] = useState(true);
  const [classes, setClasses] = useState(null);
  const [walking, setWalking] = useState(false);
  const [near, setNear] = useState(null);
  const [walkHint, setWalkHint] = useState(false);
  const [view, setView] = useState({ fp: false, locked: false, mode: 'walk' });
  const [showPins, setShowPins] = useState(() => { try { return readLocal('cs-map-labels') !== 'off'; } catch { return true; } });
  const togglePins = () => setShowPins((v) => { try { writeLocal('cs-map-labels', v ? 'off' : 'on'); } catch { /* storage off */ } return !v; });
  // H hides / shows the pins (handy while walking around)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyH' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      togglePins();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selRef = useRef(null);
  selRef.current = sel;
  const miniRef = useRef();
  const mmRef = useRef(null);
  const mobile = isMobile();
  const [night, setNight] = useState(mapNight);
  const dataRef = useRef(null);
  const loggedIn = !!appStore.get().session;
  const stats = useMapStats();
  // stands at the stadium: '' | 'can' (standing at a seat) | 'on' (sitting)
  const [seat, setSeat] = useState('');
  useEffect(() => {
    if (!walking) { setSeat(''); return undefined; }
    const id = setInterval(() => { const s = sceneRef.current; if (s) setSeat(s.sitting() ? 'on' : s.canSit() ? 'can' : ''); }, 300);
    return () => clearInterval(id);
  }, [walking]);
  // server mode (multiplayer): other students, chat, meetings with voice chat
  const [server, setServer] = useState(false);
  const [look, setLook] = useState(null);
  const worldFrame = useRef(null);
  const worldPick = useRef(null);

  useEffect(() => {
    document.title = 'Bản đồ DUT 3D · Campus Streak';
    let disposed = false;
    const labelEls = [];
    (async () => {
      try {
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('Trình duyệt hoặc máy của bạn không hỗ trợ WebGL nên không hiển thị được bản đồ 3D.');
        const [A, data] = await Promise.all([
          import('../map3d.js'),
          fetch('/data/campus.json').then((r) => { if (!r.ok) throw new Error('Không tải được dữ liệu bản đồ.'); return r.json(); }),
          document.fonts?.load?.('900 64px "Be Vietnam Pro"').catch(() => {}), // fonts for the gate signs
        ]);
        if (disposed) return;
        const dark = mapNight();
        let ts = [];
        const targetFor = (b) => {
          const info = sceneRef.current?.buildings.find((x) => x.id === b.id) || b;
          return (b.zone && ts.find((x) => x.key === b.zone)) || ts.find((x) => x.key === `b${b.id}`)
            || { key: `b${b.id}`, title: b.name || 'Tòa nhà', sub: b.name ? null : 'Chưa có tên trên bản đồ', kind: 'building', buildings: [info], box: A.bbox([b.pts]), height: info.height || 10 };
        };
        const scene = A.createCampus(host.current, data, {
          dark, mobile: isMobile(),
          onPick: (b) => {
            if (!b) { if (!sceneRef.current?.walking()) select(null); return; }
            select(targetFor(b), { fly: false });
          },
          onNear: (b) => setNear(b ? targetFor(b) : null),
          onInteract: (b) => { if (selRef.current) select(null); else if (b) select(targetFor(b), { fly: false }); }, // E toggles the card
          onView: (v) => {
            if (v.lockError) toast('Trình duyệt chưa cho khóa chuột. Bấm vào bản đồ một lần rồi nhấn O lại nhé.', 'info', 4000);
            setView({ fp: v.fp, locked: v.locked, mode: v.mode || 'walk' });
          },
          onExitWalk: () => exitWalk(),
          onPickPlayer: (id) => worldPick.current?.(id),
          onBillboard: showAd,
          onFrame: ({ project, compass: c, distance, walk }) => {
            if (walk) drawMinimap(miniRef.current, mmRef.current, walk);
            worldFrame.current?.(project);
            // place labels by priority (zones first, nearest first) and hide ones that would overlap
            const placed = [];
            const items = labelEls.map((l) => ({ ...l, p: project(...l.t.anchor) }))
              .sort((a, b) => (a.t.minor - b.t.minor) || ((a.p?.depth ?? 9) - (b.p?.depth ?? 9)));
            for (const { el, t, p, w } of items) {
              let show = p && p.x > -60 && p.x < innerWidth + 60 && p.y > -40 && p.y < innerHeight + 40 && (!t.minor || distance < 560);
              if (show) {
                const r = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 40, y1: p.y - 12 };
                if (placed.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) show = false;
                else placed.push(r);
              }
              el.style.display = show ? '' : 'none';
              if (show) { el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.style.zIndex = String(1000 - Math.round(p.depth * 1000)); }
            }
            setCompass(c);
          },
        });
        sceneRef.current = scene;
        mmRef.current = minimapImage(data, A, dark);
        dataRef.current = { data, A };
        if (location.hostname === 'localhost') window.__map = scene;
        ts = buildTargets(scene, data, A);
        setTargets(ts);
        // labels
        for (const t of ts.filter((x) => x.label)) {
          const el = document.createElement('button');
          el.className = 'map-pin' + (t.minor ? ' minor' : '') + (t.poi ? ` poi-${t.poi}` : '');
          el.type = 'button';
          el.innerHTML = `<span class="map-pin-text"></span>`;
          el.firstChild.textContent = t.kind === 'zone' && !t.group ? t.title.replace(/^Khu /, 'KHU ').replace(/^Nhà /, 'NHÀ ') : t.title;
          el.addEventListener('click', () => select(t));
          labelsRef.current.appendChild(el);
          labelEls.push({ el, t, w: el.firstChild.offsetWidth || 70 });
        }
        scene.requestRender();
        setState('ready');
        // deep link: /map?k=F or /map?room=F305
        const sp = new URLSearchParams(location.search);
        const want = sp.get('room') || sp.get('k');
        if (want) {
          const hit = search(ts, want)[0];
          if (hit) setTimeout(() => select(hit), 400);
        }
        if (sp.get('server') === '1') { history.replaceState(history.state, '', location.pathname); setTimeout(() => startServer(), 300); }
      } catch (e) {
        console.error(e);
        setErr(e.message || String(e));
        setState('error');
      }
    })();
    // follow light/dark changes
    // follow the app theme only while the user has not picked day/night on the map
    const mo = new MutationObserver(() => { const n = mapNight(); setNight(n); applyNight(n); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const hintTimer = setTimeout(() => setHint(false), 6000);
    return () => {
      disposed = true; mo.disconnect(); clearTimeout(hintTimer);
      sceneRef.current?.dispose(); sceneRef.current = null;
      document.title = 'DUT Campus Streak';
    };
  }, []);

  // today's classes (only when logged in) to show "you study here today"
  useEffect(() => {
    if (!loggedIn) return;
    loadTodayClasses().then(setClasses).catch(() => setClasses([]));
  }, []);

  function select(t, { fly = true } = {}) {
    const scene = sceneRef.current;
    setSel(t);
    setHint(false);
    if (!scene) return;
    scene.setSelected(t ? t.buildings : []);
    if (t && fly) {
      if (scene.walking()) scene.teleport(...frontOf(t), lookOf(t)); // walk mode: appear in front of it
      else if (t.kind === 'poi') scene.flyTo([t.anchor[0], 0, t.anchor[2]], 140);
      else scene.focusBox(t.box, t.height);
    }
    const url = new URL(location.href);
    url.search = t ? `?k=${encodeURIComponent(t.roomHit || t.key)}` : '';
    history.replaceState(history.state, '', url);
  }

  function startWalk(t) {
    const scene = sceneRef.current;
    if (!scene) return;
    setSel(null); scene.setSelected([]);
    setHint(false);
    scene.startWalk(t ? frontOf(t) : null, t ? lookOf(t) : null);
    setWalking(true);
    setWalkHint(true);
    setTimeout(() => setWalkHint(false), 9000);
    history.replaceState(history.state, '', location.pathname);
  }
  async function startServer() {
    if (!appStore.get().session && !devName()) {
      try { sessionStorage.setItem('cs-after-login', '/map?server=1'); } catch { /* storage off */ }
      toast('Đăng nhập (hoặc đăng ký) để vào server cùng các bạn sinh viên khác nhé.', 'info', 4200);
      navigate('/login');
      return;
    }
    let l = await savedLook().catch(() => null);
    if (!l) { l = await editLook(null, { first: true }); if (!l) return; }
    setLook(l);
    sceneRef.current?.setLook(l);
    startWalk(null);
    setServer(true);
  }
  async function changeLook() {
    const l = await editLook(look);
    if (!l) return;
    setLook(l);
    sceneRef.current?.setLook(l);
  }
  function exitWalk() {
    setServer(false);
    sceneRef.current?.stopWalk();
    setWalking(false);
    setView({ fp: false, locked: false, mode: 'walk' });
    setNear(null);
    setWalkHint(false);
  }

  function applyNight(n) {
    sceneRef.current?.setTheme(n);
    if (dataRef.current) mmRef.current = minimapImage(dataRef.current.data, dataRef.current.A, n);
  }
  const pinsBtn = (cls = '') => html`<button class=${'map-btn map-pins ' + cls + (showPins ? '' : ' off')} onClick=${(e) => { e.currentTarget.blur(); togglePins(); }}
    aria-label=${showPins ? 'Ẩn các nhãn trên bản đồ' : 'Hiện các nhãn trên bản đồ'} title=${showPins ? 'Ẩn nhãn (H)' : 'Hiện nhãn (H)'}><${Icon} name=${showPins ? 'pin' : 'eyeOff'} size=${19} /></button>`;

  function toggleNight() {
    const n = !night;
    try { writeLocal(TIME_KEY, n ? 'night' : 'day'); } catch { /* storage off */ }
    setNight(n);
    applyNight(n);
    toast(n ? 'Đã chuyển sang ban đêm 🌙' : 'Đã chuyển sang ban ngày ☀️', 'info', 1600);
  }
  const timeBtn = (cls = '') => html`<button class=${'map-btn map-time ' + cls} aria-label=${night ? 'Chuyển sang ban ngày' : 'Chuyển sang ban đêm'}
    title=${night ? 'Chuyển sang ban ngày' : 'Chuyển sang ban đêm'} onClick=${toggleNight}><${Icon} name=${night ? 'sun' : 'moon'} size=${19} /></button>`;

  const results = focusSearch ? search(targets, q) : [];
  const pick = (t) => { setQ(''); setFocusSearch(false); document.activeElement?.blur?.(); select(t); };
  const goBack = () => (walking ? exitWalk() : back(appStore.get().session ? '/' : '/login'));
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && isMobile()) await navigator.share({ title: `${sel.title} · Bản đồ DUT 3D`, url });
      else { await navigator.clipboard.writeText(url); toast('Đã sao chép link vị trí.', 'success'); }
    } catch { /* cancelled */ }
  };

  const here = sel && classes && sel.letter ? classes.filter((c) => roomLetter(c.room) === sel.letter[0]) : [];

  return html`<div class=${'map-page' + (walking ? ' walking' : '') + (walking && server ? ' server' : '')}>
    <div class="map-canvas" ref=${host}></div>
    <div class=${'map-labels' + (showPins ? '' : ' off')} ref=${labelsRef}></div>

    <div class="map-top">
      <button class="map-btn" aria-label=${walking ? 'Thoát đi bộ' : 'Quay lại'} title=${walking ? 'Thoát đi bộ (Esc)' : 'Quay lại'} onClick=${goBack}><${Icon} name=${walking ? 'x' : 'back'} size=${20} /></button>
      <div class=${'map-search' + (focusSearch ? ' open' : '')}>
        <span class="map-search-icon"><${Icon} name="zoom" size=${18} /></span>
        <input value=${q} placeholder="Tìm khu, phòng (vd F305), thư viện…" aria-label="Tìm trên bản đồ"
          onInput=${(e) => setQ(e.target.value)} onFocus=${() => setFocusSearch(true)}
          onBlur=${() => setTimeout(() => setFocusSearch(false), 150)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); e.target.blur(); } }} />
        ${q && html`<button class="map-search-clear" aria-label="Xoá" onMouseDown=${(e) => { e.preventDefault(); setQ(''); }}><${Icon} name="x" size=${16} /></button>`}
        ${focusSearch && q && html`<div class="map-results pop-in">
          ${results.length ? results.map((t) => html`<button class="map-result" onMouseDown=${(e) => { e.preventDefault(); pick(t); }}>
            <span class=${'map-result-icon' + (t.poi ? ' poi' : '')}><${Icon} name=${t.poi === 'gate' ? 'flag' : t.kind === 'zone' ? 'school' : 'pin'} size=${16} /></span>
            <span class="grow"><b>${t.roomHit ? `Phòng ${t.roomHit}` : t.title}</b><span class="muted small">${t.roomHit ? `thuộc ${t.title}` : t.sub || (t.osm || [])[0] || ''}</span></span>
          </button>`) : html`<div class="muted small map-noresult">Không tìm thấy “${q}”.</div>`}
        </div>`}
      </div>
    </div>

    ${state === 'ready' && server && walking && html`<${WorldLayer} scene=${sceneRef.current} frameRef=${worldFrame} pickRef=${worldPick} look=${look} fp=${view.fp} mobile=${mobile}
      onClosed=${() => setServer(false)} onEditLook=${changeLook} />`}
    ${state === 'ready' && !server && stats.online > 0 && html`<div class="map-stats pop-in" title=${stats.visits ? `Hôm nay: ${fmtCount(stats.visits.today)} lượt · Tổng: ${fmtCount(stats.visits.total)} lượt${stats.visits.users ? ` · ${fmtCount(stats.visits.users)} tài khoản đã đăng ký` : ''}` : 'Số người đang mở bản đồ'}>
      <span class="map-live-dot" aria-hidden="true"></span><span><b>${fmtCount(stats.online)}</b> đang xem</span>
      ${stats.visits && html`<span class="map-stats-sep" aria-hidden="true"></span><span><b>${fmtCount(stats.visits.total)}</b> lượt<span class="map-stats-long"> truy cập</span></span>`}
      ${stats.visits?.users > 0 && html`<span class="map-stats-sep" aria-hidden="true"></span><span title="Số tài khoản đã đăng ký"><b>${fmtCount(stats.visits.users)}</b> tài khoản</span>`}
    </div>`}
    ${state === 'ready' && walking && html`<div class="map-mini"><canvas ref=${miniRef}></canvas><span class="map-mini-n" style=${`transform: rotate(${compass}rad)`}><b>N</b></span></div>`}
    ${state === 'ready' && walking && timeBtn('walk-time')}
    ${state === 'ready' && walking && pinsBtn('walk-pins')}
    ${state === 'ready' && walking && html`<div class="map-ride" role="group" aria-label="Phương tiện">
      ${[['walk', '🚶', 'Đi bộ (1)'], ['scooter', '🛵', 'Xe tay ga (2)'], ['moto', '🏍️', 'Xe máy (3)']].map(([m, ico, label]) => html`
        <button class=${'map-ride-btn' + (view.mode === m ? ' on' : '')} title=${label} aria-label=${label} aria-pressed=${view.mode === m}
          onClick=${(e) => { e.currentTarget.blur(); sceneRef.current?.setMode(m); }}><span>${ico}</span></button>`)}
    </div>`}
    ${state === 'ready' && walking && near && !sel && html`<button class="map-near pop-in" key=${near.key} onClick=${() => select(near, { fly: false })}>
      <${Icon} name="pin" size=${16} /><span>Gần <b>${near.title}</b></span><span class="map-near-key">${mobile ? 'Chạm để xem' : 'Nhấn E'}</span></button>`}
    ${state === 'ready' && walking && seat && html`<button class="map-seat pop-in" onClick=${(e) => { e.currentTarget.blur(); sceneRef.current?.toggleSit(); setSeat(sceneRef.current?.sitting() ? 'on' : 'can'); }}>
      🪑 <span>${seat === 'on' ? 'Đứng dậy' : 'Ngồi xuống ghế'}</span>${!mobile && html`<span class="map-near-key">E</span>`}</button>`}
    ${state === 'ready' && walking && walkHint && !mobile && html`<div class="map-hint pop-in"><b>W A S D</b> di chuyển · <b>Shift</b> chạy · <b>Space</b> nhảy (bóp còi khi đi xe) · <b>1 2 3</b> đi bộ / xe tay ga / xe máy · <b>H</b> ẩn nhãn · <b>O</b> khóa chuột để nhìn quanh · lăn chuột sát vào (hoặc <b>F</b>) để vào góc nhìn thứ nhất · <b>E</b> xem tòa nhà${server ? html` · <b>/</b> chat` : ''} · <b>Esc</b> thoát</div>`}
    ${state === 'ready' && walking && (view.fp || view.locked) && html`<div class="map-crosshair" aria-hidden="true"></div>`}
    ${state === 'ready' && walking && !mobile && html`<div class=${'map-lock-chip' + (view.locked ? ' on' : '')}>${view.locked
      ? html`<b>Đang khóa chuột</b> · di chuột để nhìn · nhấn <b>O</b> hoặc <b>Esc</b> để mở`
      : html`Nhấn <b>O</b> để khóa chuột và nhìn quanh${view.fp ? '' : html` · lăn chuột để zoom`}`}${view.fp ? html` · <b>Góc nhìn thứ nhất</b>` : ''}</div>`}
    ${state === 'ready' && walking && walkHint && mobile && html`<div class="map-hint pop-in walk-hint-m">Kéo cần bên trái để đi (đẩy hết cỡ để chạy) · vuốt màn hình để xoay · 2 ngón để zoom</div>`}
    ${state === 'ready' && walking && mobile && html`<${Joystick} onMove=${(x, y) => sceneRef.current?.setJoy(x, y)} />
      <button class=${'joy-eye' + (view.fp ? ' on' : '')} aria-label="Đổi góc nhìn" onClick=${() => sceneRef.current?.setFirstPerson(!view.fp)}><${Icon} name="eye" size=${22} /></button>
      <button class="joy-jump" aria-label=${view.mode === 'walk' ? 'Nhảy' : 'Bóp còi'} onPointerDown=${(e) => { e.preventDefault(); sceneRef.current?.jump(); }}>${view.mode === 'walk' ? html`<span class="joy-jump-arrow"></span>` : html`<${Icon} name="bell" size=${26} />`}</button>`}
    ${state === 'ready' && !walking && !sel && html`<div class="map-walk-btns pop-in">
      <button class="map-walk-btn" onClick=${() => startWalk(null)}>
        <span class="map-walk-ico">🚶</span><span class="grow"><b>Đi dạo một mình</b><span class="small">Nhập vai sinh viên, xuất phát từ cổng chính</span></span></button>
      <button class="map-walk-btn server" onClick=${startServer}>
        <span class="map-walk-ico">🌐</span><span class="grow"><b>Vào server</b><span class="small">${loggedIn ? 'Gặp, chat và họp voice với các bạn khác' : 'Cần đăng nhập · gặp và chat với các bạn khác'}</span></span></button>
    </div>`}

    ${state === 'ready' && !walking && html`<div class="map-tools">
      <button class="map-btn compass" aria-label="Xoay về hướng Bắc" title="Hướng Bắc" onClick=${() => sceneRef.current?.faceNorth()}>
        <span class="compass-needle" style=${`transform: rotate(${compass}rad)`}><b>N</b></span></button>
      <button class="map-btn" aria-label="Phóng to" onClick=${() => sceneRef.current?.zoom(0.6)}><${Icon} name="plus" size=${20} /></button>
      <button class="map-btn" aria-label="Thu nhỏ" onClick=${() => sceneRef.current?.zoom(1.6)}><span class="minus"></span></button>
      <button class="map-btn" aria-label="Toàn cảnh" title="Toàn cảnh" onClick=${() => { select(null); sceneRef.current?.goHome(); }}><${Icon} name="crosshair" size=${19} /></button>
      ${timeBtn()}
      ${pinsBtn()}
    </div>`}

    ${state === 'ready' && !walking && hint && !sel && html`<div class="map-hint pop-in overview-hint">${isMobile()
      ? 'Kéo 1 ngón để di chuyển · 2 ngón để xoay, nghiêng, thu phóng · Chạm vào tòa nhà để xem'
      : 'Kéo chuột trái để di chuyển · chuột phải để xoay · lăn chuột để thu phóng · bấm vào tòa nhà để xem'}</div>`}

    ${sel && html`<section class="map-card pop-in" key=${sel.key}>
      <div class="map-card-head">
        <span class=${'map-card-icon' + (sel.poi ? ' poi' : '')}><${Icon} name=${sel.kind === 'zone' ? 'school' : sel.poi === 'gate' ? 'flag' : 'pin'} size=${22} /></span>
        <div class="grow">
          <h2>${sel.roomHit ? `Phòng ${sel.roomHit}` : sel.title}</h2>
          <div class="muted small">${sel.roomHit ? `Nằm ở ${sel.title}` : sel.sub || ''}</div>
        </div>
        <button class="icon-btn" aria-label="Đóng" onClick=${() => select(null)}><${Icon} name="x" size=${20} /></button>
      </div>
      <div class="map-card-body">
        ${sel.letter && html`<div class="map-fact"><${Icon} name="school" size=${16} /><span>Phòng học có mã bắt đầu bằng <b>${sel.letter}</b> (ví dụ ${sel.letter}201).</span></div>`}
        ${(sel.facts || []).map((f) => html`<div class="map-fact"><${Icon} name="info" size=${16} /><span>${f}</span></div>`)}
        ${sel.group && html`<div class="map-fact"><${Icon} name="grid" size=${16} /><span>Gồm ${sel.key === 'C' ? 'các dãy C1, C2, C3' : 'các dãy E1, E2'}.</span></div>`}
        ${sel.osm?.length > 0 && html`<div class="map-fact"><${Icon} name="info" size=${16} /><span>Tên trên OpenStreetMap: ${sel.osm.join(', ')}</span></div>`}
        ${here.length > 0 && html`<div class="map-today">
          <div class="small"><b>Hôm nay bạn học ở đây</b></div>
          ${here.map((c) => html`<div class="map-class"><span class="grow ellipsis">${c.subject}</span><b>${c.room}</b><span class="muted">${fmtTime(c.startTime)}</span></div>`)}
        </div>`}
      </div>
      <div class="map-card-actions">
        <button class="btn btn-ghost btn-sm" onClick=${share}><${Icon} name="users" size=${16} /> Chia sẻ vị trí</button>
        ${!walking && sel.box && html`<button class="btn btn-primary btn-sm" onClick=${() => startWalk(sel)}>🚶 Đi bộ tới đây</button>`}
      </div>
    </section>`}

    ${state === 'loading' && html`<div class="map-loading"><${Spinner} size=${26} /><span>Đang dựng bản đồ 3D…</span></div>`}
    ${state === 'error' && html`<div class="map-loading"><b>Không mở được bản đồ</b><span class="muted small">${err}</span>
      <button class="btn btn-primary btn-sm" onClick=${() => location.reload()}>Thử lại</button></div>`}
    <a class="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  </div>`;
}
