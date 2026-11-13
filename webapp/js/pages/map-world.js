// Server mode UI for the 3D campus map: name tags and chat bubbles over everyone, the shared chat,
// player list, meetings with voice chat, emotes, the character customizer, and football at the stadium
// (game in ../soccer.js, its UI in map-soccer.js).
import { html, useState, useEffect, useLayoutEffect, useRef } from 'preact';
import { supabase } from '../lib.js';
import { Icon, toast, openSheet } from '../ui.js';
import { connectWorld, EMOTES, devName } from '../world.js';
import { SoccerHud, SoccerPanel, SoccerChip, TEAM_CSS, showBoard } from './map-soccer.js';
import { shouldAskRating, snoozeRating, openRating, Stars } from '../rating.js';

const LOOK_LABELS = { skin: 'Màu da', hair: 'Kiểu tóc', hc: 'Màu tóc', shirt: 'Áo', pants: 'Quần', bag: 'Balo', glasses: 'Kính' };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const fmtTime = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Saved look of the logged-in student, or null if they never picked one. */
export async function savedLook() {
  if (devName()) { try { return JSON.parse(sessionStorage.getItem('cs-dev-look')); } catch { return null; } }
  const { data } = await supabase.auth.getUser();
  return data.user?.user_metadata?.campus_look || null;
}

/** Opens the character customizer. Resolves with the new look (saved to the account) or undefined. */
export function editLook(initial, { first = false } = {}) {
  return openSheet(({ close }) => html`<${LookEditor} initial=${initial} first=${first} close=${close} />`,
    { title: first ? 'Tạo nhân vật của bạn' : 'Nhân vật của bạn', wide: true });
}

function LookEditor({ initial, first, close }) {
  const canvas = useRef();
  const view = useRef(null);
  const [W, setW] = useState(null); // walk.js (look lists), loaded with three.js
  const [look, setLook] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let raf = 0, alive = true;
    (async () => {
      const [THREE, walk] = await Promise.all([import('three'), import('../walk.js')]);
      if (!alive) return;
      setW(walk);
      setLook((l) => ({ ...walk.DEFAULT_LOOK, ...(l || {}) }));
      const r = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, devicePixelRatio));
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 4, 3); scene.add(sun);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      cam.position.set(0, 1.35, 5.2); cam.lookAt(0, 1.05, 0);
      const holder = new THREE.Group(); scene.add(holder);
      view.current = { THREE, walk, r, scene, cam, holder, s: null, spin: 0.5, drag: null };
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const v = view.current, c = canvas.current;
        if (!v || !c) return;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
        if (!v.drag) v.spin += 0.006;
        holder.rotation.y = v.spin;
        r.render(scene, cam);
      };
      loop();
    })();
    return () => {
      alive = false; cancelAnimationFrame(raf);
      const v = view.current;
      if (v) { if (v.s) v.walk.disposeStudent(v.s); v.r.dispose(); }
    };
  }, []);

  // rebuild the preview when the look changes
  useEffect(() => {
    const v = view.current;
    if (!v || !look) return;
    if (v.s) { v.holder.clear(); v.walk.disposeStudent(v.s); }
    v.s = v.walk.makeStudent(look);
    v.s.armL.rotation.z = -0.12; v.s.armR.rotation.z = 0.12;
    v.holder.add(v.s.group);
  }, [look, W]);

  const drag = {
    onPointerDown: (e) => { if (view.current) { view.current.drag = { x: e.clientX, s: view.current.spin }; e.currentTarget.setPointerCapture(e.pointerId); } },
    onPointerMove: (e) => { const v = view.current; if (v?.drag) v.spin = v.drag.s + (e.clientX - v.drag.x) * 0.012; },
    onPointerUp: () => { if (view.current) view.current.drag = null; },
  };

  async function save() {
    setSaving(true);
    if (devName()) { try { sessionStorage.setItem('cs-dev-look', JSON.stringify(look)); } catch { /* storage off */ } close(look); return; }
    const { error } = await supabase.auth.updateUser({ data: { campus_look: look } });
    setSaving(false);
    if (error) { toast('Chưa lưu được nhân vật: ' + error.message, 'error'); return; }
    close(look);
  }
  const random = () => {
    const out = {};
    for (const [k, list] of Object.entries(W.LOOK)) out[k] = Math.floor(Math.random() * list.length);
    out.glasses = Math.random() < 0.3 ? 1 : 0;
    setLook(out);
  };

  return html`<div class="look-editor">
    <div class="look-preview">
      <canvas ref=${canvas} ...${drag}></canvas>
      <span class="muted small">Kéo để xoay</span>
    </div>
    <div class="look-options">
      ${!W && html`<div class="muted">Đang tải…</div>`}
      ${W && look && Object.entries(W.LOOK).map(([k, list]) => html`<div class="look-row">
        <div class="field-label">${LOOK_LABELS[k]}</div>
        <div class="look-choices">${list.map((v, i) => typeof v === 'number'
          ? html`<button class=${'look-swatch' + (look[k] === i ? ' on' : '')} style=${`background:${hex(v)}`} aria-label=${`${LOOK_LABELS[k]} ${i + 1}`} aria-pressed=${look[k] === i} onClick=${() => setLook({ ...look, [k]: i })}></button>`
          : html`<button class=${'look-pill' + (look[k] === i ? ' on' : '')} aria-pressed=${look[k] === i} onClick=${() => setLook({ ...look, [k]: i })}>${v}</button>`)}</div>
      </div>`)}
      ${first && html`<p class="muted small">Tên trên đầu nhân vật là tên bạn dùng khi đăng ký tài khoản (đổi được trong Hồ sơ).</p>`}
      <div class="dialog-actions">
        <button class="btn btn-ghost" disabled=${!W} onClick=${random}>🎲 Ngẫu nhiên</button>
        <button class="btn btn-primary" disabled=${!W || saving} onClick=${save}>${saving ? 'Đang lưu…' : first ? 'Vào server' : 'Lưu'}</button>
      </div>
    </div>
  </div>`;
}

