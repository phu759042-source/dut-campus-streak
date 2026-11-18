// Chat shared by the whole app: the live feed of messages (Supabase Realtime), the unread count on the Chat tab,
// names and avatars of the people in it, blocks, and the profile actions (message, add friend, report, block).
// The data and the rules live in supabase/migrations/20261118120000_chat_friends_reports.sql.
import { html, useState, useEffect } from 'preact';
import { supabase, currentUser, errMsg, createStore, appStore, hideStorageUrl } from './lib.js';
import { Icon, Avatar, Spinner, toast, openSheet, confirmDialog } from './ui.js';
import { navigate } from './router.js';

export const chatStore = createStore({ unread: 0, blocks: new Set(), ban: null });
export function useChatStore() {
  const [s, setS] = useState(chatStore.get());
  useEffect(() => chatStore.subscribe(setS), []);
  return s;
}

const ERR = {
  too_fast: 'Bạn gửi nhanh quá, chờ vài giây rồi gửi tiếp nhé.',
  empty_message: 'Tin nhắn trống.',
  message_too_long: 'Tin nhắn dài quá (tối đa 1000 ký tự).',
  blocked_by_them: 'Bạn không thể nhắn cho người này.',
  you_blocked_them: 'Bạn đã chặn người này. Bỏ chặn để nhắn tiếp.',
  no_such_user: 'Tài khoản này không còn tồn tại.',
  too_many_reports: 'Hôm nay bạn đã gửi nhiều báo cáo rồi, mai thử lại nhé.',
  too_many_requests: 'Hôm nay bạn đã gửi quá nhiều lời mời kết bạn.',
  blocked: 'Không thể kết bạn vì một trong hai người đã chặn người kia.',
  cannot_delete: 'Không xóa được tin nhắn này.',
};
export function chatErr(e) {
  const raw = String(e?.message || e || '');
  const ban = raw.match(/chat_banned:(.*)/);
  if (ban) return ban[1].trim() ? `Bạn đang bị khóa chat đến ${ban[1].trim()}.` : 'Bạn đang bị khóa chat.';
  for (const [k, v] of Object.entries(ERR)) if (raw.includes(k)) return v;
  return errMsg(e);
}

// ---- names and avatars --------------------------------------------------------------------------
const people = new Map(); // id -> { name, avatar }
export const personOf = (id) => people.get(id) || { name: 'Sinh viên', avatar: null };
export async function loadPeople(ids) {
  const need = [...new Set(ids)].filter((id) => id && !people.has(id));
  if (!need.length) return;
  const { data } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', need);
  for (const p of data || []) people.set(p.id, { name: String(p.display_name || '').trim() || 'Sinh viên', avatar: hideStorageUrl(p.avatar_url) });
  for (const id of need) if (!people.has(id)) people.set(id, { name: 'Sinh viên', avatar: null });
}

// ---- live feed ----------------------------------------------------------------------------------
const listeners = new Set();
/** Calls fn(event, row) for every new ('INSERT') or changed ('UPDATE', a deleted message) row this user may see. */
export function onChat(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let channel = null, startedFor = null;
export let openThread = null; // the private conversation on screen, if any (its messages are not unread)
export const setOpenThread = (id) => { openThread = id; };

export async function refreshUnread() {
  const { data } = await supabase.rpc('chat_unread_total');
  chatStore.set({ unread: Number(data) || 0 });
}
export async function refreshBlocks() {
  const me = currentUser()?.id;
  if (!me) return;
  const { data } = await supabase.from('user_blocks').select('blocked').eq('blocker', me);
  chatStore.set({ blocks: new Set((data || []).map((r) => r.blocked)) });
}

/** Starts the feed once per signed-in account (called from app.js). */
export function startChat() {
  const me = currentUser()?.id;
  if (!me || startedFor === me) return;
  stopChat();
  startedFor = me;
  refreshUnread().catch(() => {});
  refreshBlocks().catch(() => {});
  supabase.rpc('my_chat_ban').then(({ data }) => chatStore.set({ ban: data || null }), () => {});
  channel = supabase.channel('chat-' + me)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (p) => {
      const row = p.new;
      if (!row?.id) return;
      if (p.eventType === 'INSERT' && row.recipient_id === me && row.sender_id !== openThread && !chatStore.get().blocks.has(row.sender_id)) {
        chatStore.set((s) => ({ unread: s.unread + 1 }));
        if (!location.pathname.startsWith('/chat')) {
          loadPeople([row.sender_id]).then(() => toast(`💬 ${personOf(row.sender_id).name}: ${row.body.slice(0, 80)}`, 'info', 4000));
        }
      }
      listeners.forEach((fn) => fn(p.eventType, row));
    })
    .subscribe();
}
export function stopChat() {
  if (channel) supabase.removeChannel(channel);
  channel = null; startedFor = null;
  chatStore.set({ unread: 0, blocks: new Set(), ban: null });
}
appStore.subscribe((s) => { if (!s.session) stopChat(); });

