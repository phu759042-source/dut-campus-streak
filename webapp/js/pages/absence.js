// Report absence / make-up class (get_class_absence_info, report_class_absence, undo_class_absence).
import { html, useState, useEffect } from 'preact';
import {
  supabase, vnNow, addDaysIso, isoWeekday, fmtDateIso, fmtTime, fmtRange, timeToMinutes, errMsg, DAY_NAMES,
} from '../lib.js';
import { Icon, Spinner, openSheet, confirmDialog, toast, Field, Segmented } from '../ui.js';

export function AbsenceBadge({ c }) {
  let label, cls;
  if (c.status === 'cancelled') { label = 'Nghỉ'; cls = 'chip-amber'; }
  else if (c.status === 'rescheduled') {
    const d = fmtDateIso(c.makeupDate, true);
    label = d ? `Nghỉ · bù ${d}` : 'Nghỉ · có bù'; cls = 'chip-amber';
  } else if (c.completed) { label = 'Học bù ✓'; cls = 'chip-success'; }
  else { label = 'Học bù'; cls = 'chip-blue'; }
  return html`<span class=${'chip ' + cls}>${label}</span>`;
}

/** Opens the absence sheet. Resolves true when something changed. */
export async function showAbsenceSheet(c) {
  let changed = false;
  await openSheet(({ close }) => html`<${AbsenceSheet} c=${c} onChanged=${() => { changed = true; }} close=${close} />`,
    { title: 'Báo nghỉ / học bù' });
  return changed;
}

function describe(a) {
  if (a.kind === 'cancelled') return 'Nghỉ, không học bù';
  const t = a.makeup_start ? `, ${fmtRange(a.makeup_start, a.makeup_end)}` : '';
  const r = a.makeup_room ? `, phòng ${a.makeup_room}` : '';
  return `Học bù ${fmtDateIso(a.makeup_date)}${t}${r}`;
}

function AbsenceSheet({ c, onChanged }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const [form, setForm] = useState(false);

  async function load() {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_class_absence_info', { p_class_session_id: c.id });
    if (err) return setError(errMsg(err));
    setInfo({ quota: Number(data?.quota_left) || 0, absences: data?.absences || [] });
  }
  useEffect(() => { load(); }, []);

  async function undo(date) {
    const ok = await confirmDialog({
      title: 'Hủy báo nghỉ?',
      message: `Buổi ngày ${fmtDateIso(date)} sẽ trở lại lịch học bình thường. Nếu có buổi học bù, buổi học bù sẽ bị xóa.`,
      confirmText: 'Hủy báo nghỉ', cancelText: 'Không',
    });
    if (!ok) return;
    setUndoing(date);
    const { error: err } = await supabase.rpc('undo_class_absence', { p_class_session_id: c.id, p_date: date });
    setUndoing(null);
    if (err) return toast(errMsg(err), 'error');
    onChanged(); toast('Đã hủy báo nghỉ.', 'success'); load();
  }

  const day = c.dayOfWeek || isoWeekday(vnNow().iso);
  const header = html`<div class="absence-head">
    <div class="strong">${c.subject}</div>
    <div class="muted small">${DAY_NAMES[day]} · ${fmtRange(c.startTime, c.endTime)} · Phòng ${c.room}</div>
  </div>`;

  if (form) {
    return html`${header}<${AbsenceForm} c=${{ ...c, dayOfWeek: day }} quota=${info?.quota ?? 0}
      onDone=${() => { onChanged(); setForm(false); load(); }} onCancel=${() => setForm(false)} />`;
  }

  return html`<div class="stack">
    ${header}
    ${error ? html`<div class="form-error">${error} <button class="btn btn-sm btn-ghost" onClick=${load}>Thử lại</button></div>`
      : !info ? html`<div class="center pad"><${Spinner} /></div>`
      : html`
        ${info.absences.length === 0 ? html`<div class="muted">Chưa có buổi nào được báo nghỉ.</div>`
          : html`<div class="stack-sm">${info.absences.map((a) => html`<div class="list-card">
              <span class="list-icon amber"><${Icon} name="busy" size=${20} /></span>
              <span class="grow"><b>Ngày ${fmtDateIso(a.date)}</b><br /><span class="muted small">${describe(a)}</span></span>
              ${undoing === a.date ? html`<${Spinner} size=${20} />`
                : html`<button class="btn btn-sm btn-ghost" disabled=${!!undoing} onClick=${() => undo(String(a.date))}>Hủy</button>`}
            </div>`)}</div>`}
        <div class="quota"><span class=${'quota-dot' + (info.quota >= 1 ? ' on' : '')}></span><span class=${'quota-dot' + (info.quota >= 2 ? ' on' : '')}></span>
          <span>Còn <b>${info.quota}/2</b> lần nghỉ không học bù cho môn này.</span></div>
        <button class="btn btn-primary btn-block btn-lg" onClick=${() => setForm(true)}><${Icon} name="plus" size=${18} /> Báo nghỉ một buổi</button>
      `}
  </div>`;
}

