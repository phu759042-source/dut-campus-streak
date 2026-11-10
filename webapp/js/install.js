// "Install app" (PWA) support.
// Chrome/Edge/Samsung Internet fire `beforeinstallprompt`; we keep the event so a button can open the
// browser's install dialog directly. iOS Safari has no such API, so the button shows a short guide instead.
import { html, useState, useEffect } from 'preact';
import { createStore } from './lib.js';
import { Icon, openSheet, toast } from './ui.js';

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isMobile = isIOS || isAndroid;
const isFirefox = /Firefox|FxiOS/i.test(ua);
const isSamsung = /SamsungBrowser/i.test(ua);
const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const store = createStore({ prompt: null, installed: isStandalone() });

// Must be registered as early as possible: the event can fire before the first render.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  store.set({ prompt: e });
});
window.addEventListener('appinstalled', () => {
  store.set({ prompt: null, installed: true });
  toast('Đã cài Campus Streak 🎉 Mở từ màn hình chính hoặc danh sách ứng dụng nhé!', 'success', 6000);
});
matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => store.set({ installed: e.matches }));

function useInstall() {
  const [s, set] = useState(store.get());
  useEffect(() => { const u = store.subscribe(set); set(store.get()); return u; }, []);
  return s;
}

function Step({ n, children }) {
  return html`<div class="install-step"><span class="install-n">${n}</span><div>${children}</div></div>`;
}

function Guide() {
  let title, steps;
  if (isIOS) {
    title = 'Cài trên iPhone / iPad';
    steps = [
      html`Mở trang này bằng <b>Safari</b> (hoặc Chrome trên iOS 16.4+).`,
      html`Bấm nút <b>Chia sẻ</b> <span class="kbd">⬆︎</span> ở thanh dưới (iPad: góc trên bên phải).`,
      html`Kéo xuống, chọn <b>“Thêm vào MH chính”</b> <span class="kbd">＋</span>, rồi bấm <b>Thêm</b>.`,
      html`Mở <b>Campus Streak</b> từ màn hình chính. Bật thông báo nhắc deadline ở đó.`,
    ];
  } else if (isAndroid) {
    title = 'Cài trên Android';
    steps = isSamsung ? [
      html`Bấm nút <b>menu</b> <span class="kbd">≡</span> ở thanh dưới của Samsung Internet.`,
      html`Chọn <b>“Thêm trang vào”</b> → <b>“Màn hình chờ”</b>.`,
    ] : isFirefox ? [
      html`Bấm nút <b>menu</b> <span class="kbd">⋮</span>.`,
      html`Chọn <b>“Cài đặt”</b> hoặc <b>“Thêm vào màn hình chính”</b>.`,
    ] : [
      html`Bấm nút <b>menu</b> <span class="kbd">⋮</span> ở góc trên bên phải Chrome.`,
      html`Chọn <b>“Cài đặt ứng dụng”</b> hoặc <b>“Thêm vào màn hình chính”</b> → <b>Cài đặt</b>.`,
      html`Nếu không thấy, tải lại trang một lần rồi bấm lại nút <b>Cài app</b>.`,
    ];
  } else if (isMacSafari) {
    title = 'Cài trên Mac (Safari)';
    steps = [html`Trên thanh menu chọn <b>Tệp</b> → <b>“Thêm vào Dock”</b>.`, html`Bấm <b>Thêm</b>. Campus Streak sẽ nằm trong Dock như một app.`];
  } else if (isFirefox) {
    title = 'Firefox chưa hỗ trợ cài app';
    steps = [html`Mở <b>www.campusstreak.com</b> bằng <b>Chrome</b> hoặc <b>Edge</b>.`, html`Bấm nút <b>Cài app</b> ở góc trên.`];
  } else {
    title = 'Cài trên máy tính';
    steps = [
      html`Bấm biểu tượng <b>Cài đặt</b> <span class="kbd">⊕</span> ở cuối thanh địa chỉ.`,
      html`Hoặc mở menu <span class="kbd">⋮</span> → <b>“Truyền, lưu và chia sẻ”</b> → <b>“Cài đặt trang dưới dạng ứng dụng”</b> (Edge: <b>Ứng dụng → Cài đặt trang web này</b>).`,
      html`Nếu đã cài rồi, mở Campus Streak từ menu Start / Launchpad.`,
    ];
  }
  return html`<div class="stack">
    <div class="install-hero"><img src="/icon-192.png" alt="" width="72" height="72" />
      <div><b>DUT Campus Streak</b><div class="muted small">Mở nhanh như app, toàn màn hình, nhận thông báo nhắc deadline.</div></div></div>
    <div class="strong">${title}</div>
    ${steps.map((s, i) => html`<${Step} n=${i + 1}>${s}<//>`)}
  </div>`;
}

export async function installApp() {
  const { prompt } = store.get();
  if (prompt) {
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    store.set({ prompt: null }); // a prompt event can only be used once
    if (choice?.outcome === 'accepted') return true;
    return false;
  }
  await openSheet(Guide, { title: 'Cài Campus Streak' });
  return false;
}

/** Install button; renders nothing when already running as the installed app. */
export function InstallButton({ variant = 'pill' }) {
  const s = useInstall();
  if (s.installed) return null;
  const label = isMobile ? 'Cài app' : 'Cài app';
  if (variant === 'setting') {
    return html`<button class="setting" onClick=${installApp}>
      <span class="list-icon blue"><${Icon} name="download" /></span>
      <span class="grow"><b>Cài Campus Streak như ứng dụng</b><br /><span class="muted small">${s.prompt ? 'Cài ngay, mở toàn màn hình như app' : 'Xem cách thêm vào màn hình chính'}</span></span>
      <${Icon} name="chevron" size=${18} /></button>`;
  }
  if (variant === 'side') {
    return html`<button class="side-install" onClick=${installApp}><${Icon} name="download" size=${18} /><span>Cài ứng dụng</span></button>`;
  }
  return html`<button class=${'install-pill' + (s.prompt ? ' ready' : '') + (variant === 'light' ? ' light' : '')} onClick=${installApp} aria-label="Cài ứng dụng">
    <${Icon} name="download" size=${16} stroke=${2.4} /><span>${label}</span></button>`;
}