// ---- profile actions ----------------------------------------------------------------------------
const REASONS = [
  ['spam', 'Spam, quảng cáo'],
  ['harass', 'Quấy rối, đe dọa'],
  ['offensive', 'Ngôn từ thô tục, xúc phạm'],
  ['impersonate', 'Giả mạo người khác'],
  ['other', 'Lý do khác'],
];

function ReportForm({ userId, name, messageId, close }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!reason) return toast('Hãy chọn lý do báo cáo.', 'error');
    setBusy(true);
    const { error } = await supabase.rpc('report_user', { p_user: userId, p_reason: reason, p_details: details || null, p_message: messageId || null });
    setBusy(false);
    if (error) return toast(chatErr(error), 'error');
    toast('Đã gửi báo cáo. Cảm ơn bạn, quản trị viên sẽ xem xét.', 'success');
    close();
  }
  return html`<div class="stack">
    <p class="muted small" style="margin:0">Báo cáo <b>${name}</b>${messageId ? ' vì tin nhắn này' : ''}. Người bị báo cáo không biết ai đã báo cáo.</p>
    <div class="report-reasons">${REASONS.map(([k, label]) => html`<label class=${'report-reason' + (reason === k ? ' on' : '')}>
      <input type="radio" name="reason" checked=${reason === k} onChange=${() => setReason(k)} /> ${label}</label>`)}</div>
    <textarea class="input" rows="3" maxlength="1000" placeholder="Mô tả thêm (không bắt buộc)" value=${details} onInput=${(e) => setDetails(e.target.value)}></textarea>
    <button class="btn btn-primary btn-block" disabled=${busy} onClick=${send}>${busy ? html`<${Spinner} size=${18} />` : 'Gửi báo cáo'}</button>
  </div>`;
}
export function openReport(userId, name, messageId = null) {
  openSheet(({ close }) => html`<${ReportForm} userId=${userId} name=${name} messageId=${messageId} close=${() => close()} />`, { title: 'Báo cáo người dùng' });
}

