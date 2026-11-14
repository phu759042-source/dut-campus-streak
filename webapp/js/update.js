// "New version available" banner. The page remembers which deployment it started on (/api/version) and checks
// again every few minutes and whenever the tab comes back to the front. When a newer deployment is live it shows
// a small banner with a reload button. Reloading (or reopening the app) always gets the newest version, because
// nothing is cached by the service worker.
// It also shows a "what's new" note: the same kind of banner, once per browser, after a release worth telling
// people about (NEWS below).
import { navigate } from './router.js';

const EVERY = 5 * 60 * 1000;
let base = null, shown = false, timer = 0;

// What's new. To announce something else, replace this (a new id shows it again to everyone, once).
// `until`: people who first arrive after this day do not get the note; `place`: key of the map place it opens.
const NEWS = {
  id: '2026-11-lost-found', until: '2026-12-15', icon: '🔍',
  title: 'Sự kiện mới: Đồ thất lạc',
  text: 'Vào server bản đồ 3D nhặt đồ các bạn để quên ở nhà xe khu E, khu B và khu H, đăng confession tìm chủ, đua top công đức.',
  go: 'Vào server', path: '/map?server=1', place: 'server',
};
const NEWS_KEY = 'cs-news';

function showNews() {
  let seen;
  try { seen = localStorage.getItem(NEWS_KEY); } catch { return; } // storage off: it could not be remembered, so skip it
  if (seen === NEWS.id || Date.now() > Date.parse(NEWS.until + 'T00:00:00+07:00')) return;
  if (document.visibilityState !== 'visible') { document.addEventListener('visibilitychange', showNews, { once: true }); return; }
  if (shown) return; // the reload banner is up; the note comes after the reload
  try { localStorage.setItem(NEWS_KEY, NEWS.id); } catch { return; }
  const el = document.createElement('div');
  el.className = 'update-bar news-bar';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="update-ico" aria-hidden="true"></span><span class="update-text"><b></b><span></span></span>'
    + '<button type="button" class="update-go"></button><button type="button" class="update-x" aria-label="Đóng">✕</button>';
  el.querySelector('.update-ico').textContent = NEWS.icon || '✨';
  el.querySelector('.update-text b').textContent = NEWS.title;
  el.querySelector('.update-text span').textContent = NEWS.text;
  el.querySelector('.update-go').textContent = NEWS.go;
  const close = () => { el.classList.add('closing'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.update-x').addEventListener('click', close);
  el.querySelector('.update-go').addEventListener('click', () => {
    close();
    // the map page, when it is open, goes there itself (in walk mode you are taken to the place)
    if (location.pathname === '/map') window.dispatchEvent(new CustomEvent('cs-goto', { detail: NEWS.place }));
    else navigate(NEWS.path);
  });
  document.body.appendChild(el);
  setTimeout(close, 15000); // a note, not a question: it leaves by itself
}

async function current() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).v || null;
  } catch { return null; }
}

async function check() {
  if (shown) return;
  const v = await current();
  if (!v || v === 'unknown') return;
  if (!base) { base = v; return; }
  if (v !== base) show();
}

function show() {
  shown = true;
  document.querySelector('.news-bar')?.remove();
  const el = document.createElement('div');
  el.className = 'update-bar';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="update-ico" aria-hidden="true">✨</span><span class="update-text"><b>Có bản cập nhật mới</b><span>Tải lại trang để dùng phiên bản mới nhất.</span></span>'
    + '<button type="button" class="update-go">Tải lại</button><button type="button" class="update-x" aria-label="Để sau">✕</button>';
  el.querySelector('.update-go').addEventListener('click', () => location.reload());
  el.querySelector('.update-x').addEventListener('click', () => {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 250);
    // ask again in 30 minutes
    setTimeout(() => { shown = false; check(); }, 30 * 60 * 1000);
  });
  document.body.appendChild(el);
}

export function watchForUpdates() {
  setTimeout(showNews, 1500); // once the first screen is up
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return; // no version endpoint on the dev server
  check();
  timer = setInterval(check, EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
  return () => clearInterval(timer);
}
