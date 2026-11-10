// /map: 3D map of the DUT campus. Public (no login needed) so new students can explore it.
// Three.js is loaded only when this page opens.
import { html, useState, useEffect, useRef } from 'preact';
import { appStore, loadTodayClasses, fmtTime } from '../lib.js';
import { Icon, Spinner, toast } from '../ui.js';
import { back } from '../router.js';

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
  S: { title: 'Nhà S' }, X: { title: 'Khu X' },
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
    T.push(fromBuildings(z, m.title, m.sub, list, { zone: z, letter: m.group || z, osm, keywords: m.keywords || '', label: true }));
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

function roomLetter(room) {
  const m = String(room || '').trim().toUpperCase().match(/^([A-Z])\s*\d/);
  return m ? m[1] : null;
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
  const loggedIn = !!appStore.get().session;

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
        ]);
        if (disposed) return;
        const dark = document.documentElement.dataset.theme === 'dark';
        let ts = [];
        const scene = A.createCampus(host.current, data, {
          dark, mobile: isMobile(),
          onPick: (b) => {
            if (!b) return select(null);
            const t = (b.zone && ts.find((x) => x.key === b.zone)) || ts.find((x) => x.key === `b${b.id}`)
              || { key: `b${b.id}`, title: b.name || 'Tòa nhà', sub: b.name ? null : 'Chưa có tên trên bản đồ', kind: 'building', buildings: [b], box: A.bbox([b.pts]), height: b.height };
            select(t, { fly: false });
          },
          onFrame: ({ project, compass: c, distance }) => {
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
      } catch (e) {
        console.error(e);
        setErr(e.message || String(e));
        setState('error');
      }
    })();
    // follow light/dark changes
    const mo = new MutationObserver(() => sceneRef.current?.setTheme(document.documentElement.dataset.theme === 'dark'));
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
      if (t.kind === 'poi') scene.flyTo([t.anchor[0], 0, t.anchor[2]], 140);
      else scene.focusBox(t.box, t.height);
    }
    const url = new URL(location.href);
    url.search = t ? `?k=${encodeURIComponent(t.roomHit || t.key)}` : '';
    history.replaceState(history.state, '', url);
  }

  const results = focusSearch ? search(targets, q) : [];
  const pick = (t) => { setQ(''); setFocusSearch(false); document.activeElement?.blur?.(); select(t); };
  const goBack = () => back(appStore.get().session ? '/' : '/login');
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && isMobile()) await navigator.share({ title: `${sel.title} · Bản đồ DUT 3D`, url });
      else { await navigator.clipboard.writeText(url); toast('Đã sao chép link vị trí.', 'success'); }
    } catch { /* cancelled */ }
  };

  const here = sel && classes && sel.letter ? classes.filter((c) => roomLetter(c.room) === sel.letter[0]) : [];

  return html`<div class="map-page">
    <div class="map-canvas" ref=${host}></div>
    <div class="map-labels" ref=${labelsRef}></div>

    <div class="map-top">
      <button class="map-btn" aria-label="Quay lại" onClick=${goBack}><${Icon} name="back" size=${20} /></button>
      <div class=${'map-search' + (focusSearch ? ' open' : '')}>
        <span class="map-search-icon"><${Icon} name="zoom" size=${18} /></span>
        <input value=${q} placeholder="Tìm khu, phòng (vd F305), thư viện…" aria-label="Tìm trên bản đồ"
          onInput=${(e) => setQ(e.target.value)} onFocus=${() => setFocusSearch(true)}
          onBlur=${() => setTimeout(() => setFocusSearch(false), 150)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); if (e.key === 'Escape') e.target.blur(); }} />
        ${q && html`<button class="map-search-clear" aria-label="Xoá" onMouseDown=${(e) => { e.preventDefault(); setQ(''); }}><${Icon} name="x" size=${16} /></button>`}
        ${focusSearch && q && html`<div class="map-results pop-in">
          ${results.length ? results.map((t) => html`<button class="map-result" onMouseDown=${(e) => { e.preventDefault(); pick(t); }}>
            <span class=${'map-result-icon' + (t.poi ? ' poi' : '')}><${Icon} name=${t.poi === 'gate' ? 'flag' : t.kind === 'zone' ? 'school' : 'pin'} size=${16} /></span>
            <span class="grow"><b>${t.roomHit ? `Phòng ${t.roomHit}` : t.title}</b><span class="muted small">${t.roomHit ? `thuộc ${t.title}` : t.sub || (t.osm || [])[0] || ''}</span></span>
          </button>`) : html`<div class="muted small map-noresult">Không tìm thấy “${q}”.</div>`}
        </div>`}
      </div>
    </div>

    ${state === 'ready' && html`<div class="map-tools">
      <button class="map-btn compass" aria-label="Xoay về hướng Bắc" title="Hướng Bắc" onClick=${() => sceneRef.current?.faceNorth()}>
        <span class="compass-needle" style=${`transform: rotate(${compass}rad)`}><b>N</b></span></button>
      <button class="map-btn" aria-label="Phóng to" onClick=${() => sceneRef.current?.zoom(0.6)}><${Icon} name="plus" size=${20} /></button>
      <button class="map-btn" aria-label="Thu nhỏ" onClick=${() => sceneRef.current?.zoom(1.6)}><span class="minus"></span></button>
      <button class="map-btn" aria-label="Toàn cảnh" title="Toàn cảnh" onClick=${() => { select(null); sceneRef.current?.goHome(); }}><${Icon} name="crosshair" size=${19} /></button>
    </div>`}

    ${state === 'ready' && hint && !sel && html`<div class="map-hint pop-in">${isMobile()
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
        ${sel.group && html`<div class="map-fact"><${Icon} name="grid" size=${16} /><span>Gồm ${sel.key === 'C' ? 'các dãy C1, C2, C3' : 'các dãy E1, E2'}.</span></div>`}
        ${sel.osm?.length > 0 && html`<div class="map-fact"><${Icon} name="info" size=${16} /><span>Tên trên OpenStreetMap: ${sel.osm.join(', ')}</span></div>`}
        ${here.length > 0 && html`<div class="map-today">
          <div class="small"><b>Hôm nay bạn học ở đây</b></div>
          ${here.map((c) => html`<div class="map-class"><span class="grow ellipsis">${c.subject}</span><b>${c.room}</b><span class="muted">${fmtTime(c.startTime)}</span></div>`)}
        </div>`}
      </div>
      <div class="map-card-actions">
        <button class="btn btn-ghost btn-sm" onClick=${share}><${Icon} name="users" size=${16} /> Chia sẻ vị trí</button>
      </div>
    </section>`}

    ${state === 'loading' && html`<div class="map-loading"><${Spinner} size=${26} /><span>Đang dựng bản đồ 3D…</span></div>`}
    ${state === 'error' && html`<div class="map-loading"><b>Không mở được bản đồ</b><span class="muted small">${err}</span>
      <button class="btn btn-primary btn-sm" onClick=${() => location.reload()}>Thử lại</button></div>`}
    <a class="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  </div>`;
}
