// Shared UI building blocks: icons, dialogs, toasts, flame, confetti, meme feedback.
import { html, render, useState, useEffect, useRef } from 'preact';
import { createStore, ASSET_BASE, hideStorageUrl } from './lib.js';
import { MEMES } from './memes.js';

export { html };

// ------------------------------------------------------------------
// Icons (stroke icons, 24x24)
// ------------------------------------------------------------------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  medal: 'M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 13v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  check: 'M5 12.5 10 17l9-10',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5 8 12l7 7',
  chevron: 'M9 5l7 7-7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  busy: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 12.5l5 5M14.5 12.5l-5 5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  key: 'M15 7a4 4 0 1 1-3.4 6.1L4 20.7V17h3v-3h3l1.6-1.6A4 4 0 0 1 15 7zM16 9h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v4M12 17v4M3 12h4M17 12h4',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  paste: 'M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3',
  switch: 'M7 7h13l-3-3M17 17H4l3 3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  zoom: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
};

export function Icon({ name, size = 22, stroke = 2, class: cls = '', style }) {
  return html`<svg class=${'icon ' + cls} style=${style} width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d=${P[name] || P.info} /></svg>`;
}

export function Spinner({ size = 22, class: cls = '' }) {
  return html`<span class=${'spinner ' + cls} style=${`width:${size}px;height:${size}px`} role="status" aria-label="Đang tải"></span>`;
}

export function Skeleton({ h = 72, r = 18, count = 1 }) {
  return html`${Array.from({ length: count }, (_, i) => html`<div key=${i} class="skeleton" style=${`height:${h}px;border-radius:${r}px`}></div>`)}`;
}

export function Empty({ icon = 'sparkles', title, text, children }) {
  return html`<div class="empty pop-in">
    <div class="empty-icon"><${Icon} name=${icon} size=${30} /></div>
    <div class="empty-title">${title}</div>
    ${text && html`<div class="muted">${text}</div>`}
    ${children}
  </div>`;
}

export function ErrorBox({ message, onRetry }) {
  return html`<div class="error-box pop-in">
    <${Icon} name="info" />
    <div class="grow">${message}</div>
    ${onRetry && html`<button class="btn btn-sm btn-ghost" onClick=${onRetry}>Thử lại</button>`}
  </div>`;
}

export function Avatar({ url, name = '', size = 44, ring = false }) {
  const [broken, setBroken] = useState(false);
  const initials = String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  return html`<span class=${'avatar' + (ring ? ' avatar-ring' : '')} style=${style}>
    ${url && !broken ? html`<img src=${hideStorageUrl(url)} alt="" loading="lazy" onError=${() => setBroken(true)} />` : html`<span>${initials || '?'}</span>`}
  </span>`;
}

