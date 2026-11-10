import { html, useState, useEffect } from 'preact';
import { supabase, currentUser, fromSessionRow, fmtRange, errMsg, vnNow, DAY_NAMES, DAY_SHORT, isCheckInExcluded } from '../lib.js';
import { Icon, Spinner, Skeleton, ErrorBox, Empty, openSheet, confirmDialog, toast, Field } from '../ui.js';
import { PageHeader } from './shared.js';
import { showAbsenceSheet } from './absence.js';

// ------------------------------------------------------------------
// DUT periods and the student-portal timetable parser (ported from the app)
// ------------------------------------------------------------------
const PERIOD_START = { 1: '07:00:00', 2: '08:00:00', 3: '09:00:00', 4: '10:00:00', 5: '11:00:00', 6: '12:30:00', 7: '13:30:00', 8: '14:30:00', 9: '15:30:00', 10: '16:30:00', 11: '17:30:00', 12: '18:15:00', 13: '19:10:00', 14: '19:55:00' };
const PERIOD_END = { 1: '07:50:00', 2: '08:50:00', 3: '09:50:00', 4: '10:50:00', 5: '11:50:00', 6: '13:20:00', 7: '14:20:00', 8: '15:20:00', 9: '16:20:00', 10: '17:20:00', 11: '18:15:00', 12: '19:00:00', 13: '19:50:00', 14: '20:40:00' };
const periodFromStart = (t) => +Object.keys(PERIOD_START).find((k) => PERIOD_START[k].slice(0, 5) === String(t).slice(0, 5)) || null;
const periodFromEnd = (t) => +Object.keys(PERIOD_END).find((k) => PERIOD_END[k].slice(0, 5) === String(t).slice(0, 5)) || null;

const SUBJECT_CODE = /^\d{7}\.\d+\.\d+\.\d+$/;
const SCHEDULE_HINT = /(?:Thứ\s*[2-7]|Thứ\s*(?:Hai|Ba|Tư|Năm|Sáu|Bảy)|(?:CN|Chủ\s*Nhật))\s*,?\s*\d{1,2}\s*-\s*\d{1,2}\s*,/i;
const clean = (v) => String(v).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();

function parseDay(token) {
  const n = token.trim().toLowerCase().replace(/\s+/g, ' ');
  if (n === 'cn' || n === 'chủ nhật') return 7;
  const map = [['thứ 2', 'thứ hai', 1], ['thứ 3', 'thứ ba', 2], ['thứ 4', 'thứ tư', 3], ['thứ 5', 'thứ năm', 4], ['thứ 6', 'thứ sáu', 5], ['thứ 7', 'thứ bảy', 6]];
  for (const [a, b, d] of map) if (n.includes(a) || n === b) return d;
  return null;
}

function splitLine(line) {
  const t = line.trim();
  if (t.includes('|')) {
    const cells = t.split('|').map((e) => e.trim());
    while (cells.length && !cells[0]) cells.shift();
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells;
  }
  if (t.includes('\t')) return t.split('\t').map((e) => e.trim());
  return [t];
}

function parseScheduleCell(cell) {
  return cell.split(/\s*;\s*/).map(clean).filter(Boolean).map((seg) => {
    const m = seg.match(/^(Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|CN|Chủ\s*Nhật)\s*,\s*(\d{1,2})\s*-\s*(\d{1,2})\s*,\s*(.+)$/i);
    if (!m) throw new Error(`Không đọc được lịch học: "${seg}"`);
    const day = parseDay(m[1]), sp = +m[2], ep = +m[3], room = clean(m[4]);
    if (!day) throw new Error(`Không đọc được thứ/tiết: "${seg}"`);
    if (sp < 1 || ep > 14 || sp > ep) throw new Error(`Khoảng tiết không hợp lệ: "${seg}"`);
    if (!room) throw new Error(`Thiếu phòng học: "${seg}"`);
    return { day, sp, ep, room };
  });
}

