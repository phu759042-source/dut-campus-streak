// /chat: the app's own chat (separate from the chat inside the 3D map server).
//   Phòng chung – one room for every signed-in student
//   Tin nhắn    – private conversations (/chat/:id is one of them)
//   Bạn bè      – friend requests and friends
// Rules (length, rate limit, blocks, bans) are checked in the database; see js/chat.js for the live feed.
import { html, useState, useEffect, useRef, useLayoutEffect } from 'preact';
import { supabase, currentUser, hideStorageUrl } from '../lib.js';
import { Icon, Avatar, Spinner, Skeleton, Empty, ErrorBox, Segmented, toast, openSheet, confirmDialog } from '../ui.js';
import { PageHeader } from './shared.js';
import { navigate, back } from '../router.js';
import {
  chatErr, loadPeople, personOf, onChat, useChatStore, chatStore, refreshUnread, setOpenThread,
  openUserCard, openReport,
} from '../chat.js';

const PAGE = 50;
const hm = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const dayKey = (t) => new Date(t).toLocaleDateString('vi-VN');
function dayLabel(t) {
  const d = new Date(t), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  if (d.toDateString() === y.toDateString()) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
}
function ago(t) {
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  return new Date(t).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
}

/** The messages of the general room (peer = null) or of one private conversation, live, plus the box to write. */
function Conversation({ peer }) {
  const me = currentUser()?.id;
  const { blocks, ban } = useChatStore();
  const [msgs, setMsgs] = useState(null);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);
  const [, setNames] = useState(0); // re-render when names arrive
  const box = useRef();
  const stick = useRef(true); // follow new messages while the list is scrolled to the bottom
  const keepFrom = useRef(null); // keep the view still while older messages are added on top

  const query = () => {
    const q = supabase.from('chat_messages').select('id, sender_id, recipient_id, body, created_at, deleted_at');
    return peer ? q.or(`and(sender_id.eq.${me},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${me})`) : q.is('recipient_id', null);
  };
  const mine = (r) => (peer ? (r.sender_id === me && r.recipient_id === peer) || (r.sender_id === peer && r.recipient_id === me) : r.recipient_id === null);
  const named = async (rows) => { await loadPeople(rows.map((r) => r.sender_id)); setNames((n) => n + 1); };

  async function load() {
    setErr(''); setMsgs(null);
    const { data, error } = await query().order('id', { ascending: false }).limit(PAGE);
    if (error) return setErr(chatErr(error));
    const rows = (data || []).reverse();
    await named(rows);
    stick.current = true;
    setMsgs(rows); setMore((data || []).length === PAGE);
    if (peer) supabase.rpc('chat_mark_read', { p_peer: peer }).then(refreshUnread, () => {});
  }
  async function older() {
    if (!msgs?.length) return;
    const { data, error } = await query().lt('id', msgs[0].id).order('id', { ascending: false }).limit(PAGE);
    if (error) return toast(chatErr(error), 'error');
    const rows = (data || []).reverse();
    await named(rows);
    const el = box.current;
    keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
    stick.current = false;
    setMsgs((m) => [...rows, ...m]); setMore(rows.length === PAGE);
  }
  useEffect(() => {
    load();
    setOpenThread(peer || null);
    return () => setOpenThread(null);
  }, [peer]);
  useEffect(() => onChat(async (ev, row) => {
    if (!mine(row)) return;
    if (ev === 'INSERT') {
      await named([row]);
      setMsgs((m) => (m && !m.some((x) => x.id === row.id) ? [...m, row] : m));
      if (peer && row.sender_id === peer) supabase.rpc('chat_mark_read', { p_peer: peer }).then(refreshUnread, () => {});
    } else setMsgs((m) => m && m.map((x) => (x.id === row.id ? { ...x, ...row } : x)));
  }), [peer]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (keepFrom.current != null) { el.scrollTop = el.scrollHeight - keepFrom.current; keepFrom.current = null; } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  function menu(m) {
    const own = m.sender_id === me;
    openSheet(({ close }) => html`<div class="stack-sm">
      <div class="chat-quote">${m.body}</div>
      <button class="btn btn-ghost btn-block" onClick=${() => { navigator.clipboard?.writeText(m.body); toast('Đã sao chép'); close(); }}>Sao chép</button>
      ${own ? html`<button class="btn btn-danger btn-block" onClick=${async () => {
        close();
        if (!await confirmDialog({ title: 'Xóa tin nhắn?', message: 'Mọi người sẽ thấy "Tin nhắn đã bị xóa".', confirmText: 'Xóa', danger: true })) return;
        const { error } = await supabase.rpc('delete_chat_message', { p_id: m.id });
        if (error) toast(chatErr(error), 'error');
      }}>Xóa tin nhắn</button>`
        : html`<button class="btn btn-ghost btn-block" onClick=${() => { close(); openUserCard(m.sender_id); }}>Xem hồ sơ ${personOf(m.sender_id).name}</button>
          <button class="btn btn-danger btn-block" onClick=${() => { close(); openReport(m.sender_id, personOf(m.sender_id).name, m.id); }}>Báo cáo tin nhắn</button>`}
    </div>`, { title: 'Tin nhắn' });
  }

  const shown = (msgs || []).filter((m) => m.sender_id === me || !blocks.has(m.sender_id));
  return html`<div class="chat-conv">
    <div class="chat-msgs" ref=${box} onScroll=${onScroll}>
      ${err ? html`<${ErrorBox} message=${err} onRetry=${load} />`
        : !msgs ? html`<div class="center" style="padding:40px"><${Spinner} /></div>`
        : !shown.length ? html`<${Empty} icon="chat" title=${peer ? 'Chưa có tin nhắn nào' : 'Phòng chung còn trống'} text=${peer ? 'Gửi lời chào đầu tiên nhé 👋' : 'Hãy là người mở lời đầu tiên 👋'} />`
        : html`${more && html`<button class="btn btn-ghost btn-sm chat-older" onClick=${older}>Xem tin nhắn cũ hơn</button>`}
          ${shown.map((m, i) => {
            const prev = shown[i - 1], next = shown[i + 1];
            const own = m.sender_id === me;
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const first = newDay || prev.sender_id !== m.sender_id || new Date(m.created_at) - new Date(prev.created_at) > 5 * 60e3;
            const last = !next || next.sender_id !== m.sender_id || dayKey(next.created_at) !== dayKey(m.created_at) || new Date(next.created_at) - new Date(m.created_at) > 5 * 60e3;
            const p = personOf(m.sender_id);
            return html`<div key=${m.id}>
              ${newDay && html`<div class="chat-day"><span>${dayLabel(m.created_at)}</span></div>`}
              <div class=${'chat-row' + (own ? ' own' : '') + (first ? ' first' : '')}>
                ${!own && !peer && html`<button class="chat-av" aria-label=${'Hồ sơ ' + p.name} style=${last ? '' : 'visibility:hidden'} onClick=${() => openUserCard(m.sender_id)}><${Avatar} url=${p.avatar} name=${p.name} size=${32} /></button>`}
                <div class="chat-col">
                  ${!own && !peer && first && html`<button class="chat-name" onClick=${() => openUserCard(m.sender_id)}><b>${p.name}</b>${p.cls && html`<span>${p.cls}</span>`}</button>`}
                  <button class=${'chat-bubble' + (m.deleted_at ? ' deleted' : '')} disabled=${!!m.deleted_at} onClick=${() => menu(m)}>
                    ${m.deleted_at ? 'Tin nhắn đã bị xóa' : m.body}<span class="chat-time">${hm(m.created_at)}</span>
                  </button>
                </div>
              </div>
            </div>`;
          })}`}
    </div>
    ${ban ? html`<div class="note chat-banned"><${Icon} name="ban" /> <span>Bạn đang bị khóa chat${String(ban).includes('infinity') ? '' : ` đến ${new Date(ban).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}`} do vi phạm quy định.</span></div>`
      : html`<${Composer} peer=${peer} onSent=${(row) => { stick.current = true; setMsgs((m) => (m && !m.some((x) => x.id === row.id) ? [...m, row] : m)); }} />`}
  </div>`;
}

