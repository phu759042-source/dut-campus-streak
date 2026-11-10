// Mission screen (/class/:id) and live-camera check-in (/checkin/:id).
import { html, useState, useEffect, useRef } from 'preact';
import {
  supabase, currentUser, loadTodayClasses, checkInWindow, isCheckInExcluded, isAbsenceReported,
  fmtRange, fmtDuration, invokeFunction, errMsg, resizeToJpeg, loadImage, vnNow,
} from '../lib.js';
import { Icon, Spinner, Skeleton, ErrorBox, toast, showMeme, useTick } from '../ui.js';
import { navigate, routeState, back } from '../router.js';
import { showAbsenceSheet, AbsenceBadge } from './absence.js';
import { PageHeader } from './shared.js';

/** Resolve the class from navigation state, or reload today's classes. */
function useTodayClass(id) {
  const [cls, setCls] = useState(() => {
    const c = routeState().cls;
    return c && c.id === id ? c : null;
  });
  const [error, setError] = useState(null);
  async function reload() {
    try {
      const list = await loadTodayClasses();
      const matches = list.filter((c) => c.id === id);
      const found = matches.find((c) => !isAbsenceReported(c)) || matches[0];
      if (!found) setError('Lớp này không có buổi học hôm nay.');
      else { setCls(found); setError(null); }
    } catch (e) { setError(errMsg(e)); }
  }
  useEffect(() => { reload(); }, [id]);
  return { cls, error, reload };
}

export function MissionPage({ id }) {
  const { cls: c, error, reload } = useTodayClass(id);
  useTick(1000);
  if (error && !c) return html`<div class="page"><${PageHeader} title="Nhiệm vụ" /><${ErrorBox} message=${error} onRetry=${reload} /></div>`;
  if (!c) return html`<div class="page"><${PageHeader} title="Nhiệm vụ" /><${Skeleton} h=${220} r=${26} /><${Skeleton} h=${120} /></div>`;

  const excluded = isCheckInExcluded(c);
  const reported = isAbsenceReported(c);
  const win = checkInWindow(c);
  const canCheckIn = !excluded && !reported && !c.completed && win.state === 'open';

  let state;
  if (c.completed) state = html`<div class="mission-state ok"><${Icon} name="checkCircle" size=${22} /> <span>Bạn đã check-in buổi này 🎉</span></div>`;
  else if (reported) state = html`<div class="mission-state warn"><${Icon} name="busy" size=${22} /> <span>Buổi này đã được báo nghỉ.</span></div>`;
  else if (excluded) state = html`<div class="mission-state"><${Icon} name="ban" size=${22} /> <span>Môn này không tính check-in.</span></div>`;
  else if (win.state === 'early') state = html`<div class="mission-state"><${Icon} name="clock" size=${22} /> <span>Mở check-in sau <b>${fmtDuration(win.secondsLeft)}</b></span></div>`;
  else if (win.state === 'closed') state = html`<div class="mission-state warn"><${Icon} name="clock" size=${22} /> <span>Lớp đã kết thúc, hết thời gian check-in.</span></div>`;
  else state = html`<div class="mission-state live"><span class="live-dot"></span> <span>Đang mở check-in · còn <b>${fmtDuration(win.secondsLeft)}</b></span></div>`;

  return html`<div class="page narrow">
    <${PageHeader} title="Nhiệm vụ" />
    <section class="mission-card pop-in">
      <div class="mission-icon"><${Icon} name="school" size=${30} /></div>
      <h2>${c.subject}</h2>
      <div class="mission-meta">
        <span><${Icon} name="clock" size=${16} /> ${fmtRange(c.startTime, c.endTime)}</span>
        <span><${Icon} name="pin" size=${16} /> Phòng ${c.room}</span>
        ${c.teacher && html`<span><${Icon} name="user" size=${16} /> ${c.teacher}</span>`}
        ${(c.isMakeup || reported) && html`<${AbsenceBadge} c=${c} />`}
      </div>
    </section>
    ${state}
    <section class="card slide-up">
      <h3 class="card-title">Yêu cầu check-in</h3>
      <ul class="req">
        <li><${Icon} name="clock" size=${18} /> <span>Từ 15 phút trước giờ học đến khi hết giờ học</span></li>
        <li><${Icon} name="camera" size=${18} /> <span>Chụp trực tiếp biển số phòng bằng camera</span></li>
        <li><${Icon} name="sparkles" size=${18} /> <span>AI sẽ đọc mã phòng và đối chiếu với <b>${c.room}</b></span></li>
      </ul>
    </section>
    <div class="sticky-actions">
      <button class=${'btn btn-primary btn-lg btn-block' + (canCheckIn ? ' glow' : '')} disabled=${!canCheckIn}
        onClick=${() => navigate(`/checkin/${c.id}`, { state: { cls: c } })}>
        <${Icon} name="camera" size=${20} /> ${c.completed ? 'Đã check-in' : 'Check-in ngay'}
      </button>
      ${!excluded && html`<button class="btn btn-ghost btn-block" onClick=${async () => { if (await showAbsenceSheet(c)) reload(); }}>
        Thầy cô cho nghỉ? Báo nghỉ / học bù</button>`}
    </div>
  </div>`;
}

