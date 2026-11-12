// "New version available" banner. The page remembers which deployment it started on (/api/version) and checks
// again every few minutes and whenever the tab comes back to the front. When a newer deployment is live it shows
// a small banner with a reload button. Reloading (or reopening the app) always gets the newest version, because
// nothing is cached by the service worker.
const EVERY = 5 * 60 * 1000;
let base = null, shown = false, timer = 0;

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
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return; // no version endpoint on the dev server
  check();
  timer = setInterval(check, EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
  return () => clearInterval(timer);
}