function Composer({ peer, onSent }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const grow = () => { const el = ref.current; if (el) { el.style.height = 'auto'; const h = Math.max(46, el.scrollHeight + 3); el.style.height = Math.min(h, 120) + 'px'; el.classList.toggle('scrolls', h > 120); } };
  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('send_chat_message', { p_body: body, p_to: peer || null });
    setBusy(false);
    if (error) {
      if (String(error.message).includes('chat_banned')) supabase.rpc('my_chat_ban').then(({ data: b }) => chatStore.set({ ban: b || null }));
      return toast(chatErr(error), 'error');
    }
    setText(''); setTimeout(grow, 0);
    if (data?.id) onSent(data);
    ref.current?.focus();
  }
  return html`<form class="chat-composer" onSubmit=${send}>
    <textarea ref=${ref} class="input" rows="1" maxlength="1000" placeholder=${peer ? 'Nhắn tin…' : 'Nhắn vào phòng chung…'} value=${text}
      onInput=${(e) => { setText(e.target.value); grow(); }}
      onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) send(e); }}></textarea>
    <button class="btn btn-primary chat-send" aria-label="Gửi" disabled=${busy || !text.trim()}><${Icon} name="send" size=${20} /></button>
  </form>`;
}

function Inbox() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  async function load() {
    const { data, error } = await supabase.rpc('chat_conversations');
    if (error) return setErr(chatErr(error));
    setErr(''); setRows(data || []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => onChat((ev, row) => { if (row.recipient_id) load(); }), []);
  if (err) return html`<${ErrorBox} message=${err} onRetry=${load} />`;
  if (!rows) return html`<${Skeleton} h=${64} count=${4} />`;
  if (!rows.length) return html`<${Empty} icon="chat" title="Chưa có cuộc trò chuyện nào" text="Bấm vào hồ sơ một bạn (ở phòng chung, bảng xếp hạng hay danh sách bạn bè) rồi chọn Nhắn tin." />`;
  return html`<div class="chat-list">${rows.map((r) => html`<button key=${r.peer_id} class=${'chat-item' + (r.unread ? ' unread' : '')} onClick=${() => navigate('/chat/' + r.peer_id)}>
    <${Avatar} url=${hideStorageUrl(r.avatar_url)} name=${r.display_name} size=${46} />
    <span class="grow chat-item-text"><b>${r.display_name}</b>
      <span class="small muted">${r.last_mine ? 'Bạn: ' : ''}${r.last_deleted ? 'Tin nhắn đã bị xóa' : r.last_body}</span></span>
    <span class="chat-item-side"><span class="small muted">${ago(r.last_at)}</span>${r.unread ? html`<span class="badge">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</span>
  </button>`)}</div>`;
}

function Friends() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  async function load() {
    const { data, error } = await supabase.rpc('my_friends');
    if (error) return setErr(chatErr(error));
    setErr(''); setRows(data || []);
  }
  useEffect(() => { load(); }, []);
  async function act(id, fn, ok) {
    setBusy(id);
    const { error } = await supabase.rpc(fn, { p_user: id });
    setBusy(null);
    if (error) return toast(chatErr(error), 'error');
    if (ok) toast(ok, 'success');
    load();
  }
  if (err) return html`<${ErrorBox} message=${err} onRetry=${load} />`;
  if (!rows) return html`<${Skeleton} h=${64} count=${3} />`;
  const received = rows.filter((r) => r.status === 'received'), friends = rows.filter((r) => r.status === 'friends'), sent = rows.filter((r) => r.status === 'sent');
  const person = (r, actions) => html`<div key=${r.user_id} class="chat-item">
    <button class="chat-item-who" onClick=${() => openUserCard(r.user_id)}><${Avatar} url=${hideStorageUrl(r.avatar_url)} name=${r.display_name} size=${44} /><b>${r.display_name}</b></button>
    <span class="chat-item-acts">${actions}</span>
  </div>`;
  if (!rows.length) return html`<${Empty} icon="users" title="Chưa có bạn bè" text="Mở hồ sơ một bạn ở phòng chung hoặc bảng xếp hạng rồi bấm Kết bạn." />`;
  return html`<div class="stack">
    ${received.length > 0 && html`<section><h3 class="section-title">Lời mời kết bạn (${received.length})</h3><div class="chat-list">
      ${received.map((r) => person(r, html`<button class="btn btn-primary btn-sm" disabled=${busy === r.user_id} onClick=${() => act(r.user_id, 'friend_request', 'Đã chấp nhận kết bạn 🎉')}>Chấp nhận</button>
        <button class="btn btn-ghost btn-sm" disabled=${busy === r.user_id} onClick=${() => act(r.user_id, 'friend_remove')}>Từ chối</button>`))}</div></section>`}
    ${friends.length > 0 && html`<section><h3 class="section-title">Bạn bè (${friends.length})</h3><div class="chat-list">
      ${friends.map((r) => person(r, html`<button class="btn btn-ghost btn-sm" onClick=${() => navigate('/chat/' + r.user_id)}><${Icon} name="chat" size=${16} /> Nhắn tin</button>`))}</div></section>`}
    ${sent.length > 0 && html`<section><h3 class="section-title">Đã gửi lời mời (${sent.length})</h3><div class="chat-list">
      ${sent.map((r) => person(r, html`<button class="btn btn-ghost btn-sm" disabled=${busy === r.user_id} onClick=${() => act(r.user_id, 'friend_remove', 'Đã hủy lời mời')}>Hủy</button>`))}</div></section>`}
  </div>`;
}

const TAB_KEY = 'cs-chat-tab';
export function ChatPage({ id }) {
  const { unread } = useChatStore();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem(TAB_KEY) || 'room'; } catch { return 'room'; } });
  const pick = (t) => { setTab(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* storage off */ } };
  const [peerName, setPeerName] = useState(null);
  useEffect(() => { if (id) loadPeople([id]).then(() => setPeerName(personOf(id))); }, [id]);

  if (id) {
    const p = peerName || { name: '…', avatar: null };
    return html`<div class="page narrow chat-page">
      <header class="page-head slide-down chat-head">
        <button class="icon-btn" aria-label="Quay lại" onClick=${() => back('/chat')}><${Icon} name="back" /></button>
        <button class="chat-peer grow" onClick=${() => openUserCard(id)}><${Avatar} url=${p.avatar} name=${p.name} size=${38} /><span><b>${p.name}</b><span class="small muted">${p.cls ? `Lớp ${p.cls} · ` : ''}Xem hồ sơ</span></span></button>
      </header>
      <${Conversation} peer=${id} key=${id} />
    </div>`;
  }
  return html`<div class=${'page narrow chat-page' + (tab === 'room' ? '' : ' scroll')}>
    <${PageHeader} title="Chat" subtitle=${tab === 'room' ? 'Phòng chung cho mọi sinh viên đã đăng nhập' : tab === 'dm' ? 'Tin nhắn riêng' : 'Bạn bè và lời mời kết bạn'} />
    <div class="chat-tabs"><${Segmented} value=${tab} onChange=${pick} options=${[
      { value: 'room', label: html`<i class="seg-emoji">💬</i>Phòng chung` },
      { value: 'dm', label: html`<i class="seg-emoji">✉️</i>Tin nhắn${unread ? html`<span class="seg-badge">${unread > 99 ? '99+' : unread}</span>` : ''}` },
      { value: 'friends', label: html`<i class="seg-emoji">👥</i>Bạn bè` },
    ]} /></div>
    ${tab === 'room' ? html`<${Conversation} peer=${null} key="room" />` : tab === 'dm' ? html`<${Inbox} />` : html`<${Friends} />`}
  </div>`;
}