/** Message / add friend / report / block buttons for someone's profile card. */
export function ProfileActions({ userId, name, onDone }) {
  const me = currentUser()?.id;
  const [rel, setRel] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    const { data } = await supabase.rpc('relation_with', { p_user: userId });
    setRel(data?.[0] || { friend: 'none', i_blocked: false, blocked_me: false });
  }
  useEffect(() => { if (userId && userId !== me) load(); }, [userId]);
  if (!userId || userId === me) return null;
  if (!rel) return html`<div class="pactions"><${Spinner} size=${18} /></div>`;
  const run = async (fn, ok) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast(chatErr(error), 'error');
    if (ok) toast(ok, 'success');
    load();
  };
  const friendBtn = {
    none: html`<button class="btn btn-ghost" disabled=${busy} onClick=${() => run(() => supabase.rpc('friend_request', { p_user: userId }), 'Đã gửi lời mời kết bạn')}><${Icon} name="userPlus" size=${18} /> Kết bạn</button>`,
    sent: html`<button class="btn btn-ghost" disabled=${busy} onClick=${() => run(() => supabase.rpc('friend_remove', { p_user: userId }), 'Đã hủy lời mời')}><${Icon} name="clock" size=${18} /> Đã gửi lời mời</button>`,
    received: html`<button class="btn btn-ghost" disabled=${busy} onClick=${() => run(() => supabase.rpc('friend_request', { p_user: userId }), 'Hai bạn đã là bạn bè 🎉')}><${Icon} name="userCheck" size=${18} /> Chấp nhận kết bạn</button>`,
    friends: html`<button class="btn btn-ghost" disabled=${busy} onClick=${async () => {
      if (await confirmDialog({ title: 'Hủy kết bạn?', message: `Bỏ ${name} khỏi danh sách bạn bè?`, confirmText: 'Hủy kết bạn', danger: true })) run(() => supabase.rpc('friend_remove', { p_user: userId }), 'Đã hủy kết bạn');
    }}><${Icon} name="userCheck" size=${18} /> Bạn bè</button>`,
  }[rel.friend];
  async function toggleBlock() {
    if (rel.i_blocked) return run(() => supabase.rpc('unblock_user', { p_user: userId }), 'Đã bỏ chặn').then(refreshBlocks);
    if (!await confirmDialog({ title: `Chặn ${name}?`, message: 'Người này sẽ không nhắn riêng cho bạn được nữa, tin nhắn của họ trong phòng chung bị ẩn với bạn, và hai bạn không còn là bạn bè.', confirmText: 'Chặn', danger: true })) return;
    await run(() => supabase.rpc('block_user', { p_user: userId }), 'Đã chặn');
    refreshBlocks();
  }
  return html`<div class="pactions">
    ${!rel.i_blocked && !rel.blocked_me && html`<button class="btn btn-primary" onClick=${() => { onDone?.(); navigate('/chat/' + userId); }}><${Icon} name="chat" size=${18} /> Nhắn tin</button>`}
    ${!rel.i_blocked && !rel.blocked_me && friendBtn}
    <div class="pactions-minor">
      <button class="link small" onClick=${() => { onDone?.(); openReport(userId, name); }}><${Icon} name="flag" size=${15} /> Báo cáo</button>
      <button class="link small" disabled=${busy} onClick=${toggleBlock}><${Icon} name="ban" size=${15} /> ${rel.i_blocked ? 'Bỏ chặn' : 'Chặn'}</button>
    </div>
  </div>`;
}

/** A short profile card (from a chat message or the friends list) with the actions. */
function UserCard({ userId, close }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    supabase.rpc('get_public_profile', { p_user_id: userId }).then(({ data }) => setP(data?.[0] || {}));
  }, [userId]);
  if (!p) return html`<div class="center" style="padding:30px"><${Spinner} /></div>`;
  const name = String(p.display_name || personOf(userId).name);
  return html`<div class="pcard">
    <div class="pcard-banner" style=${p.banner_url ? `background-image:url('${hideStorageUrl(p.banner_url)}')` : ''}></div>
    <div class="pcard-avatar"><${Avatar} url=${hideStorageUrl(p.avatar_url)} name=${name} size=${88} ring /></div>
    <div class="pcard-body">
      <div class="pcard-name">${name}</div>
      <div class="muted">${p.class_name || 'Chưa có lớp'}</div>
      <div class="pcard-stats" style="grid-template-columns:repeat(2,1fr)">
        <div><b>🔥 ${Number(p.current_streak) || 0}</b><span>Streak ngày</span></div>
        <div><b>${Number(p.total_check_ins) || 0}</b><span>Check-in</span></div>
      </div>
      <${ProfileActions} userId=${userId} name=${name} onDone=${close} />
    </div>
  </div>`;
}
export function openUserCard(userId) {
  openSheet(({ close }) => html`<${UserCard} userId=${userId} close=${() => close()} />`, { title: 'Hồ sơ' });
}