function AbsenceForm({ c, quota, onDone, onCancel }) {
  const now = vnNow();
  const startedToday = now.minutes >= timeToMinutes(c.startTime);
  // Selectable original dates: same weekday, from today (if not started) up to 60 days.
  const options = [];
  for (let i = 0; i <= 60; i++) {
    const iso = addDaysIso(now.iso, i);
    if (isoWeekday(iso) !== c.dayOfWeek) continue;
    if (i === 0 && startedToday) continue;
    options.push(iso);
  }
  const [original, setOriginal] = useState(options[0] || '');
  const [mode, setMode] = useState('makeup');
  const [makeupDate, setMakeupDate] = useState('');
  const [start, setStart] = useState(fmtTime(c.startTime));
  const [end, setEnd] = useState(fmtTime(c.endTime));
  const [room, setRoom] = useState(c.room || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!original) return setError('Không có buổi nào để báo nghỉ trong 60 ngày tới.');
    const params = { p_class_session_id: c.id, p_date: original };
    if (mode === 'makeup') {
      if (!makeupDate) return setError('Vui lòng chọn ngày học bù.');
      if (isoWeekday(makeupDate) === c.dayOfWeek) return setError(`Ngày học bù không được trùng ${DAY_NAMES[c.dayOfWeek]} (lịch thường của lớp).`);
      if (timeToMinutes(end) <= timeToMinutes(start)) return setError('Giờ kết thúc phải sau giờ bắt đầu.');
      if (!room.trim()) return setError('Vui lòng nhập phòng học bù.');
      Object.assign(params, { p_makeup_date: makeupDate, p_makeup_start: `${start}:00`, p_makeup_end: `${end}:00`, p_makeup_room: room.trim() });
    } else if (quota <= 0) {
      return setError('Môn này đã dùng hết 2 lần báo nghỉ không học bù.');
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('report_class_absence', params);
    setBusy(false);
    if (err) return setError(errMsg(err));
    toast(mode === 'makeup' ? `Đã dời buổi ${fmtDateIso(original)} sang ${fmtDateIso(makeupDate)}.` : `Đã báo nghỉ buổi ${fmtDateIso(original)}.`, 'success');
    onDone();
  }

  return html`<form class="stack" onSubmit=${submit}>
    <${Field} label="Buổi bị nghỉ">
      <select class="input" value=${original} onChange=${(e) => setOriginal(e.target.value)}>
        ${options.map((o) => html`<option value=${o}>${DAY_NAMES[isoWeekday(o)]}, ${fmtDateIso(o)}</option>`)}
      </select>
    <//>
    <${Segmented} value=${mode} onChange=${setMode} options=${[
      { value: 'makeup', label: 'Có học bù' }, { value: 'cancel', label: `Không học bù (${quota}/2)` }]} />
    ${mode === 'makeup' ? html`<div class="stack fade-in">
      <${Field} label="Ngày học bù" hint=${`Trong 90 ngày tới, không trùng ${DAY_NAMES[c.dayOfWeek]}.`}>
        <input class="input" type="date" min=${now.iso} max=${addDaysIso(now.iso, 90)} value=${makeupDate} onInput=${(e) => setMakeupDate(e.target.value)} />
      <//>
      <div class="row gap">
        <${Field} label="Bắt đầu"><input class="input" type="time" value=${start} onInput=${(e) => setStart(e.target.value)} /><//>
        <${Field} label="Kết thúc"><input class="input" type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} /><//>
      </div>
      <${Field} label="Phòng học bù"><input class="input" value=${room} onInput=${(e) => setRoom(e.target.value)} placeholder="VD: F305" /><//>
      <div class="note"><${Icon} name="info" size=${16} /> Buổi học bù vẫn phải check-in, không check-in thì ngày đó bị tính vắng.</div>
    </div>` : html`<div class="note fade-in"><${Icon} name="info" size=${16} /> Buổi nghỉ không tính vào streak. Mỗi môn tối đa 2 lần.</div>`}
    ${error && html`<div class="form-error shake">${error}</div>`}
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" onClick=${onCancel}>Quay lại</button>
      <button class="btn btn-primary" disabled=${busy}>${busy ? html`<${Spinner} size=${18} />` : 'Xác nhận báo nghỉ'}</button>
    </div>
  </form>`;
}