/**
 * Everything on screen while in server mode. `frameRef` / `pickRef` are filled with functions the map calls on
 * every drawn frame (to place name tags) and when another student is clicked.
 */
export function WorldLayer({ scene, frameRef, pickRef, look, fp, mobile, onClosed, onEditLook }) {
  const [status, setStatus] = useState('connecting');
  const [me, setMe] = useState(null);
  const [players, setPlayers] = useState({}); // id -> { id, name, look, m, away, r (whose bike they sit on) }
  const [meetings, setMeetings] = useState([]);
  const [chat, setChat] = useState([]);
  const [mchat, setMchat] = useState([]);
  const [myMeeting, setMyMeeting] = useState(null);
  const [voice, setVoice] = useState({ meeting: null, mic: false, muted: false, peers: [], speaking: [] });
  const [invites, setInvites] = useState([]);
  const [panel, setPanel] = useState(null); // players | meetings | emotes | chat (phone)
  const [chatTab, setChatTab] = useState('all');
  const [selPlayer, setSelPlayer] = useState(null);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const [socView, setSocView] = useState(null); // football: what to show (soccer.view())
  // riding pillion: whose bike you sit on, and the nearest bike you could hop on (E)
  const [myRide, setMyRide] = useState(null);
  const [rideNear, setRideNear] = useState(null);
  const rideRef = useRef({});
  // after 5 minutes in the server: a small "how do you like it?" card (once, unless already rated / snoozed)
  const [rateAsk, setRateAsk] = useState(false);
  useEffect(() => {
    if (status !== 'online') return undefined;
    const id = setTimeout(() => { shouldAskRating(0).then((v) => v && setRateAsk(true)); }, 5 * 60e3);
    return () => clearTimeout(id);
  }, [status === 'online']);
  rideRef.current = { mine: myRide, near: rideNear };
  const world = useRef(null);
  const soccer = useRef(null);
  const tags = useRef(new Map()); // id -> { el, name, bubble, until }
  const layer = useRef();
  const input = useRef();
  const msgsBox = useRef();
  const stick = useRef(true); // chat follows new messages unless you scrolled up to read
  const st = useRef({});
  st.current = { me, players, fp, panel, myMeeting };

  const bubble = (id, txt, ms) => {
    const t = tags.current.get(id) || {};
    tags.current.set(id, { ...t, bubble: txt, until: performance.now() + ms });
    scene.requestRender();
  };

  useEffect(() => {
    // football: loaded right after (it needs three.js, already there for the map); messages wait until then
    const socQueue = [];
    const toSoccer = (m) => (soccer.current ? soccer.current.handle(m) : socQueue.push(m));
    let dead = false;
    const w = connectWorld({
      look,
      getSelf: () => scene.self(),
      on: (m) => {
        switch (m.t) {
          case 'fs': case 'fb': case 'fe': case 'fpos': toSoccer(m); break;
          case 'status':
            setStatus(m.status);
            if (m.status === 'offline') { scene.players.clear(); setPlayers({}); scene.ride(null); setMyRide(null); }
            if (m.status === 'closed') { toast(m.msg || 'Đã rời server.', 'error', 4200); onClosed?.(); }
            break;
          case 'welcome': {
            setMe(m.me);
            scene.players.clear();
            scene.players.setMe(m.me.id);
            scene.ride(null); setMyRide(null);
            const all = {};
            for (const p of m.players) { all[p.id] = p; scene.players.add(p.id, p.look, p.p); if (p.r) scene.players.setRide(p.id, p.r); }
            setPlayers(all); setMeetings(m.meetings || []); setChat(m.chat || []);
            setMyMeeting(null); setMchat([]);
            st.current.me = m.me;
            soccer.current?.onWelcome();
            soccer.current?.syncKits();
            break;
          }
          case 'join':
            setPlayers((o) => ({ ...o, [m.p.id]: m.p }));
            scene.players.add(m.p.id, m.p.look, m.p.p);
            if (m.p.r) scene.players.setRide(m.p.id, m.p.r);
            soccer.current?.syncKits();
            break;
          case 'ride': { // someone got on / off a bike's back seat (maybe you, maybe yours)
            const myId = st.current.me?.id, name = (id) => st.current.players[id]?.name || 'bạn ấy';
            if (m.id === myId) {
              scene.ride(m.on || null); setMyRide(m.on || null);
              if (m.on) toast(`Đã ngồi sau xe ${name(m.on)} 🛵 ${mobile ? 'Bấm "Xuống xe" để xuống.' : 'Nhấn E để xuống.'}`, 'success', 3200);
              break;
            }
            const prev = st.current.players[m.id]?.r;
            scene.players.setRide(m.id, m.on || null);
            setPlayers((o) => (o[m.id] ? { ...o, [m.id]: { ...o[m.id], r: m.on || null } } : o));
            if (m.on && m.on === myId) toast(`${name(m.id)} vừa ngồi lên sau xe bạn 🛵`, 'info', 3000);
            else if (!m.on && prev && prev === myId) toast(`${name(m.id)} đã xuống xe`, 'info', 2200);
            break;
          }
          case 'leave':
            setPlayers((o) => { const n = { ...o }; delete n[m.id]; return n; });
            scene.players.remove(m.id);
            setSelPlayer((s) => (s === m.id ? null : s));
            if (rideRef.current.mine === m.id) { scene.ride(null); setMyRide(null); }
            break;
          case 'p': scene.players.setPos(m.id, m.p); break;
          case 'away': setPlayers((o) => (o[m.id] ? { ...o, [m.id]: { ...o[m.id], away: !!m.v } } : o)); break;
          case 'look':
            scene.players.setLook(m.id, m.look);
            soccer.current?.syncKits();
            setPlayers((o) => (o[m.id] ? { ...o, [m.id]: { ...o[m.id], look: m.look } } : o));
            break;
          case 'emo':
            bubble(m.id, EMOTES[m.e] || '👋', 2600);
            if (m.e === 0) scene.players.wave(m.id);
            break;
          case 'chat':
            bubble(m.id, m.text, 6500);
            if (m.m) setMchat((c) => [...c.slice(-80), m]);
            else setChat((c) => [...c.slice(-80), m]);
            if (m.id !== st.current.me?.id && document.activeElement !== input.current) setUnread((u) => u + 1);
            break;
          case 'meetings': {
            setMeetings(m.list);
            const mine = {};
            for (const mt of m.list) for (const u of mt.members) mine[u] = mt.id;
            setPlayers((o) => { const n = {}; for (const [id, p] of Object.entries(o)) n[id] = { ...p, m: mine[id] || null }; return n; });
            break;
          }
          case 'minvite':
            setInvites((l) => [...l.filter((x) => x.id !== m.id), m]);
            break;
          case 'mjoined':
            setMyMeeting(m.id); setMchat([]); setChatTab('meeting');
            break;
          case 'mpeer': toast(`${m.name} vừa vào phòng họp`, 'info', 2200); break;
          case 'mleft': setMyMeeting(null); setChatTab('all'); break;
          case 'voice':
            if (m.warn) toast(m.warn, 'info', 8000);
            else if (m.failed) toast(`Không nối được giọng nói với ${st.current.players[m.failed]?.name || 'một bạn'}: mạng hai bên không kết nối thẳng được với nhau. Chat chữ vẫn dùng bình thường.`, 'error', 9000);
            else setVoice(m);
            break;
          case 'error': toast(m.msg || 'Có lỗi.', 'error', 3500); break;
          default:
        }
      },
    });
    world.current = w;
    pickRef.current = (id) => { setSelPlayer(id); setPanel(null); };
    frameRef.current = placeTags;
    import('../soccer.js').then(({ createSoccer }) => {
      if (dead) return;
      soccer.current = createSoccer({
        map: scene, send: (o) => world.current?.send(o), serverNow: () => w.serverNow(), myId: () => st.current.me?.id,
        onChange: () => setSocView(soccer.current?.view() || null),
      });
      if (location.hostname === 'localhost') window.__soccer = soccer.current; // debugging
      for (const m of socQueue.splice(0)) soccer.current.handle(m);
      setSocView(soccer.current.view());
    }).catch((e) => console.warn('football', e));
    return () => {
      dead = true;
      soccer.current?.dispose(); soccer.current = null;
      document.querySelector('.map-page')?.classList.remove('in-soccer', 'soc-board-on');
      w.close(); world.current = null;
      scene.players.clear();
      pickRef.current = null; frameRef.current = null;
      for (const t of tags.current.values()) t.el?.remove();
      tags.current.clear();
    };
  }, []);

  // "/" opens the chat, Enter sends, Esc in the chat box closes it without leaving walk mode
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.body.classList.contains('no-scroll')) return;
      if (document.pointerLockElement) document.exitPointerLock();
      e.preventDefault();
      if (mobile) setPanel('chat');
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // bikes nearby you could hop on the back of (free back seat, within 3 m, you on foot)
  useEffect(() => {
    const id = setInterval(() => {
      const self = scene.self();
      let best = null, bd = 3;
      if (self && self[4] === 0 && !rideRef.current.mine) {
        const taken = new Set(Object.values(st.current.players).map((p) => p.r).filter(Boolean));
        for (const pid of scene.players.ids()) {
          const d = scene.players.get(pid);
          if (!d || (d.mode !== 1 && d.mode !== 2) || taken.has(pid)) continue;
          const dist = Math.hypot(d.x - self[0], d.z - self[1]);
          if (dist < bd) { bd = dist; best = pid; }
        }
      }
      if (best !== rideRef.current.near) setRideNear(best);
    }, 250);
    // E: get off, or hop on the bike next to you (before sitting on the stands / building info)
    scene.setInteract(() => {
      const r = rideRef.current;
      if (r.mine) { hopOff(); return true; }
      if (r.near) { hopOn(r.near); return true; }
      return false;
    });
    return () => { clearInterval(id); scene.setInteract(null); scene.ride(null); };
  }, []);

  // while in a team: the football buttons replace jump / bikes on the map page
  const inTeam = socView ? socView.myTeam >= 0 : false, board = showBoard(socView);
  useEffect(() => { document.querySelector('.map-page')?.classList.toggle('in-soccer', inTeam); }, [inTeam]);
  useEffect(() => { document.querySelector('.map-page')?.classList.toggle('soc-board-on', board); }, [board]);

  // keep look in sync when edited
  useEffect(() => { world.current?.setLook(look); }, [look]);

  /** Places a name tag (and chat bubble) over every student, including you. */
  function placeTags(project) {
    const box = layer.current; if (!box) return;
    const { me: self, players: ps, fp: firstPerson } = st.current;
    const heads = scene.players.heads();
    const mine = scene.self();
    if (self && mine && !firstPerson) heads.push({ id: self.id, x: mine[0], y: mine[2] + (mine[4] === 3 ? 1.38 : mine[4] ? 2.05 : 1.74), z: mine[1], me: true });
    const teams = soccer.current?.view().teams;
    const now = performance.now();
    const seen = new Set();
    for (const h of heads) {
      const info = h.me ? self : ps[h.id];
      if (!info) continue;
      seen.add(h.id);
      let t = tags.current.get(h.id);
      if (!t || !t.el) {
        const el = document.createElement('div');
        el.className = 'world-tag' + (h.me ? ' me' : '');
        el.innerHTML = '<div class="world-bubble"></div><div class="world-name"><i></i><span></span></div>';
        if (!h.me) el.addEventListener('click', () => { setSelPlayer(h.id); setPanel(null); });
        box.appendChild(el);
        t = { ...(t || {}), el };
        tags.current.set(h.id, t);
      }
      const p = project(h.x, h.y, h.z);
      const far = mine ? Math.hypot(h.x - mine[0], h.z - mine[1]) : 0;
      if (!p || far > 140) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      t.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      t.el.style.zIndex = String(1000 - Math.round(p.depth * 1000));
      const name = info.name + (info.m && !h.me ? ' 🎙' : '') + (info.away && !h.me ? ' 💤' : '');
      if (t.name !== name) { t.name = name; t.el.querySelector('.world-name span').textContent = name; }
      const showB = t.bubble && t.until > now;
      const bt = showB ? t.bubble : '';
      if (t.shown !== bt) { t.shown = bt; const b = t.el.querySelector('.world-bubble'); b.textContent = bt; b.style.display = bt ? '' : 'none'; }
      if (showB) scene.requestRender(); // keep drawing until the bubble disappears
      t.el.classList.toggle('far', far > 60);
      const team = teams ? (teams[0].includes(h.id) ? 0 : teams[1].includes(h.id) ? 1 : -1) : -1;
      if (t.team !== team) { t.team = team; t.el.style.setProperty('--team', team >= 0 ? TEAM_CSS[team] : ''); t.el.classList.toggle('team', team >= 0); }
      t.el.classList.toggle('away', !!info.away && !h.me);
    }
    for (const [id, t] of tags.current) if (!seen.has(id) && t.el) t.el.style.display = 'none';
  }
  // speaking ring on the name tags
  useEffect(() => {
    for (const [id, t] of tags.current) t.el?.classList.toggle('speaking', voice.speaking.includes(id === me?.id ? 'me' : id));
  }, [voice.speaking]);

  function send(e) {
    e.preventDefault();
    const v = text.trim();
    if (!v || !world.current) return;
    world.current.chat(v, chatTab === 'meeting' && myMeeting ? myMeeting : null);
    setText('');
    stick.current = true;
    if (!mobile) input.current?.blur(); // back to walking right away
  }
  // keep the newest message in view, unless you scrolled up to read older ones
  useLayoutEffect(() => { stick.current = true; }, [panel, chatTab]);
  useLayoutEffect(() => {
    const el = msgsBox.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const online = Object.keys(players).length + (me ? 1 : 0);
  const list = Object.values(players).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const meeting = meetings.find((x) => x.id === myMeeting);
  const nameOf = (id) => (id === me?.id ? me.name : players[id]?.name || 'Ai đó');
  const sel = selPlayer && players[selPlayer];
  const messages = chatTab === 'meeting' && myMeeting ? mchat : chat;

  function hopOn(id) { world.current?.send({ t: 'ride', on: id }); }
  function hopOff() { world.current?.send({ t: 'ride', on: null }); scene.ride(null); setMyRide(null); }
  const passenger = me && Object.values(players).find((p) => p.r === me.id);
  function goTo(id) {
    const p = scene.players.get(id); if (!p) return;
    if (myRide) hopOff();
    scene.teleport(p.x + 1.6 * Math.sin(p.h), p.z + 1.6 * Math.cos(p.h), [p.x, p.z], p.y); // on the same level (bridge, stands)
    setSelPlayer(null);
  }
  function inviteTo(id) {
    if (myMeeting) { world.current.invite(id); toast(`Đã mời ${players[id]?.name || ''} vào phòng họp.`, 'success'); }
    else { world.current.createMeeting(`${me?.name || 'Mình'} & ${players[id]?.name || 'bạn'}`, false, [id]); toast('Đã tạo phòng họp riêng và gửi lời mời.', 'success'); }
    setSelPlayer(null);
  }
  const emote = (i) => {
    world.current?.emote(i);
    if (me) bubble(me.id, EMOTES[i], 2600);
    setPanel(null);
  };

  return html`<div class="world" data-status=${status}>
    <div class="world-tags" ref=${layer}></div>

    <div class="world-bar">
      <button class=${'world-chip' + (panel === 'players' ? ' on' : '')} onClick=${() => setPanel(panel === 'players' ? null : 'players')} title="Người đang online">
        <span class=${'map-live-dot' + (status === 'online' ? '' : ' off')}></span>
        ${status === 'online' ? html`<span><b>${online}</b><span class="world-chip-long"> online</span></span>` : html`<span>${status === 'offline' ? 'Đang kết nối lại…' : 'Đang vào server…'}</span>`}
      </button>
      <button class=${'map-btn sm' + (panel === 'meetings' ? ' on' : '')} title="Phòng họp & voice chat" aria-label="Phòng họp" onClick=${() => setPanel(panel === 'meetings' ? null : 'meetings')}>🎙</button>
      <button class=${'map-btn sm' + (panel === 'emotes' ? ' on' : '')} title="Biểu cảm" aria-label="Biểu cảm" onClick=${() => setPanel(panel === 'emotes' ? null : 'emotes')}>😀</button>
      <${SoccerChip} v=${socView} open=${panel === 'soccer'} onOpen=${() => setPanel(panel === 'soccer' ? null : 'soccer')} />
      <button class="map-btn sm" title="Đổi nhân vật" aria-label="Đổi nhân vật" onClick=${() => { setPanel(null); onEditLook(); }}>👕</button>
      ${mobile && html`<button class=${'map-btn sm' + (panel === 'chat' ? ' on' : '')} aria-label="Chat" onClick=${() => { setUnread(0); setPanel(panel === 'chat' ? null : 'chat'); }}>💬${unread > 0 && html`<span class="world-badge">${unread > 9 ? '9+' : unread}</span>`}</button>`}
    </div>

    <${SoccerHud} v=${socView} soccer=${soccer.current} mobile=${mobile} onOpen=${() => setPanel('soccer')} />
    ${panel === 'soccer' && html`<${SoccerPanel} v=${socView} soccer=${soccer.current} me=${me?.id} nameOf=${nameOf} mobile=${mobile} onClose=${() => setPanel(null)} />`}

    ${panel === 'emotes' && html`<div class="world-panel emotes pop-in">${EMOTES.map((e, i) => html`<button class="world-emote" onClick=${() => emote(i)}>${e}</button>`)}</div>`}

    ${panel === 'players' && html`<div class="world-panel pop-in">
      <div class="world-panel-head"><b>Đang online (${online})</b><button class="icon-btn" aria-label="Đóng" onClick=${() => setPanel(null)}><${Icon} name="x" size=${18} /></button></div>
      ${me && html`<div class="world-row me"><span class="world-dot"></span><span class="grow"><b>${me.name}</b> <span class="muted small">(bạn)</span></span></div>`}
      ${list.length ? list.map((p) => html`<button class="world-row" onClick=${() => { setSelPlayer(p.id); setPanel(null); }}>
        <span class=${'world-dot' + (p.away ? ' away' : '')}></span><span class="grow"><b>${p.name}</b>${p.m && html` <span class="muted small">🎙 đang họp</span>`}${p.away && html` <span class="muted small">💤 tạm vắng</span>`}</span><${Icon} name="chevron" size=${16} />
      </button>`) : html`<p class="muted small">Chưa có ai khác. Rủ bạn bè vào campusstreak.com/map nhé!</p>`}
    </div>`}

    ${panel === 'meetings' && html`<${MeetingsPanel} meetings=${meetings} players=${players} me=${me} myMeeting=${myMeeting} nameOf=${nameOf}
      onCreate=${(name, open, invite) => world.current?.createMeeting(name, open, invite)}
      onJoin=${(id) => world.current?.joinMeeting(id)} onLeave=${() => world.current?.leaveMeeting()} onClose=${() => setPanel(null)} />`}

    ${sel && html`<div class="world-card pop-in">
      <div class="world-panel-head"><b>${sel.name}</b><button class="icon-btn" aria-label="Đóng" onClick=${() => setSelPlayer(null)}><${Icon} name="x" size=${18} /></button></div>
      ${sel.away && html`<div class="muted small">💤 Bạn này đang tạm vắng (để tab ở nền hoặc khoá màn hình), nên nhân vật đứng yên.</div>`}
      ${sel.m && html`<div class="muted small">🎙 Đang ở ${meetings.find((x) => x.id === sel.m)?.name || 'một phòng họp'}</div>`}
      <div class="world-card-actions">
        <button class="btn btn-ghost btn-sm" onClick=${() => goTo(sel.id)}>📍 Đi tới</button>
        <button class="btn btn-ghost btn-sm" onClick=${() => { emote(0); setSelPlayer(null); }}>👋 Vẫy tay</button>
        <button class="btn btn-primary btn-sm" onClick=${() => inviteTo(sel.id)}>🎙 ${myMeeting ? 'Mời vào phòng' : 'Rủ họp riêng'}</button>
      </div>
    </div>`}

    ${invites.map((iv) => html`<div class="world-invite pop-in" key=${iv.id}>
      <span class="grow"><b>${iv.from}</b> mời bạn vào phòng họp <b>${iv.name}</b></span>
      <button class="btn btn-primary btn-sm" onClick=${() => { world.current?.joinMeeting(iv.id); setInvites((l) => l.filter((x) => x.id !== iv.id)); }}>Vào</button>
      <button class="btn btn-ghost btn-sm" onClick=${() => setInvites((l) => l.filter((x) => x.id !== iv.id))}>Bỏ qua</button>
    </div>`)}

    ${rateAsk && html`<div class="world-rate pop-in">
      <span>Bạn thấy bản đồ 3D thế nào?</span>
      <${Stars} size=${24} onPick=${(s) => { setRateAsk(false); if (document.pointerLockElement) document.exitPointerLock(); openRating('map', s); }} />
      <button class="icon-btn" aria-label="Để sau" onClick=${() => { snoozeRating(); setRateAsk(false); }}>✕</button>
    </div>`}

    ${myRide ? html`<div class="world-ride pop-in"><span>🛵 Đang ngồi sau xe <b>${nameOf(myRide)}</b></span>
        <button class="btn btn-primary btn-sm" onClick=${(e) => { e.currentTarget.blur(); hopOff(); }}>Xuống xe${mobile ? '' : ' (E)'}</button></div>`
      : passenger ? html`<div class="world-ride pop-in"><span>🛵 <b>${passenger.name}</b> đang ngồi sau xe bạn</span>
        <button class="btn btn-ghost btn-sm" onClick=${(e) => { e.currentTarget.blur(); world.current?.send({ t: 'unride' }); }}>Cho xuống</button></div>`
      : rideNear ? html`<button class="world-ride pop-in" onClick=${(e) => { e.currentTarget.blur(); hopOn(rideNear); }}>
        <span>🛵 Ngồi sau xe <b>${nameOf(rideNear)}</b></span>${!mobile && html`<span class="map-near-key">E</span>`}</button>` : null}

    ${(!mobile || panel === 'chat') && html`<div class=${'world-chat' + (mobile ? ' sheet-like' : '')}>
      ${myMeeting && html`<div class="world-tabs">
        <button class=${chatTab === 'all' ? 'on' : ''} onClick=${() => setChatTab('all')}>Chung</button>
        <button class=${chatTab === 'meeting' ? 'on' : ''} onClick=${() => setChatTab('meeting')}>🎙 Phòng họp</button>
      </div>`}
      <div class="world-msgs" ref=${msgsBox} onScroll=${(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30; }}>${messages.slice(-30).map((c) => html`<div class="world-msg" key=${c.at + c.id}>
        <b class=${c.id === me?.id ? 'me' : ''}>${c.name}</b> <span>${c.text}</span> <i>${fmtTime(c.at)}</i></div>`)}</div>
      <form class="world-input" onSubmit=${send}>
        <input ref=${input} value=${text} maxLength="300" placeholder=${mobile ? 'Nhắn gì đó…' : 'Nhấn / để chat, Enter để gửi…'} aria-label="Tin nhắn"
          onInput=${(e) => setText(e.target.value)} onFocus=${() => setUnread(0)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !text.trim() && !mobile) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); e.currentTarget.blur(); } }} />
        <button class="map-btn sm" type="submit" aria-label="Gửi" disabled=${!text.trim()}><${Icon} name="chevron" size=${18} /></button>
      </form>
    </div>`}

    ${meeting && html`<div class="world-voice pop-in">
      <div class="world-voice-name"><b>🎙 ${meeting.name}</b><span class="muted small">${meeting.members.length} người · ${voice.mic ? (voice.muted ? 'mic đang tắt' : 'mic đang bật') : 'chỉ nghe'}</span></div>
      <div class="world-voice-people">${meeting.members.map((id) => {
        const speaking = voice.speaking.includes(id === me?.id ? 'me' : id);
        const peer = voice.peers.find((p) => p.id === id);
        return html`<span class=${'world-avatar' + (speaking ? ' speaking' : '') + (peer?.state === 'failed' ? ' failed' : '')} title=${nameOf(id) + (peer?.state === 'failed' ? ' (không kết nối được giọng nói)' : '')}>${nameOf(id).trim().charAt(0).toUpperCase()}</span>`;
      })}</div>
      <button class=${'map-btn sm' + (voice.muted || !voice.mic ? ' off' : '')} aria-label=${!voice.mic || voice.muted ? 'Bật mic' : 'Tắt mic'} title=${!voice.mic ? 'Bật micro' : voice.muted ? 'Bật mic' : 'Tắt mic'}
        onClick=${() => (voice.mic ? world.current?.voice.setMuted(!voice.muted) : world.current?.voice.enableMic())}>${voice.muted || !voice.mic ? '🔇' : '🎤'}</button>
      <button class="map-btn sm danger" aria-label="Rời phòng họp" title="Rời phòng họp" onClick=${() => world.current?.leaveMeeting()}>📞</button>
    </div>`}
  </div>`;
}