export function parsePastedSchedule(text) {
  const courses = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || /^[:\-\s]+$/.test(line.replace(/\|/g, '').trim() || '-')) continue;
    const cells = splitLine(line);
    const codeIdx = cells.findIndex((c) => SUBJECT_CODE.test(clean(c)));
    if (codeIdx < 0) continue;
    let schedIdx = -1;
    for (let i = codeIdx + 1; i < cells.length; i++) if (SCHEDULE_HINT.test(clean(cells[i]))) { schedIdx = i; break; }
    if (schedIdx < 0) throw new Error(`Không tìm thấy cột lịch học cho mã ${cells[codeIdx]}.`);
    const subjectCode = clean(cells[codeIdx]);
    const before = cells.slice(codeIdx + 1, schedIdx).map(clean).filter((v) => v && !/^\d+(?:[.,]\d+)?$/.test(v));
    if (!before.length) throw new Error(`Không tìm thấy tên môn cho mã ${subjectCode}.`);
    let subjectName = before[0];
    if (/^[A-Z]\d{2}-.+/i.test(subjectName) && before.length >= 2) subjectName = before[before.length - 1];
    const teacherCandidate = before[before.length - 1];
    const teacher = teacherCandidate === subjectName ? '' : teacherCandidate;
    courses.push({ subjectCode, subjectName, teacher, meetings: parseScheduleCell(clean(cells[schedIdx])) });
  }
  if (!courses.length) throw new Error('Không tìm thấy dòng lịch học hợp lệ. Hãy copy nguyên bảng lịch học từ trang sinh viên.');
  return courses;
}

async function importCourses(courses) {
  const uid = currentUser().id;
  let inserted = 0, skipped = 0;
  for (const course of courses) {
    let { data: subj, error } = await supabase.from('subjects').select('id').eq('user_id', uid).eq('subject_code', course.subjectCode).limit(1);
    if (error) throw error;
    let subjectId = subj?.[0]?.id;
    if (!subjectId) {
      const { data, error: e2 } = await supabase.from('subjects').insert({
        user_id: uid, subject_code: course.subjectCode, name: course.subjectName, teacher: course.teacher || null,
      }).select('id').single();
      if (e2) throw e2;
      subjectId = data.id;
    }
    for (const m of course.meetings) {
      const start = PERIOD_START[m.sp], end = PERIOD_END[m.ep];
      const { data: ex, error: e3 } = await supabase.from('class_sessions').select('id, is_active')
        .eq('user_id', uid).eq('subject_id', subjectId).eq('day_of_week', m.day).eq('room', m.room)
        .eq('start_time', start).eq('end_time', end).limit(1);
      if (e3) throw e3;
      if (ex?.length) {
        if (ex[0].is_active === false) {
          await supabase.from('class_sessions').update({ is_active: true }).eq('id', ex[0].id).eq('user_id', uid);
          inserted++;
        } else skipped++;
        continue;
      }
      const { error: e4 } = await supabase.from('class_sessions').insert({
        user_id: uid, subject_id: subjectId, room: m.room, start_time: start, end_time: end,
        teacher: course.teacher || null, day_of_week: m.day,
      });
      if (e4) throw e4;
      inserted++;
    }
  }
  return { courses: courses.length, inserted, skipped };
}

async function findOrCreateSubject({ name, code, teacher, existingId }) {
  const uid = currentUser().id;
  const patch = { subject_code: code || null, teacher: teacher || null };
  if (existingId) {
    const { error } = await supabase.from('subjects').update({ name, ...patch }).eq('id', existingId).eq('user_id', uid);
    if (error) throw error;
    return existingId;
  }
  const { data: ex } = await supabase.from('subjects').select('id').eq('user_id', uid).eq('name', name).limit(1);
  if (ex?.length) {
    await supabase.from('subjects').update(patch).eq('id', ex[0].id).eq('user_id', uid);
    return ex[0].id;
  }
  const { data, error } = await supabase.from('subjects').insert({ user_id: uid, name, ...patch }).select('id').single();
  if (error) throw error;
  return data.id;
}

