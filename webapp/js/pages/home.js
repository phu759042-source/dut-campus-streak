import { html, useState, useEffect } from 'preact';
import {
  appStore, loadTodayClasses, loadMyLeaderboardRow, loadMyProfile, vnNow, fmtRange, fmtDateIso, timeToMinutes,
  isAbsenceReported, isCheckInExcluded, isTodayStreakComplete, checkInWindow, fmtDuration, errMsg, DAY_NAMES, supabase,
} from '../lib.js';
import { Icon, Avatar, Flame, Skeleton, ErrorBox, Empty, openSheet, useTick } from '../ui.js';
import { navigate } from '../router.js';
import { showAbsenceSheet, AbsenceBadge } from './absence.js';
import { GamesSection } from '../games.js';
import { InstallButton } from '../install.js';
import { pushStatus, enablePush, pushPromptDismissed, dismissPushPrompt } from '../push.js';
import { toast } from '../ui.js';

export function useStore() {
  const [s, set] = useState(appStore.get());
  useEffect(() => {
    const unsub = appStore.subscribe(set);
    set(appStore.get()); // catch updates that happened before subscribing
    return unsub;
  }, []);
  return s;
}

/** How many accounts are registered (shown above the avatar). Kept for 10 minutes in this tab. */
function useUserCount() {
  const [n, setN] = useState(() => {
    try { const c = JSON.parse(sessionStorage.getItem('cs-users') || 'null'); return c && Date.now() - c.at < 600000 ? c.n : null; } catch { return null; }
  });
  useEffect(() => {
    if (n != null) return undefined;
    let alive = true;
    // hit_page_view with p_count = false only reads the totals (no visit is counted); it includes the account count
    supabase.rpc('hit_page_view', { p_page: 'map', p_count: false }).then(({ data }) => {
      if (!alive || !(data?.users > 0)) return;
      setN(data.users);
      try { sessionStorage.setItem('cs-users', JSON.stringify({ n: data.users, at: Date.now() })); } catch { /* storage off */ }
    }, () => {});
    return () => { alive = false; };
  }, []);
  return n;
}