// Animated streak flame. `lit` = today's goal reached.
let flameSeq = 0;
export function Flame({ size = 64, lit = true }) {
  // Unique gradient ids: a gradient inside a hidden SVG (e.g. the mobile-hidden sidebar) would not render.
  const [id] = useState(() => `fl${++flameSeq}`);
  return html`<span class=${'flame' + (lit ? ' lit' : ' unlit')} style=${`width:${size}px;height:${size}px`}>
    <svg viewBox="0 0 64 64" width=${size} height=${size} aria-hidden="true">
      <defs>
        <radialGradient id=${id + "a"} cx="50%" cy="75%" r="65%">
          <stop offset="0%" stop-color="#fff3b0" /><stop offset="45%" stop-color="#ffb627" /><stop offset="100%" stop-color="#ff5e1a" />
        </radialGradient>
        <radialGradient id=${id + "b"} cx="50%" cy="80%" r="60%">
          <stop offset="0%" stop-color="#ffffff" /><stop offset="100%" stop-color="#ffd66b" />
        </radialGradient>
      </defs>
      <path class="flame-outer" d="M32 4c3 10 15 16 15 31a15 15 0 0 1-30 0c0-7 3-11 6-15 1 5 3 8 6 9-2-9 0-17 3-25z" fill=${`url(#${id}a)`} />
      <path class="flame-inner" d="M32 30c2 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 2 4 3 5-1-4 0-8 1-12z" fill=${`url(#${id}b)`} />
    </svg>
  </span>`;
}

export function Segmented({ value, options, onChange }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return html`<div class="segmented" style=${`--n:${options.length};--i:${idx}`}>
    <span class="seg-thumb"></span>
    ${options.map((o) => html`<button type="button" class=${o.value === value ? 'active' : ''}
      onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return html`<div class="input-wrap">
    <${Icon} name="lock" size=${18} class="input-icon" />
    <input ...${props} type=${show ? 'text' : 'password'} class="input has-icon has-action" />
    <button type="button" class="input-action" onClick=${() => setShow(!show)} aria-label=${show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
      <${Icon} name=${show ? 'eyeOff' : 'eye'} size=${18} />
    </button>
  </div>`;
}

export function IconInput({ icon, ...props }) {
  return html`<div class="input-wrap">
    <${Icon} name=${icon} size=${18} class="input-icon" />
    <input ...${props} class="input has-icon" />
  </div>`;
}

export function Field({ label, children, hint }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Re-render every `ms` so countdowns stay live. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useInterval(() => set((x) => x + 1), ms);
}

// ------------------------------------------------------------------
// Toasts
// ------------------------------------------------------------------
const toastStore = createStore({ items: [] });
let toastId = 0;
export function toast(message, kind = 'info', ms = 3200) {
  const id = ++toastId;
  toastStore.set((s) => ({ items: [...s.items, { id, message, kind }] }));
  setTimeout(() => toastStore.set((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms);
}

function ToastHost() {
  const [s, set] = useState(toastStore.get());
  useEffect(() => toastStore.subscribe(set), []);
  return html`<div class="toasts" aria-live="polite">
    ${s.items.map((t) => html`<div key=${t.id} class=${'toast toast-' + t.kind}>
      <${Icon} name=${t.kind === 'error' ? 'info' : t.kind === 'success' ? 'checkCircle' : 'sparkles'} size=${18} />
      <span>${t.message}</span></div>`)}
  </div>`;
}

// ------------------------------------------------------------------
// Dialogs / bottom sheets (promise based)
// ------------------------------------------------------------------
const dialogStore = createStore({ stack: [] });
let dialogId = 0;

/**
 * Open a sheet. `content` is a component receiving { close }.
 * Returns a promise resolved with the value passed to close().
 */
export function openSheet(content, { title, wide = false, dismissible = true, center = false, full = false } = {}) {
  return new Promise((resolve) => {
    const id = ++dialogId;
    const close = (value) => {
      dialogStore.set((s) => ({ stack: s.stack.map((d) => (d.id === id ? { ...d, closing: true } : d)) }));
      setTimeout(() => dialogStore.set((s) => ({ stack: s.stack.filter((d) => d.id !== id) })), 220);
      resolve(value);
    };
    dialogStore.set((s) => ({ stack: [...s.stack, { id, content, title, wide, dismissible, center, full, close }] }));
  });
}

export function confirmDialog({ title, message, confirmText = 'Xác nhận', cancelText = 'Hủy', danger = false }) {
  return openSheet(({ close }) => html`<div>
    <p class="dialog-message">${message}</p>
    <div class="dialog-actions">
      <button class="btn btn-ghost" onClick=${() => close(false)}>${cancelText}</button>
      <button class=${'btn ' + (danger ? 'btn-danger' : 'btn-primary')} onClick=${() => close(true)}>${confirmText}</button>
    </div>
  </div>`, { title, center: true });
}

export function promptDialog({ title, label = '', initial = '', placeholder = 'Nhập tên', confirmText = 'Lưu' }) {
  function Prompt({ close }) {
    const [v, setV] = useState(initial);
    const ref = useRef();
    useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 60); }, []);
    return html`<form onSubmit=${(e) => { e.preventDefault(); close(v.trim()); }}>
      ${label && html`<div class="field-label">${label}</div>`}
      <input ref=${ref} class="input" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)} />
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" onClick=${() => close(null)}>Hủy</button>
        <button type="submit" class="btn btn-primary">${confirmText}</button>
      </div>
    </form>`;
  }
  return openSheet(Prompt, { title, center: true });
}

function DialogHost() {
  const [s, set] = useState(dialogStore.get());
  useEffect(() => dialogStore.subscribe(set), []);
  useEffect(() => {
    document.body.classList.toggle('no-scroll', s.stack.length > 0);
    const onKey = (e) => {
      const top = s.stack[s.stack.length - 1];
      if (e.key === 'Escape' && top?.dismissible) top.close(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.stack]);
  return html`${s.stack.map((d) => {
    const C = d.content;
    return html`<div key=${d.id} class=${'overlay' + (d.closing ? ' closing' : '') + (d.center ? ' center' : '') + (d.full ? ' full' : '')}
      onClick=${(e) => { if (e.target === e.currentTarget && d.dismissible) d.close(undefined); }}>
      <div class=${'sheet' + (d.wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${d.title || ''}>
        <div class="sheet-handle"></div>
        ${d.title && html`<div class="sheet-head"><h3>${d.title}</h3>
          ${d.dismissible && html`<button class="icon-btn" aria-label="Đóng" onClick=${() => d.close(undefined)}><${Icon} name="x" size=${20} /></button>`}
        </div>`}
        <div class="sheet-body"><${C} close=${d.close} /></div>
      </div>
    </div>`;
  })}`;
}

// ------------------------------------------------------------------
// Confetti
// ------------------------------------------------------------------
export function confetti(count = 140) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = (canvas.width = innerWidth * dpr), H = (canvas.height = innerHeight * dpr);
  const colors = ['#ff6b35', '#ffb627', '#2f80ff', '#7c4dff', '#16c784', '#ff4d8d'];
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
    vx: (Math.random() - 0.5) * 22 * dpr, vy: (-Math.random() * 20 - 8) * dpr,
    s: (Math.random() * 7 + 5) * dpr, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.6 * dpr; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - start < 3200) requestAnimationFrame(frame); else canvas.remove();
  })(start);
}

// ------------------------------------------------------------------
// Meme + sound feedback (same four events as the app)
// ------------------------------------------------------------------
const MEME_CFG = {
  checkinSuccess: { folder: 'checkin_success', sound: 'checkin_success.mp3', title: 'CHECK-IN THÀNH CÔNG!', good: true },
  checkinFailure: { folder: 'checkin_failure', sound: 'checkin_failure.mp3', title: 'CHECK-IN THẤT BẠI!', good: false },
  deadlineSuccess: { folder: 'deadline_success', sound: 'deadline_success.mp3', title: 'HOÀN THÀNH DEADLINE!', good: true },
  deadlineFailure: { folder: 'deadline_failure', sound: 'deadline_failure.mp3', title: 'DEADLINE QUÁ HẠN!', good: false },
};

export function showMeme(type, autoCloseMs = 3500) {
  const cfg = MEME_CFG[type];
  if (!cfg) return Promise.resolve();
  const list = MEMES[cfg.folder] || [];
  const file = list[(Math.random() * list.length) | 0];
  const src = file ? `${ASSET_BASE}/memes/${file.split('/').map(encodeURIComponent).join('/')}` : null;
  try {
    const audio = new Audio(`${ASSET_BASE}/sounds/${cfg.sound}`);
    audio.play().catch(() => {});
  } catch { /* audio blocked */ }
  if (cfg.good) confetti();
  return openSheet(({ close }) => {
    useEffect(() => { const t = setTimeout(() => close(), autoCloseMs); return () => clearTimeout(t); }, []);
    return html`<div class="meme" onClick=${() => close()}>
      <div class=${'meme-title ' + (cfg.good ? 'good' : 'bad')}>${cfg.title}</div>
      ${src && html`<img src=${src} alt="" class="meme-img" />`}
      <div class="muted small">Chạm để đóng</div>
    </div>`;
  }, { center: true });
}

// ------------------------------------------------------------------
// Mount global hosts once
// ------------------------------------------------------------------
export function mountHosts() {
  const el = document.createElement('div');
  el.id = 'hosts';
  document.body.appendChild(el);
  render(html`<${DialogHost} /><${ToastHost} />`, el);
}
