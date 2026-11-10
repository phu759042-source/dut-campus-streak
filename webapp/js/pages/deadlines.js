import { html, useState, useEffect } from 'preact';
import { supabase, currentUser, errMsg } from '../lib.js';
import { Icon, Spinner, Skeleton, ErrorBox, Empty, openSheet, confirmDialog, toast, Field, Segmented, showMeme, useTick } from '../ui.js';
import { PageHeader } from './shared.js';

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(d) {
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function fmtDeadline(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function remaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const h = pad(Math.floor((s % 86400) / 3600)), m = pad(Math.floor((s % 3600) / 60)), sec = pad(s % 60);
  return days > 0 ? `Còn ${days} ngày ${h}:${m}:${sec}` : `${h}:${m}:${sec}`;
}

function TaskForm({ task, close }) {
  const existing = task ? new Date(task.deadline_at) : null;
  const def = existing || new Date(Date.now() + 86400000);
  const init = toLocalInput(def);
  const [title, setTitle] = useState(task?.title || '');
  const [desc, setDesc] = useState(task?.description || '');
  const [date, setDate] = useState(init.date);
  const [withTime, setWithTime] = useState(!!existing && !(existing.getHours() === 0 && existing.getMinutes() === 0));
  const [time, setTime] = useState(existing ? init.time : '23:59');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!title.trim()) return setError('Vui lòng nhập tên nhiệm vụ.');
    const [y, mo, d] = date.split('-').map(Number);
    let when;
    if (withTime) { const [h, mi] = time.split(':').map(Number); when = new Date(y, mo - 1, d, h, mi); }
    else when = new Date(y, mo - 1, d + 1, 0, 0); // end of the chosen day
    if (!(when > new Date())) return setError('Deadline phải ở thời điểm trong tương lai.');
    setBusy(true); setError(null);
    const payload = {
      title: title.trim(), description: desc.trim() || null,
      deadline_at: when.toISOString(), updated_at: new Date().toISOString(),
    };
    const uid = currentUser().id;
    const { error: err } = task
      ? await supabase.from('deadline_tasks').update(payload).eq('id', task.id).eq('user_id', uid)
      : await supabase.from('deadline_tasks').insert({ ...payload, user_id: uid });
    if (err) { setBusy(false); return setError('Không lưu được Deadline: ' + errMsg(err)); }
    close(true);
  }

  return html`<form class="stack" onSubmit=${save}>
    <${Field} label="Tên nhiệm vụ *"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="VD: Nộp bài tập Giải tích" /><//>
    <${Field} label="Mô tả (không bắt buộc)"><textarea class="input textarea" rows="2" value=${desc} onInput=${(e) => setDesc(e.target.value)}></textarea><//>
    <${Field} label="Ngày Deadline"><input class="input" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /><//>
    <label class="switch-row"><span>Chọn giờ cụ thể</span>
      <input type="checkbox" class="switch" checked=${withTime} onChange=${(e) => setWithTime(e.target.checked)} /></label>
    ${withTime ? html`<${Field} label="Giờ Deadline"><input class="input" type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /><//>`
      : html`<div class="muted small">Mặc định: hết ngày đã chọn (00:00 ngày hôm sau).</div>`}
    ${error && html`<div class="form-error shake">${error}</div>`}
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" onClick=${() => close(false)}>Hủy</button>
      <button class="btn btn-primary" disabled=${busy}>${busy ? html`<${Spinner} size=${18} />` : 'Lưu'}</button>
    </div>
  </form>`;
}

const WEEKDAY = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function taskState(t) {
  const deadline = new Date(t.deadline_at);
  const created = new Date(t.created_at || t.updated_at || Date.now() - 86400000);
  const left = deadline - Date.now();
  const overdue = !t.is_completed && left <= 0;
  const total = Math.max(1, deadline - created);
  const pct = t.is_completed ? 1 : Math.min(1, Math.max(0, 1 - left / total));
  const urgency = t.is_completed ? 'done' : overdue ? 'overdue' : left < 3600e3 * 6 ? 'hot' : left < 86400e3 * 2 ? 'warm' : 'calm';
  return { deadline, left, overdue, pct, urgency };
}

/** Render text with clickable links (long URLs wrap instead of overflowing). */
function Linkified({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => (i % 2
    ? html`<a class="link task-link" href=${part} target="_blank" rel="noopener noreferrer">${part}</a>`
    : part));
}

function TaskCard({ t, index, onOpen, onEdit, onComplete, onDelete }) {
  const { deadline, left, overdue, pct, urgency } = taskState(t);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return html`<div class=${'task slide-up u-' + urgency} style=${`--d:${index * 50}ms`} role="button" tabindex="0"
      onClick=${onOpen} onKeyDown=${(e) => { if (e.key === 'Enter') onOpen(); }}>
    <div class="task-main">
      <div class="task-title clamp-2">${t.title}</div>
      ${t.description && html`<div class="muted small clamp-2 task-desc">${t.description}</div>`}
      <div class="task-meta">
        <span><${Icon} name="calendar" size=${14} /> Hạn: ${fmtDeadline(deadline)}</span>
        ${t.is_completed ? html`<span class="chip chip-success">Đã hoàn thành</span>`
          : overdue ? html`<span class="chip chip-red">Quá hạn</span>`
          : html`<span class="countdown-chip">${remaining(left)}</span>`}
      </div>
      ${!t.is_completed && html`<div class="task-bar"><span style=${`width:${pct * 100}%`}></span></div>`}
    </div>
    <div class="task-actions">
      ${!t.is_completed && html`<button class="btn btn-sm btn-success" onClick=${stop(onComplete)}><${Icon} name="check" size=${16} stroke=${3} /> Hoàn thành</button>`}
      ${!t.is_completed && html`<button class="icon-btn" aria-label="Chỉnh sửa / gia hạn" title="Chỉnh sửa / gia hạn" onClick=${stop(onEdit)}><${Icon} name="edit" size=${18} /></button>`}
      <button class="icon-btn" aria-label="Xóa" title="Xóa" onClick=${stop(onDelete)}><${Icon} name="trash" size=${18} /></button>
    </div>
  </div>`;
}

function TaskDetail({ t, close }) {
  useTick(1000);
  const { deadline, left, overdue, pct, urgency } = taskState(t);
  const completedAt = t.completed_at ? new Date(t.completed_at) : null;
  const createdAt = t.created_at ? new Date(t.created_at) : null;
  const lateDone = completedAt && completedAt > deadline;
  return html`<div class=${'task-detail u-' + urgency}>
    <div class="td-hero">
      <div class="td-status">
        ${t.is_completed ? html`<span class="chip chip-success"><${Icon} name="check" size=${13} stroke=${3} /> Đã hoàn thành</span>`
          : overdue ? html`<span class="chip chip-red">Quá hạn</span>` : html`<span class="chip chip-blue">Đang làm</span>`}
      </div>
      <h2 class="td-title">${t.title}</h2>
      ${!t.is_completed && html`<div class="td-count">${overdue ? `Đã trễ ${remaining(-left).replace('Còn ', '')}` : remaining(left).startsWith('Còn') ? remaining(left) : `Còn ${remaining(left)}`}</div>`}
      ${!t.is_completed && html`<div class="task-bar td-bar"><span style=${`width:${pct * 100}%`}></span></div>`}
    </div>
    <div class="td-grid">
      <div class="td-cell"><${Icon} name="calendar" size=${18} /><div><span>Ngày hạn</span><b>${WEEKDAY[deadline.getDay()]}, ${fmtDeadline(deadline).split(' ')[0]}</b></div></div>
      <div class="td-cell"><${Icon} name="clock" size=${18} /><div><span>Giờ hạn</span><b>${fmtDeadline(deadline).split(' ')[1]}</b></div></div>
      ${completedAt && html`<div class="td-cell"><${Icon} name="checkCircle" size=${18} /><div><span>Hoàn thành lúc</span><b>${fmtDeadline(completedAt)}${lateDone ? ' (trễ hạn)' : ''}</b></div></div>`}
      ${createdAt && html`<div class="td-cell"><${Icon} name="plus" size=${18} /><div><span>Tạo lúc</span><b>${fmtDeadline(createdAt)}</b></div></div>`}
    </div>
    <div class="td-section">
      <div class="field-label">Nội dung</div>
      <div class="td-desc">${t.description ? html`<${Linkified} text=${t.description} />` : html`<span class="muted">Không có mô tả.</span>`}</div>
    </div>
    <div class="dialog-actions td-actions">
      <button class="btn btn-ghost" onClick=${() => close('delete')}><${Icon} name="trash" size=${16} /> Xóa</button>
      ${!t.is_completed && html`<button class="btn btn-ghost" onClick=${() => close('edit')}><${Icon} name="edit" size=${16} /> Sửa / gia hạn</button>`}
      ${!t.is_completed && html`<button class="btn btn-success" onClick=${() => close('complete')}><${Icon} name="check" size=${16} stroke=${3} /> Hoàn thành</button>`}
    </div>
  </div>`;
}

export function DeadlinesPage() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('open');
  useTick(1000);

  async function load() {
    setError(null);
    const { data, error: err } = await supabase.from('deadline_tasks').select().eq('user_id', currentUser().id).order('deadline_at');
    if (err) return setError('Không tải được Deadline: ' + errMsg(err));
    setTasks(data || []);
  }
  useEffect(() => { load(); }, []);

  async function edit(task) {
    const ok = await openSheet(({ close }) => html`<${TaskForm} task=${task} close=${close} />`, { title: task ? 'Chỉnh sửa Deadline' : 'Tạo Deadline' });
    if (ok) load();
  }
  async function complete(t) {
    const now = new Date();
    const late = now > new Date(t.deadline_at);
    const { error: err } = await supabase.from('deadline_tasks').update({
      is_completed: true, completed_at: now.toISOString(), updated_at: now.toISOString(),
    }).eq('id', t.id).eq('user_id', currentUser().id);
    if (err) return toast('Không cập nhật được: ' + errMsg(err), 'error');
    await load();
    toast('Đã hoàn thành nhiệm vụ!', 'success');
    showMeme(late ? 'deadlineFailure' : 'deadlineSuccess');
  }
  async function showDetail(t) {
    const action = await openSheet(({ close }) => html`<${TaskDetail} t=${t} close=${close} />`, { title: 'Chi tiết Deadline' });
    if (action === 'edit') edit(t);
    if (action === 'complete') complete(t);
    if (action === 'delete') remove(t);
  }
  async function remove(t) {
    if (!(await confirmDialog({ title: 'Xóa nhiệm vụ?', message: `"${t.title}" sẽ bị xóa.`, confirmText: 'Xóa', danger: true }))) return;
    const { error: err } = await supabase.from('deadline_tasks').delete().eq('id', t.id);
    if (err) return toast('Xóa thất bại: ' + errMsg(err), 'error');
    load();
  }

  const open = (tasks || []).filter((t) => !t.is_completed);
  const done = (tasks || []).filter((t) => t.is_completed).sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
  const shown = tab === 'open' ? open : done;
  return html`<div class="page narrow">
    <${PageHeader} title="Deadline" subtitle=${tasks ? `${open.length} nhiệm vụ đang chờ` : ' '}
      actions=${html`<button class="btn btn-primary btn-sm" onClick=${() => edit(null)}><${Icon} name="plus" size=${18} /> Tạo</button>`} />
    <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'open', label: `Đang làm (${open.length})` }, { value: 'done', label: `Đã xong (${done.length})` }]} />
    <div class="gap-top"></div>
    ${error ? html`<${ErrorBox} message=${error} onRetry=${load} />`
      : !tasks ? html`<${Skeleton} h=${110} count=${3} />`
      : !shown.length ? html`<${Empty} icon="flag" title=${tab === 'open' ? 'Chưa có Deadline nào' : 'Chưa hoàn thành nhiệm vụ nào'} text=${tab === 'open' ? 'Tạo nhiệm vụ để theo dõi thời hạn.' : ''}>
          ${tab === 'open' && html`<button class="btn btn-primary" onClick=${() => edit(null)}><${Icon} name="plus" size=${18} /> Tạo nhiệm vụ</button>`}<//>`
      : html`<div class="stack-sm">${shown.map((t, i) => html`<${TaskCard} key=${t.id} t=${t} index=${i}
          onOpen=${() => showDetail(t)} onEdit=${() => edit(t)} onComplete=${() => complete(t)} onDelete=${() => remove(t)} />`)}</div>`}
  </div>`;
}
