// Server mode UI for the 3D campus map: name tags and chat bubbles over everyone, the shared chat,
// player list, meetings with voice chat, emotes, and the character customizer.
import { html, useState, useEffect, useRef } from 'preact';
import { supabase } from '../lib.js';
import { Icon, toast, openSheet } from '../ui.js';
import { connectWorld, EMOTES, devName } from '../world.js';

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
  const [players, setPlayers] = useState({}); // id -> { id, name, look, m }
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
  const world = useRef(null);
  const tags = useRef(new Map()); // id -> { el, name, bubble, until }
  const layer = useRef();
  const input = useRef();
  const st = useRef({});
  st.current = { me, players, fp, panel, myMeeting };

  const bubble = (id, txt, ms) => {
    const t = tags.current.get(id) || {};
    tags.current.set(id, { ...t, bubble: txt, until: performance.now() + ms });
    scene.requestRender();
  };

  useEffect(() => {
    const w = connectWorld({
      look,
      getSelf: () => scene.self(),
      on: (m) => {
        switch (m.t) {
          case 'status':
            setStatus(m.status);
            if (m.status === 'offline') { scene.players.clear(); setPlayers({}); }
            if (m.status === 'closed') { toast(m.msg || 'Đã rời server.', 'error', 4200); onClosed?.(); }
            break;
          case 'welcome': {
            setMe(m.me);
            scene.players.clear();
            const all = {};
            for (const p of m.players) { all[p.id] = p; scene.players.add(p.id, p.look, p.p); }
            setPlayers(all); setMeetings(m.meetings || []); setChat(m.chat || []);
            setMyMeeting(null); setMchat([]);
            break;
          }
          case 'join':
            setPlayers((o) => ({ ...o, [m.p.id]: m.p }));
            scene.players.add(m.p.id, m.p.look, m.p.p);
            break;
          case 'leave':
            setPlayers((o) => { const n = { ...o }; delete n[m.id]; return n; });
            scene.players.remove(m.id);
            setSelPlayer((s) => (s === m.id ? null : s));
            break;
          case 'p': scene.players.setPos(m.id, m.p); break;
          case 'look':
            scene.players.setLook(m.id, m.look);
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
    return () => {
      w.close(); world.current = null;
      scene.players.clear();
      pickRef.current = null; frameRef.current = null;
      for (const t of tags.current.values()) t.el?.remove();
      tags.current.clear();
    };
  }, []);

  // Enter opens the chat (desktop), Esc in the chat box closes it without leaving walk mode
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.body.classList.contains('no-scroll')) return;
      if (document.pointerLockElement) document.exitPointerLock();
      e.preventDefault();
      if (mobile) setPanel('chat');
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // keep look in sync when edited
  useEffect(() => { world.current?.setLook(look); }, [look]);

  /** Places a name tag (and chat bubble) over every student, including you. */
  function placeTags(project) {
    const box = layer.current; if (!box) return;
    const { me: self, players: ps, fp: firstPerson } = st.current;
    const heads = scene.players.heads();
    const mine = scene.self();
    if (self && mine && !firstPerson) heads.push({ id: self.id, x: mine[0], y: mine[2] + (mine[4] ? 2.05 : 1.85), z: mine[1], me: true });
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
      const name = info.name + (info.m && !h.me ? ' 🎙' : '');
      if (t.name !== name) { t.name = name; t.el.querySelector('.world-name span').textContent = name; }
      const showB = t.bubble && t.until > now;
      const bt = showB ? t.bubble : '';
      if (t.shown !== bt) { t.shown = bt; const b = t.el.querySelector('.world-bubble'); b.textContent = bt; b.style.display = bt ? '' : 'none'; }
      if (showB) scene.requestRender(); // keep drawing until the bubble disappears
      t.el.classList.toggle('far', far > 60);
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
  }
  const online = Object.keys(players).length + (me ? 1 : 0);
  const list = Object.values(players).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const meeting = meetings.find((x) => x.id === myMeeting);
  const nameOf = (id) => (id === me?.id ? me.name : players[id]?.name || 'Ai đó');
  const sel = selPlayer && players[selPlayer];
  const messages = chatTab === 'meeting' && myMeeting ? mchat : chat;

  function goTo(id) {
    const p = scene.players.get(id); if (!p) return;
    scene.teleport(p.x + 1.6 * Math.sin(p.h), p.z + 1.6 * Math.cos(p.h), [p.x, p.z]);
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
      <button class="map-btn sm" title="Đổi nhân vật" aria-label="Đổi nhân vật" onClick=${() => { setPanel(null); onEditLook(); }}>👕</button>
      ${mobile && html`<button class=${'map-btn sm' + (panel === 'chat' ? ' on' : '')} aria-label="Chat" onClick=${() => { setUnread(0); setPanel(panel === 'chat' ? null : 'chat'); }}>💬${unread > 0 && html`<span class="world-badge">${unread > 9 ? '9+' : unread}</span>`}</button>`}
    </div>

    ${panel === 'emotes' && html`<div class="world-panel emotes pop-in">${EMOTES.map((e, i) => html`<button class="world-emote" onClick=${() => emote(i)}>${e}</button>`)}</div>`}

    ${panel === 'players' && html`<div class="world-panel pop-in">
      <div class="world-panel-head"><b>Đang online (${online})</b><button class="icon-btn" aria-label="Đóng" onClick=${() => setPanel(null)}><${Icon} name="x" size=${18} /></button></div>
      ${me && html`<div class="world-row me"><span class="world-dot"></span><span class="grow"><b>${me.name}</b> <span class="muted small">(bạn)</span></span></div>`}
      ${list.length ? list.map((p) => html`<button class="world-row" onClick=${() => { setSelPlayer(p.id); setPanel(null); }}>
        <span class="world-dot"></span><span class="grow"><b>${p.name}</b>${p.m && html` <span class="muted small">🎙 đang họp</span>`}</span><${Icon} name="chevron" size=${16} />
      </button>`) : html`<p class="muted small">Chưa có ai khác. Rủ bạn bè vào campusstreak.com/map nhé!</p>`}
    </div>`}

    ${panel === 'meetings' && html`<${MeetingsPanel} meetings=${meetings} players=${players} me=${me} myMeeting=${myMeeting} nameOf=${nameOf}
      onCreate=${(name, open, invite) => world.current?.createMeeting(name, open, invite)}
      onJoin=${(id) => world.current?.joinMeeting(id)} onLeave=${() => world.current?.leaveMeeting()} onClose=${() => setPanel(null)} />`}

    ${sel && html`<div class="world-card pop-in">
      <div class="world-panel-head"><b>${sel.name}</b><button class="icon-btn" aria-label="Đóng" onClick=${() => setSelPlayer(null)}><${Icon} name="x" size=${18} /></button></div>
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

    ${(!mobile || panel === 'chat') && html`<div class=${'world-chat' + (mobile ? ' sheet-like' : '')}>
      ${myMeeting && html`<div class="world-tabs">
        <button class=${chatTab === 'all' ? 'on' : ''} onClick=${() => setChatTab('all')}>Chung</button>
        <button class=${chatTab === 'meeting' ? 'on' : ''} onClick=${() => setChatTab('meeting')}>🎙 Phòng họp</button>
      </div>`}
      <div class="world-msgs">${messages.slice(-30).map((c) => html`<div class="world-msg" key=${c.at + c.id}>
        <b class=${c.id === me?.id ? 'me' : ''}>${c.name}</b> <span>${c.text}</span> <i>${fmtTime(c.at)}</i></div>`)}</div>
      <form class="world-input" onSubmit=${send}>
        <input ref=${input} value=${text} maxLength="300" placeholder=${mobile ? 'Nhắn gì đó…' : 'Nhấn Enter để chat…'} aria-label="Tin nhắn"
          onInput=${(e) => setText(e.target.value)} onFocus=${() => setUnread(0)}
          onKeyDown=${(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); e.currentTarget.blur(); } }} />
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