const STEPS = ['Tải ảnh lên', 'AI đọc biển số phòng', 'Ghi nhận check-in'];

export function CheckInPage({ id }) {
  const { cls: c, error: loadError } = useTodayClass(id);
  const videoRef = useRef();
  const streamRef = useRef(null);
  const fileRef = useRef();
  const [camState, setCamState] = useState('starting'); // starting | live | denied
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [step, setStep] = useState(-1); // -1 idle, 0..2 running, 3 done
  const [failure, setFailure] = useState(null);
  const [torchOn, setTorchOn] = useState(false);

  async function startCamera() {
    stopCamera();
    setCamState('starting');
    if (!navigator.mediaDevices?.getUserMedia) return setCamState('denied');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
      setCamState('live');
    } catch (e) {
      console.warn('camera', e);
      setCamState('denied');
    }
  }
  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => { startCamera(); return stopCamera; }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks?.()[0];
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(!torchOn); }
    catch { toast('Thiết bị không hỗ trợ đèn flash.', 'info'); }
  }
  const torchSupported = !!streamRef.current?.getVideoTracks?.()[0]?.getCapabilities?.()?.torch;

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const blob = await resizeToJpeg(v, 1600, 0.88);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    navigator.vibrate?.(30);
  }

  async function onFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const blob = await resizeToJpeg(img, 1600, 0.88);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (err) { toast(errMsg(err), 'error'); }
    finally { URL.revokeObjectURL(url); }
  }

  function retake() {
    setPhoto(null); setFailure(null); setStep(-1);
    if (camState !== 'live') startCamera();
  }

  async function submit() {
    const user = currentUser();
    if (!user || !c || !photo) return;
    if (checkInWindow(c).state !== 'open') { setFailure({ message: 'Đã hết thời gian check-in cho lớp này.' }); return; }
    setFailure(null);
    setStep(0);
    // 1. Upload to check-in-images/<uid>/<class_session_id>/<ms>.jpg
    const path = `${user.id}/${c.id}/${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from('check-in-images')
      .upload(path, photo.blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) { setStep(-1); setFailure({ message: 'Tải ảnh thất bại: ' + errMsg(upErr) }); return; }
    // 2+3. Server verifies the room with Gemini, then inserts the check-in.
    setStep(1);
    const slow = setTimeout(() => setStep((s) => (s === 1 ? 2 : s)), 6000);
    const res = await invokeFunction('complete-check-in', { image_path: path, class_session_id: c.id });
    clearTimeout(slow);
    const body = res.data || {};
    if (res.ok && body.success === true) {
      setStep(3);
      stopCamera();
      await new Promise((r) => setTimeout(r, 700));
      navigate('/', { replace: true });
      if (body.already_checked_in) toast('Bạn đã check-in buổi này rồi.', 'info');
      else showMeme('checkinSuccess');
      return;
    }
    setStep(-1);
    const detected = body.detected_room;
    setFailure({
      message: errMsg(body.error || body.verification_error || res.error || 'Không thể hoàn tất check-in.'),
      detected: detected ? String(detected) : null,
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
    });
    showMeme('checkinFailure');
  }

  if (loadError && !c) return html`<div class="page"><${PageHeader} title="Check-in" /><${ErrorBox} message=${loadError} /></div>`;

  const busy = step >= 0 && step < 3;
  return html`<div class="camera-page">
    <div class="camera-top">
      <button class="icon-btn glass" aria-label="Quay lại" onClick=${() => { stopCamera(); back(`/class/${id}`); }}><${Icon} name="back" /></button>
      <div class="camera-title">
        <b>${c?.subject || 'Check-in'}</b>
        <span>${c ? html`Phòng <b>${c.room}</b> · ${fmtRange(c.startTime, c.endTime)}` : '…'}</span>
      </div>
      ${torchSupported && !photo ? html`<button class=${'icon-btn glass' + (torchOn ? ' on' : '')} aria-label="Đèn flash" onClick=${toggleTorch}><${Icon} name="bolt" /></button>` : html`<span style="width:44px"></span>`}
    </div>

    <div class="camera-view">
      <video ref=${videoRef} playsinline muted autoplay class=${photo ? 'hidden' : ''}></video>
      ${photo && html`<img src=${photo.url} class="camera-photo" alt="Ảnh vừa chụp" />`}
      ${!photo && camState === 'live' && html`<div class="viewfinder"><span></span><span></span><span></span><span></span>
        <div class="viewfinder-hint">Đưa biển số phòng <b>${c?.room}</b> vào khung</div></div>`}
      ${!photo && camState === 'starting' && html`<div class="camera-msg"><${Spinner} size=${30} /><div>Đang mở camera…</div></div>`}
      ${!photo && camState === 'denied' && html`<div class="camera-msg">
        <${Icon} name="camera" size=${40} />
        <div class="strong">Không mở được camera trong trình duyệt</div>
        <div class="small">Hãy cho phép quyền camera cho trang này, hoặc dùng camera của máy để chụp.</div>
        <div class="row gap center">
          <button class="btn btn-light" onClick=${startCamera}>Thử lại</button>
          <button class="btn btn-primary" onClick=${() => fileRef.current?.click()}><${Icon} name="camera" size=${18} /> Mở camera máy</button>
        </div>
      </div>`}
      <input ref=${fileRef} type="file" accept="image/*" capture="environment" class="hidden" onChange=${onFilePicked} />

      ${busy && html`<div class="verify-overlay fade-in">
        <div class="scanline"></div>
        <div class="verify-card pop-in">
          ${STEPS.map((s, i) => html`<div class=${'vstep' + (i < step ? ' done' : i === step ? ' active' : '')}>
            <span class="vdot">${i < step ? html`<${Icon} name="check" size=${14} stroke=${3} />` : i === step ? html`<${Spinner} size=${14} />` : i + 1}</span>${s}</div>`)}
          <div class="small muted">Thường mất 5–15 giây, đừng tắt trang nhé.</div>
        </div>
      </div>`}
      ${step === 3 && html`<div class="verify-overlay success fade-in"><div class="big-check pop-in"><${Icon} name="check" size=${64} stroke=${3} /></div></div>`}
    </div>

    <div class="camera-bottom">
      ${failure && html`<div class="camera-error shake">
        <div class="strong">${failure.message}</div>
        ${failure.detected != null && html`<div class="small">AI đọc được: <b>${failure.detected || 'không rõ'}</b>${failure.confidence != null ? ` · độ tin cậy ${Math.round(failure.confidence * 100)}%` : ''}</div>`}
      </div>`}
      ${!photo ? html`<div class="shutter-row">
          <span style="width:44px"></span>
          <button class="shutter" aria-label="Chụp ảnh" disabled=${camState !== 'live'} onClick=${capture}><span></span></button>
          <button class="icon-btn glass" aria-label="Mở lại camera" onClick=${startCamera}><${Icon} name="refresh" /></button>
        </div>`
      : html`<div class="row gap">
          <button class="btn btn-light grow" disabled=${busy} onClick=${retake}><${Icon} name="refresh" size=${18} /> Chụp lại</button>
          <button class="btn btn-primary grow" disabled=${busy || !c} onClick=${submit}>
            ${busy ? html`<${Spinner} size=${18} />` : html`<${Icon} name="sparkles" size=${18} /> ${failure ? 'Thử lại' : 'Gửi xác minh'}`}</button>
        </div>`}
      <div class="camera-tip small">Mẹo: đứng gần biển phòng, giữ máy thẳng, đủ sáng.</div>
    </div>
  </div>`;
}

export function TodayCheckInsPage() {
  const [state, setState] = useState({ loading: true });
  async function load() {
    setState({ loading: true });
    try {
      const list = (await loadTodayClasses()).filter((c) => !isAbsenceReported(c));
      setState({ loading: false, all: list, done: list.filter((c) => c.completed) });
    } catch (e) { setState({ loading: false, error: errMsg(e) }); }
  }
  useEffect(() => { load(); }, []);
  const now = vnNow();
  return html`<div class="page narrow">
    <${PageHeader} title="Đã check-in hôm nay" />
    ${state.loading ? html`<${Skeleton} h=${80} count=${3} />`
      : state.error ? html`<${ErrorBox} message=${'Không thể tải dữ liệu check-in. ' + state.error} onRetry=${load} />`
      : html`
        <div class="summary-card pop-in">
          <div class="summary-num">${state.done.length}<small>/${state.all.filter((c) => !isCheckInExcluded(c)).length}</small></div>
          <div class="muted">buổi đã check-in · ${now.iso.split('-').reverse().join('/')}</div>
        </div>
        ${!state.all.length ? html`<div class="empty"><div class="empty-title">Hôm nay không có lịch học.</div></div>`
          : !state.done.length ? html`<div class="empty"><div class="empty-title">Chưa check-in buổi nào hôm nay.</div><div class="muted">Mở một lớp ở trang chủ để check-in.</div></div>`
          : html`<div class="stack-sm">${state.done.map((c, i) => html`<div class="list-card slide-up" style=${`--d:${i * 60}ms`}>
              <span class="list-icon green"><${Icon} name="checkCircle" size=${22} /></span>
              <span class="grow"><b>${c.subject}</b><br /><span class="muted small">${fmtRange(c.startTime, c.endTime)} · Phòng ${c.room}</span></span>
              <span class="chip chip-success">Đã xác minh</span>
            </div>`)}</div>`}`}
  </div>`;
}
