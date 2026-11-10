// Core helpers shared by every page: Supabase client, Vietnam time, small store.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://gmwurbvhhzgdikogxiqb.supabase.co';
// Publishable (anon) key only. Never put the service role key in the browser.
export const SUPABASE_KEY = 'sb_publishable_i7IHac8LyrXoG3aiLDlS7A_1Vua8h8l';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Static assets (memes, sounds, app icon) are served from the public GitHub repo via jsDelivr,
// pinned to a commit so the URLs never change under us.
export const ASSET_BASE =
  'https://cdn.jsdelivr.net/gh/phu759042-source/dut-campus-streak@abec9614caea31d1ea23587c98f918b243a8b8b4/assets';

export const APP_VERSION = '1.1.2-web';

// ------------------------------------------------------------------
// Tiny reactive store
// ------------------------------------------------------------------
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      subs.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const appStore = createStore({
  session: undefined, // undefined = still restoring
  profile: null,
  theme: readLocal('cs-theme') || 'light',
  recovery: false,
});

export function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export function currentUser() {
  return appStore.get().session?.user ?? null;
}

// ------------------------------------------------------------------
// Theme
// ------------------------------------------------------------------
export function applyTheme(mode) {
  const theme = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0b1020' : '#eef4ff';
  writeLocal('cs-theme', theme);
  appStore.set({ theme });
}

export async function loadThemeFromServer() {
  try {
    const { data, error } = await supabase.rpc('get_my_theme_mode');
    if (error) throw error;
    applyTheme(String(data || 'light').toLowerCase());
  } catch (e) {
    console.warn('theme load', e);
  }
}

export async function saveTheme(mode) {
  applyTheme(mode);
  const { error } = await supabase.rpc('set_my_theme_mode', { p_theme_mode: mode });
  if (error) console.warn('theme save', error);
}