// ------------------------------------------------------------------
// Forms
// ------------------------------------------------------------------
function ScheduleForm({ editing, close }) {
  const [f, setF] = useState({
    name: editing?.subject || '', code: '', teacher: editing?.teacher || '', room: editing?.room || '',
    day: editing?.dayOfWeek || vnNow().weekday,
    sp: periodFromStart(editing?.startTime) || 1, ep: periodFromEnd(editing?.endTime) || periodFromStart(editing?.startTime) || 1,
  });
  const [subjectId, setSubjectId] = useState(editing?.subjectId || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, num = false) => (e) => setF((p) => {
    const v = num ? +e.target.value : e.target.value;
    const next = { ...p, [k]: v };
    if (k === 'sp' && next.ep < v) next.ep = v;
    return next;
  });

  useEffect(() => {
    if (!editing) return;
    supabase.from('class_sessions').select('subject_id, subjects(id, name, subject_code, teacher)').eq('id', editing.id).single()
      .then(({ data }) => {
        if (!data?.subjects) return;
        setSubjectId(data.subject_id);
        setF((p) => ({ ...p, code: data.subjects.subject_code || '', teacher: p.teacher || data.subjects.teacher || '' }));
      });
  }, []);

  async function save(e) {
    e.preventDefault();
    const name = f.name.trim(), room = f.room.trim(), teacher = f.teacher.trim();
    if (!name) return setError('Vui lòng nhập tên môn học.');
    if (!room) return setError('Vui lòng nhập phòng học.');
    if (f.sp > f.ep) return setError('Tiết bắt đầu phải nhỏ hơn hoặc bằng tiết kết thúc.');
    setBusy(true); setError(null);
    try {
      const uid = currentUser().id;
      const sid = await findOrCreateSubject({ name, code: f.code.trim(), teacher, existingId: subjectId });
      const start = PERIOD_START[f.sp], end = PERIOD_END[f.ep];
      let q = supabase.from('class_sessions').select('id, is_active').eq('user_id', uid).eq('subject_id', sid)
        .eq('day_of_week', f.day).eq('room', room).eq('start_time', start).eq('end_time', end);
      if (editing) q = q.neq('id', editing.id);
      const { data: dup } = await q.limit(1);
      let reactivated = false;
      const payload = { subject_id: sid, room, start_time: start, end_time: end, teacher: teacher || null, day_of_week: f.day };
      if (dup?.length) {
        if (dup[0].is_active === false) {
          reactivated = true;
          const { error: err } = await supabase.from('class_sessions').update({ ...payload, is_active: true }).eq('id', dup[0].id).eq('user_id', uid);
          if (err) throw err;
        } else throw new Error('Lịch học này đã tồn tại.');
      }
      if (editing) {
        const changed = editing.subject.trim() !== name || editing.room.trim() !== room || editing.startTime !== start ||
          editing.endTime !== end || editing.dayOfWeek !== f.day || (editing.teacher || '').trim() !== teacher;
        if (changed) {
          // Keep the old class_session (it may have check-in history): soft-delete it and create a new one.
          await supabase.from('class_sessions').update({ is_active: false }).eq('id', editing.id).eq('user_id', uid);
          if (!reactivated) {
            const { error: err } = await supabase.from('class_sessions').insert({ user_id: uid, ...payload, is_active: true });
            if (err) throw err;
          }
        } else {
          await supabase.from('class_sessions').update({ teacher: teacher || null, is_active: true }).eq('id', editing.id).eq('user_id', uid);
        }
      } else if (!reactivated) {
        const { error: err } = await supabase.from('class_sessions').insert({ user_id: uid, ...payload, is_active: true });
        if (err) throw err;
      }
      close(true);
    } catch (err) {
      setBusy(false);
      setError(`Không thể ${editing ? 'cập nhật' : 'thêm'} lịch học: ${errMsg(err)}`);
    }
  }

  const periods = Array.from({ length: 14 }, (_, i) => i + 1);
  return html`<form class="stack" onSubmit=${save}>
    <${Field} label="Tên môn học *"><input class="input" value=${f.name} onInput=${set('name')} placeholder="VD: Giải tích 2" /><//>
    <div class="row gap">
      <${Field} label="Mã môn học"><input class="input" value=${f.code} onInput=${set('code')} /><//>
      <${Field} label="Phòng học *"><input class="input" value=${f.room} onInput=${set('room')} placeholder="VD: F305" /><//>
    </div>
    <${Field} label="Giảng viên"><input class="input" value=${f.teacher} onInput=${set('teacher')} /><//>
    <div class="field"><span class="field-label">Thứ</span>
      <div class="day-picker" role="radiogroup" aria-label="Thứ">${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<button type="button" role="radio" aria-checked=${f.day === d} class=${f.day === d ? 'active' : ''} onClick=${() => setF({ ...f, day: d })}>${DAY_SHORT[d]}</button>`)}</div>
    </div>
    <div class="row gap">
      <${Field} label="Tiết bắt đầu"><select class="input" value=${f.sp} onChange=${set('sp', true)}>${periods.map((p) => html`<option value=${p}>Tiết ${p} · ${PERIOD_START[p].slice(0, 5)}</option>`)}</select><//>
      <${Field} label="Tiết kết thúc"><select class="input" value=${f.ep} onChange=${set('ep', true)}>${periods.map((p) => html`<option value=${p}>Tiết ${p} · ${PERIOD_END[p].slice(0, 5)}</option>`)}</select><//>
    </div>
    ${error && html`<div class="form-error shake">${error}</div>`}
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" onClick=${() => close(false)}>Hủy</button>
      <button class="btn btn-primary" disabled=${busy}>${busy ? html`<${Spinner} size=${18} />` : editing ? 'Lưu thay đổi' : 'Thêm lịch'}</button>
    </div>
  </form>`;
}

function ImportForm({ close }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function analyze() {
    setError(null);
    try { setPreview(parsePastedSchedule(text)); } catch (e) { setPreview(null); setError(e.message); }
  }
  async function doImport() {
    setBusy(true); setError(null);
    try {
      const r = await importCourses(preview);
      toast(`Đã nhập ${r.courses} môn, ${r.inserted} buổi học.${r.skipped ? ` ${r.skipped} buổi đã có sẵn nên được bỏ qua.` : ''}`, 'success', 5000);
      close(true);
    } catch (e) { setBusy(false); setError('Nhập lịch thất bại: ' + errMsg(e)); }
  }

  return html`<div class="stack">
    <div class="note"><${Icon} name="info" size=${16} /> Vào cổng sinh viên DUT → Lịch học, bôi đen nguyên bảng (cả dòng tiêu đề), copy rồi dán vào đây.</div>
    <textarea class="input textarea" rows="7" placeholder="Dán bảng lịch học tại đây…" value=${text}
      onInput=${(e) => { setText(e.target.value); setPreview(null); }}></textarea>
    ${error && html`<div class="form-error">${error}</div>`}
    ${preview && html`<div class="import-preview fade-in">
      <div class="strong">${preview.length} môn · ${preview.reduce((s, c) => s + c.meetings.length, 0)} buổi/tuần</div>
      ${preview.map((c) => html`<div class="import-item">
        <b>${c.subjectName}</b> <span class="muted small">${c.subjectCode}${c.teacher ? ' · ' + c.teacher : ''}</span>
        <div class="small">${c.meetings.map((m) => `${DAY_SHORT[m.day]} tiết ${m.sp}-${m.ep} · ${m.room}`).join('  •  ')}</div>
      </div>`)}
    </div>`}
    <div class="dialog-actions">
      <button class="btn btn-ghost" onClick=${() => close(false)}>Hủy</button>
      ${preview ? html`<button class="btn btn-primary" disabled=${busy} onClick=${doImport}>${busy ? html`<${Spinner} size=${18} />` : 'Nhập vào lịch'}</button>`
        : html`<button class="btn btn-primary" disabled=${!text.trim()} onClick=${analyze}>Phân tích</button>`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export function SchedulePage() {
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState(null);
  const [day, setDay] = useState(vnNow().weekday);

  async function load() {
    setError(null);
    const { data, error: err } = await supabase.from('class_sessions')
      .select('id, subject_id, room, start_time, end_time, teacher, day_of_week, is_active, subjects (name, subject_code, teacher)')
      .eq('user_id', currentUser().id).eq('is_active', true).order('day_of_week').order('start_time');
    if (err) return setError(errMsg(err));
    setClasses((data || []).map(fromSessionRow));
  }
  useEffect(() => { load(); }, []);

  async function addMenu() {
    const choice = await openSheet(({ close }) => html`<div class="stack-sm">
      <button class="menu-item" onClick=${() => close('manual')}><span class="list-icon blue"><${Icon} name="edit" /></span>
        <span class="grow"><b>Thêm lịch thủ công</b><br /><span class="muted small">Tự nhập môn, thứ, tiết, phòng, giảng viên</span></span></button>
      <button class="menu-item" onClick=${() => close('import')}><span class="list-icon violet"><${Icon} name="paste" /></span>
        <span class="grow"><b>Nhập từ bảng lịch DUT</b><br /><span class="muted small">Dán nguyên bảng lịch học từ cổng sinh viên</span></span></button>
    </div>`, { title: 'Thêm lịch học' });
    if (choice === 'manual') openForm();
    if (choice === 'import') {
      if (await openSheet(ImportForm, { title: 'Nhập từ bảng lịch DUT', wide: true })) load();
    }
  }

  async function openForm(editing) {
    const ok = await openSheet(({ close }) => html`<${ScheduleForm} editing=${editing} close=${close} />`,
      { title: editing ? 'Chỉnh sửa lịch học' : 'Thêm lịch học thủ công' });
    if (ok) { toast(editing ? 'Đã cập nhật lịch học.' : 'Đã thêm lịch học.', 'success'); load(); }
  }

  async function actions(c) {
    const choice = await openSheet(({ close }) => html`<div class="stack-sm">
      <div class="muted small">${c.subject} · ${DAY_NAMES[c.dayOfWeek]} · ${fmtRange(c.startTime, c.endTime)} · ${c.room}</div>
      <button class="menu-item" onClick=${() => close('edit')}><span class="list-icon blue"><${Icon} name="edit" /></span>
        <span class="grow"><b>Chỉnh sửa</b><br /><span class="muted small">Thay đổi thông tin tiết học</span></span></button>
      <button class="menu-item" onClick=${() => close('absence')}><span class="list-icon amber"><${Icon} name="busy" /></span>
        <span class="grow"><b>Báo nghỉ / học bù</b><br /><span class="muted small">Thầy cô cho nghỉ một buổi hoặc dời sang buổi khác</span></span></button>
      <button class="menu-item" onClick=${() => close('delete')}><span class="list-icon red"><${Icon} name="trash" /></span>
        <span class="grow"><b>Xóa</b><br /><span class="muted small">Xóa tiết học này khỏi lịch</span></span></button>
    </div>`, { title: 'Tùy chọn' });
    if (choice === 'edit') openForm(c);
    if (choice === 'absence') showAbsenceSheet(c);
    if (choice === 'delete') {
      const ok = await confirmDialog({ title: 'Xóa lịch học?', danger: true, confirmText: 'Xóa',
        message: `Lịch "${c.subject}" vào ${DAY_NAMES[c.dayOfWeek]} (${fmtRange(c.startTime, c.endTime)}) sẽ được ẩn khỏi lịch học. Nếu đã có check-in, lịch sử check-in vẫn được giữ lại.` });
      if (!ok) return;
      const { error: err } = await supabase.from('class_sessions').update({ is_active: false }).eq('id', c.id).eq('user_id', currentUser().id);
      if (err) return toast('Không thể xóa lịch học. ' + errMsg(err), 'error');
      toast('Đã xóa lịch học. Lịch sử check-in vẫn được giữ lại.', 'success'); load();
    }
  }

  async function clearAll() {
    const ok = await confirmDialog({ title: 'Xóa toàn bộ lịch học?', danger: true, confirmText: 'Xóa tất cả',
      message: 'Tất cả lịch học hiện tại sẽ được đưa về trạng thái trống. Lịch sử check-in đã có vẫn được giữ lại và bạn có thể nhập/thêm lịch mới sau đó.' });
    if (!ok) return;
    const { error: err } = await supabase.from('class_sessions').update({ is_active: false }).eq('user_id', currentUser().id).eq('is_active', true);
    if (err) return toast('Không thể xóa toàn bộ lịch học. ' + errMsg(err), 'error');
    toast('Đã xóa toàn bộ lịch học. Lịch sử check-in vẫn được giữ lại.', 'success'); load();
  }

  const byDay = (d) => (classes || []).filter((c) => c.dayOfWeek === d);
  const today = vnNow().weekday;
  return html`<div class="page">
    <${PageHeader} title="Thời khóa biểu" subtitle=${classes ? `${classes.length} buổi mỗi tuần` : ' '} actions=${html`
      ${classes?.length ? html`<button class="icon-btn" aria-label="Xóa toàn bộ lịch học" title="Xóa toàn bộ lịch học" onClick=${clearAll}><${Icon} name="trash" /></button>` : null}
      <button class="btn btn-primary btn-sm" onClick=${addMenu}><${Icon} name="plus" size=${18} /> Thêm</button>`} />
    ${error ? html`<${ErrorBox} message=${'Không thể tải lịch học. ' + error} onRetry=${load} />`
      : !classes ? html`<${Skeleton} h=${60} /><${Skeleton} h=${80} count=${3} />`
      : !classes.length ? html`<${Empty} icon="calendar" title="Chưa có lịch học." text="Mỗi lớp học sẽ tự động tạo một nhiệm vụ check-in.">
          <button class="btn btn-primary" onClick=${addMenu}><${Icon} name="plus" size=${18} /> Thêm lịch học</button><//>`
      : html`
        <div class="day-tabs">${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<button class=${'day-tab' + (d === day ? ' active' : '') + (d === today ? ' today' : '')} onClick=${() => setDay(d)}>
          <span>${DAY_SHORT[d]}</span><small>${byDay(d).length || '·'}</small></button>`)}</div>
        <div class="week-grid">
          ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<section class=${'week-col' + (d === day ? ' show' : '')}>
            <h3 class=${d === today ? 'today' : ''}>${DAY_NAMES[d]}${d === today ? html` <span class="chip chip-blue">Hôm nay</span>` : ''}</h3>
            ${byDay(d).length ? byDay(d).map((c, i) => html`<button class="sched-card slide-up" style=${`--d:${i * 50}ms`} onClick=${() => actions(c)}>
                <span class="sched-time">${fmtRange(c.startTime, c.endTime)}</span>
                <b>${c.subject}</b>
                <span class="small muted"><${Icon} name="pin" size=${13} /> ${c.room}${c.teacher ? ' · ' + c.teacher : ''}</span>
                ${isCheckInExcluded(c) && html`<span class="chip chip-gray">Không check-in</span>`}
              </button>`) : html`<div class="muted small pad-sm">Không có lớp</div>`}
          </section>`)}
        </div>`}
  </div>`;
}
