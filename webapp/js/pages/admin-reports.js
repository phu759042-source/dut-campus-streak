// Reports from the chat (report_user) for the /admin page: who reported whom and why, the message when there is one,
// and what to do about it (ignore, delete the message, ban from chat for a while or until lifted).
import { html, useState, useEffect } from 'preact';
import { supabase, hideStorageUrl } from '../lib.js';
import { Avatar, Skeleton, ErrorBox, Segmented, toast, confirmDialog } from '../ui.js';
import { chatErr, openUserCard } from '../chat.js';

const REASON = { spam: 'Spam, quảng cáo', harass: 'Quấy rối, đe dọa', offensive: 'Ngôn từ thô tục, xúc phạm', impersonate: 'Giả mạo', other: 'Khác' };
const when = (t) => new Date(t).toLocaleString('vi-VN', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const BANS = [[24, 'Khóa chat 1 ngày'], [168, 'Khóa chat 7 ngày'], [0, 'Khóa chat vô thời hạn']];

export function ReportsCard() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  async function load() {
    setErr('');
    const { data, error } = await supabase.rpc('admin_reports', { p_status: status });
    if (error) return setErr(chatErr(error));
    setRows(data || []);
  }
  useEffect(() => { setRows(null); load(); }, [status]);

  async function resolve(r, ban, del) {
    if (ban != null && !await confirmDialog({ title: 'Khóa chat?', message: `${BANS.find((b) => b[0] === ban)[1]} cho ${r.reported_name}.`, confirmText: 'Khóa', danger: true })) return;
    setBusy(r.id);
    const { error } = await supabase.rpc('admin_resolve_report', { p_id: r.id, p_ban_hours: ban, p_delete_message: !!del });
    setBusy(null);
    if (error) return toast(chatErr(error), 'error');
    toast('Đã xử lý báo cáo', 'success');
    load();
  }
  async function unban(r) {
    setBusy(r.id);
    const { error } = await supabase.rpc('admin_unban_chat', { p_user: r.reported });
    setBusy(null);
    if (error) return toast(chatErr(error), 'error');
    toast(`Đã mở khóa chat cho ${r.reported_name}`, 'success');
    load();
  }

  return html`<section class="card adm-card">
    <h3 class="card-title">Báo cáo người dùng (chat)</h3>
    <div class="adm-filters"><${Segmented} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'Chưa xử lý' }, { value: 'resolved', label: 'Đã xử lý' }, { value: 'all', label: 'Tất cả' }]} /></div>
    ${err ? html`<${ErrorBox} message=${err} onRetry=${load} />`
      : !rows ? html`<${Skeleton} h=${90} count=${2} />`
      : !rows.length ? html`<p class="muted">${status === 'open' ? 'Không có báo cáo nào cần xử lý 🎉' : 'Chưa có báo cáo nào.'}</p>`
      : html`<div class="rp-list">${rows.map((r) => html`<div key=${r.id} class="rp-item">
          <div class="rp-head">
            <button class="rp-who" onClick=${() => openUserCard(r.reported)}><${Avatar} url=${hideStorageUrl(r.reported_avatar)} name=${r.reported_name} size=${36} />
              <span><b>${r.reported_name}</b><span class="small muted">${r.reports_on_user} báo cáo${r.banned_until ? ' · đang bị khóa chat' : ''}</span></span></button>
            <span class="chip chip-red">${REASON[r.reason] || r.reason}</span>
          </div>
          ${r.message_body && html`<div class="chat-quote">“${r.message_body}” <span class="small muted">· ${when(r.message_at)}</span></div>`}
          ${r.details && html`<p class="small" style="margin:6px 0 0">${r.details}</p>`}
          <div class="small muted" style="margin-top:6px">Báo cáo bởi ${r.reporter_name} · ${when(r.created_at)}${r.status === 'resolved' ? ` · Đã xử lý: ${r.action || ''}` : ''}</div>
          <div class="rp-acts">
            ${r.status === 'open' && html`
              <button class="btn btn-ghost btn-sm" disabled=${busy === r.id} onClick=${() => resolve(r, null, false)}>Bỏ qua</button>
              ${r.message_body && r.message_body !== '(đã xóa)' && html`<button class="btn btn-ghost btn-sm" disabled=${busy === r.id} onClick=${() => resolve(r, null, true)}>Xóa tin nhắn</button>`}
              ${BANS.map(([h, label]) => html`<button class="btn btn-danger btn-sm" disabled=${busy === r.id} onClick=${() => resolve(r, h, true)}>${label}</button>`)}`}
            ${r.banned_until && html`<button class="btn btn-ghost btn-sm" disabled=${busy === r.id} onClick=${() => unban(r)}>Mở khóa chat</button>`}
          </div>
        </div>`)}</div>`}
  </section>`;
}