// ------------------------------------------------------------------
// Vietnam time (Asia/Ho_Chi_Minh), independent of the device time zone
// ------------------------------------------------------------------
const VN_TZ = 'Asia/Ho_Chi_Minh';
const vnParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function vnNow(date = new Date()) {
  const p = Object.fromEntries(vnParts.formatToParts(date).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day, hh = +p.hour, mm = +p.minute, ss = +p.second;
  return {
    y, m, d, hh, mm, ss,
    weekday: WEEKDAYS[p.weekday],
    minutes: hh * 60 + mm,
    seconds: hh * 3600 + mm * 60 + ss,
    iso: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Add days to an ISO date (yyyy-mm-dd) without time zone drift. */
export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
export function isoWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}
export function fmtDateIso(iso, short = false) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return short ? `${d}/${m}` : `${d}/${m}/${y}`;
}

export function timeToMinutes(value) {
  const [h, m] = String(value || '').split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}
export function fmtTime(value) {
  const [h = '0', m = '0'] = String(value || '').split(':');
  return `${String(parseInt(h, 10) || 0).padStart(2, '0')}:${String(parseInt(m, 10) || 0).padStart(2, '0')}`;
}
export function fmtRange(start, end) {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}
export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h} giờ ${String(m).padStart(2, '0')} phút`;
  if (m > 0) return `${m} phút ${String(sec).padStart(2, '0')} giây`;
  return `${sec} giây`;
}

export const DAY_NAMES = { 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ Nhật' };
export const DAY_SHORT = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };

// ------------------------------------------------------------------
// Class helpers
// ------------------------------------------------------------------
export function fromTodayRow(r) {
  return {
    id: String(r.class_session_id ?? ''),
    subject: r.subject ?? 'Không có tên môn',
    subjectCode: r.subject_code ?? '',
    room: r.room ?? '',
    startTime: r.start_time ?? '',
    endTime: r.end_time ?? '',
    teacher: r.teacher ?? '',
    dayOfWeek: Number(r.day_of_week) || 0,
    completed: r.checked_in === true,
    occurrenceId: r.occurrence_id ?? null,
    isMakeup: r.is_makeup === true,
    originalDate: r.original_date ?? null,
    status: r.status ?? 'active',
    makeupDate: r.makeup_date ?? null,
    makeupStart: r.makeup_start ?? null,
    makeupEnd: r.makeup_end ?? null,
    makeupRoom: r.makeup_room ?? null,
  };
}

export function fromSessionRow(r) {
  const s = r.subjects && typeof r.subjects === 'object' ? r.subjects : {};
  return {
    id: String(r.id ?? ''),
    subject: s.name ?? 'Không có tên môn',
    subjectCode: s.subject_code ?? '',
    subjectId: r.subject_id ?? null,
    room: r.room ?? '',
    startTime: r.start_time ?? '',
    endTime: r.end_time ?? '',
    teacher: r.teacher ?? s.teacher ?? '',
    dayOfWeek: Number(r.day_of_week) || 0,
    isActive: r.is_active !== false,
    status: 'active',
  };
}

export const isAbsenceReported = (c) => c.status && c.status !== 'active';
export function isCheckInExcluded(c) {
  return String(c.room || '').trim().toUpperCase() === 'MSTEAM' ||
    String(c.subject || '').trim().toUpperCase().includes('GDTC');
}

/** Check-in window: 15 minutes before start until the class end, Vietnam time, today only. */
export function checkInWindow(c, now = vnNow()) {
  const start = timeToMinutes(c.startTime) * 60;
  const end = timeToMinutes(c.endTime) * 60;
  const open = start - 15 * 60;
  const t = now.seconds;
  if (t < open) return { state: 'early', secondsLeft: open - t };
  if (t >= end) return { state: 'closed', secondsLeft: 0 };
  return { state: 'open', secondsLeft: end - t };
}

export async function loadTodayClasses() {
  const { data, error } = await supabase.rpc('get_my_today_classes');
  if (error) throw error;
  return (data || [])
    .map(fromTodayRow)
    .map((c) => ({ ...c, completed: !isCheckInExcluded(c) && c.completed }))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function isTodayStreakComplete(classes) {
  const scheduled = classes.filter((c) => !isAbsenceReported(c));
  const checkable = scheduled.filter((c) => !isCheckInExcluded(c));
  if (!checkable.length) return scheduled.length > 0;
  return checkable.filter((c) => c.completed).length / checkable.length >= 0.75;
}

// ------------------------------------------------------------------
// Account bootstrap (same as ensureCurrentUserData in the app)
// ------------------------------------------------------------------
export async function ensureCurrentUserData(displayName) {
  const user = currentUser();
  if (!user) return;
  const fallbackName = (displayName || '').trim() ||
    String(user.user_metadata?.display_name || '').trim() ||
    (user.email ? user.email.split('@')[0] : 'Sinh viên');

  const { data: existing, error: e1 } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle();
  if (e1) throw e1;
  if (!existing) {
    const { error } = await supabase.from('users').insert({
      id: user.id, name: fallbackName, email: user.email, student_code: '', class_name: '',
    });
    if (error) throw error;
  } else if (user.email) {
    await supabase.from('users').update({ email: user.email }).eq('id', user.id);
  }

  const { data: prof, error: e2 } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (e2) throw e2;
  if (!prof) {
    const { error } = await supabase.from('profiles').insert({ id: user.id, display_name: fallbackName });
    if (error) throw error;
  }
}

export async function loadMyProfile() {
  const user = currentUser();
  if (!user) return null;
  const [{ data: u }, { data: p }] = await Promise.all([
    supabase.from('users').select('student_code, name, email, class_name').eq('id', user.id).maybeSingle(),
    supabase.from('profiles').select('display_name, avatar_url, banner_url').eq('id', user.id).maybeSingle(),
  ]);
  const profile = {
    ...(u || {}), ...(p || {}),
    email: u?.email || user.email || '',
    display_name: p?.display_name || u?.name || 'Sinh viên',
  };
  appStore.set({ profile });
  return profile;
}

export async function loadMyLeaderboardRow() {
  const user = currentUser();
  const { data, error } = await supabase.rpc('get_leaderboard');
  if (error) throw error;
  return (data || []).find((r) => String(r.user_id) === user?.id) || null;
}

// ------------------------------------------------------------------
// Errors & Edge Functions
// ------------------------------------------------------------------
const ERROR_VI = {
  'Invalid login credentials': 'Email hoặc mật khẩu không đúng.',
  'Email not confirmed': 'Email chưa được xác nhận. Hãy kiểm tra hộp thư.',
  'User already registered': 'Email này đã được đăng ký.',
  'Check-in is not allowed at this time': 'Chưa đến giờ check-in hoặc lớp đã kết thúc.',
  'Room verification failed': 'Không xác minh được phòng học. Hãy chụp rõ biển số phòng.',
  'No active class occurrence found for today': 'Hôm nay không có buổi học này.',
  'Image does not belong to this class session': 'Ảnh không thuộc lớp này.',
  'Class session not found or not owned by user': 'Không tìm thấy lớp học.',
  'Unauthorized': 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
};

export function errMsg(e) {
  if (!e) return 'Có lỗi xảy ra.';
  const raw = typeof e === 'string' ? e : (e.message || e.error_description || e.error || String(e));
  for (const [k, v] of Object.entries(ERROR_VI)) if (raw.includes(k)) return v;
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) return 'Mất kết nối mạng. Vui lòng thử lại.';
  return raw.replace(/^Exception:\s*/, '');
}

/** Call an Edge Function and always return the JSON body (also for 4xx/5xx). */
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : undefined);
  if (!error) return { ok: true, data };
  let payload = null;
  try { payload = await error.context?.json?.(); } catch { /* not JSON */ }
  return { ok: false, data: payload, error };
}

// ------------------------------------------------------------------
// Images
// ------------------------------------------------------------------
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Remote images (e.g. the current banner) must be CORS-enabled so they can be drawn and exported.
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh.'));
    img.src = src;
  });
}

export function canvasToBlob(canvas, quality = 0.88) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh.'))), 'image/jpeg', quality));
}

/** Scale an image source down so its longest side is <= maxSide and encode as JPEG. */
export async function resizeToJpeg(source, maxSide = 1600, quality = 0.88) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, quality);
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