function greeting(h) {
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function CountUp({ value, ms = 900 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, start;
    const from = 0, to = Number(value) || 0;
    const step = (t) => {
      start ??= t;
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // rAF is paused in background tabs: make sure the final value is always shown.
    const done = setTimeout(() => { cancelAnimationFrame(raf); setV(to); }, ms + 100);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [value]);
  return html`<span>${v}</span>`;
}

export async function openClass(c, reload) {
  if (isAbsenceReported(c)) {
    const changed = await showAbsenceSheet(c);
    if (changed) reload?.();
  } else if (isCheckInExcluded(c)) {
    await openSheet(({ close }) => html`<div>
      <p class="dialog-message"><b>${c.subject}</b> chỉ hiển thị để bạn theo dõi lịch học.<br /><br />Môn này không tính vào check-in và streak.</p>
      <div class="dialog-actions"><button class="btn btn-primary" onClick=${() => close()}>Đã hiểu</button></div>
    </div>`, { title: 'Không cần check-in', center: true });
  } else {
    navigate(`/class/${c.id}`, { state: { cls: c } });
  }
}

export function ClassRow({ c, onClick, index = 0 }) {
  const excluded = isCheckInExcluded(c);
  const reported = isAbsenceReported(c);
  const win = !reported && !excluded && !c.completed ? checkInWindow(c) : null;
  return html`<button class=${'class-row slide-up' + (c.completed ? ' done' : '') + (reported ? ' muted-row' : '')}
    style=${`--d:${index * 60}ms`} onClick=${onClick}>
    <span class=${'class-time' + (win?.state === 'open' ? ' live' : '')}>
      <b>${fmtRange(c.startTime, c.endTime).split(' – ')[0]}</b>
      <small>${fmtRange(c.startTime, c.endTime).split(' – ')[1]}</small>
    </span>
    <span class="class-info">
      <span class="class-subject">${c.subject}</span>
      <span class="class-meta"><${Icon} name="pin" size=${14} /> ${c.room || '—'}${c.teacher ? html` · ${c.teacher}` : ''}</span>
    </span>
    <span class="class-status">
      ${reported || c.isMakeup ? html`<${AbsenceBadge} c=${c} />`
        : excluded ? html`<span class="chip chip-gray">Không check-in</span>`
        : c.completed ? html`<span class="check-badge"><${Icon} name="check" size=${16} stroke=${3} /></span>`
        : win?.state === 'open' ? html`<span class="chip chip-live">Check-in</span>`
        : null}
      <${Icon} name="chevron" size=${18} class="muted" />
    </span>
  </button>`;
}

function NextClassHero({ classes }) {
  useTick(1000);
  const now = vnNow();
  const active = classes.filter((c) => !isAbsenceReported(c));
  const upcoming = active.filter((c) => timeToMinutes(c.endTime) * 60 > now.seconds);
  const next = upcoming[0];
  const dateLabel = `${DAY_NAMES[now.weekday]}, ${fmtDateIso(now.iso)}`;

  let body;
  if (!active.length) {
    body = html`<div class="hero-title">Hôm nay được nghỉ 🎉</div><div class="hero-sub">Không có lịch học. Nạp năng lượng nhé!</div>`;
  } else if (!next) {
    body = html`<div class="hero-title">Xong lịch hôm nay ✨</div><div class="hero-sub">Bạn đã đi hết các buổi học hôm nay.</div>`;
  } else {
    const start = timeToMinutes(next.startTime) * 60;
    const running = now.seconds >= start;
    const win = checkInWindow(next, now);
    const canCheckIn = !isCheckInExcluded(next) && !next.completed && win.state === 'open';
    body = html`
      <div class="hero-kicker">${running ? 'Đang diễn ra' : 'Buổi học tiếp theo'}</div>
      <div class="hero-title">${next.subject}</div>
      <div class="hero-sub"><${Icon} name="clock" size=${15} /> ${fmtRange(next.startTime, next.endTime)} <span class="dot"></span> <${Icon} name="pin" size=${15} /> ${next.room}</div>
      <div class="hero-foot">
        ${running ? html`<span class="countdown">Còn ${fmtDuration(timeToMinutes(next.endTime) * 60 - now.seconds)}</span>`
          : html`<span class="countdown">Bắt đầu sau ${fmtDuration(start - now.seconds)}</span>`}
        ${next.completed ? html`<span class="chip chip-success"><${Icon} name="check" size=${14} stroke=${3} /> Đã check-in</span>`
          : canCheckIn ? html`<button class="btn btn-light btn-sm pulse" onClick=${() => navigate(`/checkin/${next.id}`, { state: { cls: next } })}>
              <${Icon} name="camera" size=${16} /> Check-in ngay</button>` : null}
      </div>`;
  }
  return html`<section class="hero pop-in">
    <div class="hero-orbs"><span></span><span></span></div>
    <div class="hero-date"><${Icon} name="calendar" size=${15} /> ${dateLabel}</div>
    ${body}
  </section>`;
}

function StreakCard({ streak, classes, loading }) {
  const lit = isTodayStreakComplete(classes);
  const checkable = classes.filter((c) => !isAbsenceReported(c) && !isCheckInExcluded(c));
  const done = checkable.filter((c) => c.completed).length;
  const need = Math.ceil(checkable.length * 0.75);
  const pct = checkable.length ? Math.min(1, done / Math.max(1, need)) : lit ? 1 : 0;
  const R = 26, C = 2 * Math.PI * R;
  return html`<section class=${'streak-card pop-in' + (lit ? ' lit' : '')} onClick=${() => navigate('/leaderboard')}>
    <${Flame} size=${68} lit=${lit} />
    <div class="grow">
      <div class="streak-label">Streak hiện tại</div>
      <div class="streak-value">${loading ? '…' : html`<${CountUp} value=${streak} />`}<small> ngày</small></div>
      <div class="streak-hint">${lit ? 'Hôm nay đã giữ lửa 🔥' : checkable.length ? `Cần check-in ${need}/${checkable.length} buổi để giữ lửa` : streak === 0 ? 'Bắt đầu ngay hôm nay' : 'Tiếp tục nhé!'}</div>
    </div>
    ${checkable.length > 0 && html`<svg class="ring" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r=${R} class="ring-bg" />
      <circle cx="32" cy="32" r=${R} class="ring-fg" stroke-dasharray=${C} stroke-dashoffset=${C * (1 - pct)} />
      <text x="32" y="37" text-anchor="middle">${done}/${need}</text>
    </svg>`}
  </section>`;
}

const QUICK = [
  { icon: 'chart', title: 'Xếp hạng', href: '/leaderboard', tone: 'blue' },
  { icon: 'trophy', title: 'Thành tích', href: '/achievements', tone: 'amber' },
  { icon: 'camera', title: 'Check-in hôm nay', href: '/checkins-today', tone: 'green' },
  { icon: 'calendar', title: 'Thời khóa biểu', href: '/schedule', tone: 'violet' },
  { icon: 'folder', title: 'Tài liệu', href: '/documents', tone: 'cyan' },
  { icon: 'flag', title: 'Deadline', href: '/deadlines', tone: 'rose' },
];


function PushPrompt() {
  const [status, setStatus] = useState(pushStatus());
  const [hidden, setHidden] = useState(pushPromptDismissed());
  const [busy, setBusy] = useState(false);
  if (hidden || status === 'granted' || status === 'denied' || status === 'unsupported') return null;
  async function enable() {
    setBusy(true);
    try { await enablePush(); toast('Đã bật thông báo nhắc deadline 🔔', 'success'); setStatus('granted'); }
    catch (e) { toast(e.message, 'error', 6000); setStatus(pushStatus()); }
    setBusy(false);
  }
  return html`<section class="push-card pop-in">
    <span class="push-bell"><${Icon} name="bell" size=${24} /></span>
    <div class="grow">
      <b>Bật thông báo nhắc deadline?</b>
      <div class="small">${status === 'ios-install'
        ? 'Trên iPhone: bấm nút Chia sẻ → "Thêm vào MH chính", mở Campus Streak từ màn hình chính rồi bật ở đây.'
        : 'Nhắc lúc 7h, 13h, 19h và trước hạn 24 giờ, 6 giờ, 1 giờ, 15 phút — kể cả khi đã đóng trang.'}</div>
      <div class="row gap push-actions">
        ${status !== 'ios-install' && html`<button class="btn btn-light btn-sm" disabled=${busy} onClick=${enable}>${busy ? 'Đang bật…' : 'Bật thông báo'}</button>`}
        <button class="btn btn-sm push-later" onClick=${() => { dismissPushPrompt(); setHidden(true); }}>Để sau</button>
      </div>
    </div>
  </section>`;
}

export function HomePage() {
  const store = useStore();
  const profile = store.profile;
  const [classes, setClasses] = useState(null);
  const [error, setError] = useState(null);
  const [streak, setStreak] = useState(0);
  const [streakLoading, setStreakLoading] = useState(true);
  const [loadedIso, setLoadedIso] = useState(null);
  const users = useUserCount();

  async function load() {
    setError(null);
    try {
      const list = await loadTodayClasses();
      setClasses(list);
      setLoadedIso(vnNow().iso);
    } catch (e) { setError(errMsg(e)); setClasses([]); }
    try {
      const row = await loadMyLeaderboardRow();
      setStreak(row?.current_streak ?? 0);
    } catch (e) { console.warn(e); }
    setStreakLoading(false);
  }

  useEffect(() => {
    load();
    if (!profile) loadMyProfile().catch(() => {});
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);

  // A new day started while the page stayed open: refresh.
  useTick(30000);
  useEffect(() => { if (loadedIso && loadedIso !== vnNow().iso) load(); });

  const name = profile?.display_name || '';
  const list = classes || [];
  return html`<div class="page home">
    ${users > 0 && html`<div class="home-users slide-down" title="Số tài khoản đã đăng ký DUT Campus Streak">
      <${Icon} name="users" size=${14} /><span><b>${users.toLocaleString('vi-VN')}</b> tài khoản đã đăng ký</span></div>`}
    <header class="home-head slide-down">
      <button class="home-user" onClick=${() => navigate('/profile')}>
        <${Avatar} url=${profile?.avatar_url} name=${name} size=${48} ring />
        <span>
          <span class="muted small">${greeting(vnNow().hh)},</span>
          <span class="home-name">${name || 'Sinh viên'}</span>
        </span>
      </button>
      <span class="home-meta"><${InstallButton} />${profile?.class_name ? html`<span class="chip class-chip">${profile.class_name}</span>` : null}</span>
    </header>

    <div class="home-grid">
      <div class="col">
        ${classes === null ? html`<${Skeleton} h=${170} r=${26} />` : error ? null : html`<${NextClassHero} classes=${list} />`}
        <${StreakCard} streak=${streak} classes=${list} loading=${streakLoading} />
      </div>
      <div class="col">
        <div class="section-head"><h2>Lịch học hôm nay</h2>
          <button class="icon-btn" aria-label="Làm mới" onClick=${load}><${Icon} name="refresh" size=${18} /></button></div>
        ${error ? html`<${ErrorBox} message=${'Không thể tải lịch học. ' + error} onRetry=${load} />`
          : classes === null ? html`<${Skeleton} h=${74} count=${3} />`
          : !list.length ? html`<${Empty} icon="calendar" title="Hôm nay không có lịch học." text="Thêm lịch trong Thời khóa biểu để bắt đầu check-in.">
              <button class="btn btn-ghost btn-sm" onClick=${() => navigate('/schedule')}>Mở thời khóa biểu</button><//>`
          : html`<div class="stack-sm">${list.map((c, i) => html`<${ClassRow} key=${c.id + (c.occurrenceId || '')} c=${c} index=${i} onClick=${() => openClass(c, load)} />`)}</div>`}
      </div>
    </div>

    <${PushPrompt} />
    <button class="map-promo slide-up" onClick=${() => navigate('/map')}>
      <span class="map-promo-art" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="grow"><b>Bản đồ trường 3D</b><span class="small">Xoay, phóng to, tìm phòng học như F305 ngay trên mô hình DUT.</span></span>
      <${Icon} name="chevron" size=${20} />
    </button>
    <div class="section-head"><h2>Truy cập nhanh</h2></div>
    <div class="quick-grid">
      ${QUICK.map((q, i) => html`<button key=${q.href} class=${'quick tone-' + q.tone + ' slide-up'} style=${`--d:${i * 50}ms`} onClick=${() => navigate(q.href)}>
        <span class="quick-icon"><${Icon} name=${q.icon} size=${24} /></span>
        <span>${q.title}</span>
      </button>`)}
    </div>

    <div class="section-head"><h2>Trò chơi hôm nay</h2><span class="muted small">Xả stress giữa giờ 🎮</span></div>
    <${GamesSection} />
  </div>`;
}