function MeetingsPanel({ meetings, players, me, myMeeting, nameOf, onCreate, onJoin, onLeave, onClose }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const [invite, setInvite] = useState([]);
  const others = Object.values(players);
  const visible = meetings.filter((m) => m.open || m.members.includes(me?.id) || (m.invited || []).includes(me?.id));
  return html`<div class="world-panel pop-in">
    <div class="world-panel-head"><b>Phòng họp & voice chat</b><button class="icon-btn" aria-label="Đóng" onClick=${onClose}><${Icon} name="x" size=${18} /></button></div>
    ${!creating && html`<button class="btn btn-primary btn-sm world-block" onClick=${() => { setCreating(true); setName(`Phòng của ${me?.name || 'mình'}`); }}>+ Tạo phòng họp</button>`}
    ${creating && html`<form class="world-form" onSubmit=${(e) => { e.preventDefault(); onCreate(name.trim(), open, invite); setCreating(false); setInvite([]); }}>
      <input class="input" value=${name} maxLength="40" placeholder="Tên phòng" onInput=${(e) => setName(e.target.value)} />
      <label class="switch-row small"><span>${open ? 'Công khai: ai cũng vào được' : 'Riêng tư: chỉ người được mời'}</span>
        <input type="checkbox" class="switch" checked=${open} onChange=${(e) => setOpen(e.target.checked)} /></label>
      ${others.length > 0 && html`<div class="field-label">Mời</div><div class="world-invite-list">${others.map((p) => html`<label class="world-check">
        <input type="checkbox" checked=${invite.includes(p.id)} onChange=${(e) => setInvite(e.target.checked ? [...invite, p.id] : invite.filter((x) => x !== p.id))} /> ${p.name}</label>`)}</div>`}
      <div class="dialog-actions"><button type="button" class="btn btn-ghost btn-sm" onClick=${() => setCreating(false)}>Hủy</button><button class="btn btn-primary btn-sm" type="submit">Tạo & vào phòng</button></div>
    </form>`}
    ${visible.length ? visible.map((m) => html`<div class="world-row">
      <span class="grow"><b>${m.open ? '' : '🔒 '}${m.name}</b><span class="muted small world-block">${m.members.map(nameOf).join(', ')}</span></span>
      ${m.id === myMeeting ? html`<button class="btn btn-ghost btn-sm" onClick=${onLeave}>Rời</button>` : html`<button class="btn btn-primary btn-sm" onClick=${() => onJoin(m.id)}>Vào</button>`}
    </div>`) : !creating && html`<p class="muted small">Chưa có phòng họp nào. Tạo một phòng rồi mời bạn bè; mọi người trong phòng nói chuyện được với nhau bằng micro.</p>`}
  </div>`;
}
