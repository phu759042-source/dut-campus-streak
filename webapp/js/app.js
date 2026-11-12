import { html, render, useState, useEffect } from 'preact';
import { supabase, appStore, applyTheme, loadThemeFromServer, ensureCurrentUserData, loadMyProfile, readLocal } from './lib.js';
import { Icon, Spinner, mountHosts } from './ui.js';
import { usePath, match, navigate } from './router.js';
import { watchForUpdates } from './update.js';
import { LoginPage, RegisterPage, ForgotPage, ResetPasswordPage } from './pages/auth.js';
import { HomePage, useStore } from './pages/home.js';
import { MissionPage, CheckInPage, TodayCheckInsPage } from './pages/checkin.js';
import { LeaderboardPage } from './pages/leaderboard.js';
import { SchedulePage } from './pages/schedule.js';
import { DeadlinesPage } from './pages/deadlines.js';
import { DocumentsPage } from './pages/documents.js';
import { ProfilePage } from './pages/profile.js';
import { AchievementsPage, AboutPage } from './pages/misc.js';
import { SharedLinkPage } from './pages/sharelink.js';
import { syncPush } from './push.js';
import { InstallButton } from './install.js';
import { UploadIndicator } from './uploads.js';

const PUBLIC = ['/login', '/register', '/forgot', '/reset', '/map'];

// The 3D map pulls in Three.js, so it is loaded only when opened.
function LazyMap() {
  const [Page, setPage] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { import('./pages/map.js').then((m) => setPage(() => m.MapPage)).catch(() => setFailed(true)); }, []);
  if (failed) return html`<div class="splash"><b>Không tải được bản đồ.</b><button class="btn btn-primary" onClick=${() => location.reload()}>Thử lại</button></div>`;
  return Page ? html`<${Page} />` : html`<${Splash} />`;
}

const ROUTES = [
  ['/', HomePage],
  ['/class/:id', MissionPage],
  ['/checkin/:id', CheckInPage, { bare: true }],
  ['/checkins-today', TodayCheckInsPage],
  ['/leaderboard', LeaderboardPage],
  ['/achievements', AchievementsPage],
  ['/schedule', SchedulePage],
  ['/deadlines', DeadlinesPage],
  ['/documents', DocumentsPage],
  ['/profile', ProfilePage],
  ['/about', AboutPage],
];

const NAV = [
  { href: '/', icon: 'home', label: 'Trang chủ' },
  { href: '/schedule', icon: 'calendar', label: 'Lịch học' },
  { href: '/leaderboard', icon: 'chart', label: 'Xếp hạng' },
  { href: '/deadlines', icon: 'flag', label: 'Deadline' },
  { href: '/profile', icon: 'user', label: 'Hồ sơ' },
];
const SIDE_EXTRA = [
  { href: '/documents', icon: 'folder', label: 'Tài liệu' },
  { href: '/map', icon: 'pin', label: 'Bản đồ trường 3D' },
  { href: '/achievements', icon: 'trophy', label: 'Thành tích' },
  { href: '/checkins-today', icon: 'camera', label: 'Check-in hôm nay' },
];

function Shell({ path, children }) {
  const active = (href) => (href === '/' ? path === '/' || path.startsWith('/class') : path.startsWith(href));
  const navIndex = NAV.findIndex((n) => active(n.href)); // -1 on pages not in the bottom bar
  const go = (href) => (e) => { e.preventDefault(); navigate(href); };
  return html`<div class="shell">
    <aside class="sidebar">
      <a class="side-brand" href="/" onClick=${go('/')}><img class="brand-logo" src="/icon-96.png" alt="" width="36" height="36" /><span>Campus<b>Streak</b></span></a>
      <nav>
        ${[...NAV, ...SIDE_EXTRA].map((n) => html`<a href=${n.href} class=${'side-link' + (active(n.href) ? ' active' : '')} onClick=${go(n.href)}>
          <${Icon} name=${n.icon} size=${20} /><span>${n.label}</span></a>`)}
      </nav>
      <${InstallButton} variant="side" />
      <div class="side-foot muted small">DUT Campus Streak · Web</div>
    </aside>
    <main class="main" key=${path}>${children}</main>
    <${UploadIndicator} path=${path} />
    <nav class=${'bottom-nav' + (navIndex < 0 ? ' no-active' : '')} style=${`--i:${Math.max(0, navIndex)}`}>
      <span class="bn-pill"></span>
      ${NAV.map((n) => html`<a href=${n.href} class=${'bn-item' + (active(n.href) ? ' active' : '')} onClick=${go(n.href)} aria-label=${n.label}>
        <${Icon} name=${n.icon} size=${22} /><span>${n.label}</span></a>`)}
    </nav>
  </div>`;
}

function Splash() {
  return html`<div class="splash"><img class="splash-logo" src="/icon-192.png" alt="" width="84" height="84" /><${Spinner} size=${22} /></div>`;
}

function App() {
  const store = useStore();
  const path = usePath();
  const session = store.session;

  useEffect(() => {
    if (session === undefined) return;
    if (store.recovery && path !== '/reset') { navigate('/reset', { replace: true }); return; }
    if (!session && !PUBLIC.includes(path) && !path.startsWith('/s/')) navigate('/login', { replace: true });
    if (session && ['/login', '/register', '/forgot'].includes(path)) navigate('/', { replace: true });
  }, [session, path, store.recovery]);

  // Public share links work without logging in.
  const shareParams = match('/s/:token', path);
  if (shareParams) return html`<${SharedLinkPage} token=${shareParams.token} key=${path} />`;
  if (path === '/map') return html`<${LazyMap} />`;
  if (session === undefined) return html`<${Splash} />`;
  if (path === '/login') return html`<${LoginPage} />`;
  if (path === '/register') return html`<${RegisterPage} />`;
  if (path === '/forgot') return html`<${ForgotPage} />`;
  if (path === '/reset') return html`<${ResetPasswordPage} />`;
  if (!session) return html`<${Splash} />`;

  for (const [pattern, Page, opts] of ROUTES) {
    const params = match(pattern, path);
    if (!params) continue;
    if (opts?.bare) return html`<${Page} ...${params} key=${path} />`;
    return html`<${Shell} path=${path}><${Page} ...${params} /><//>`;
  }
  return html`<${Shell} path=${path}><div class="page"><div class="empty"><div class="empty-title">Không tìm thấy trang</div>
    <button class="btn btn-primary" onClick=${() => navigate('/')}>Về trang chủ</button></div></div><//>`;
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
applyTheme(readLocal('cs-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
mountHosts();

let bootstrappedFor = null;
async function onSession(session) {
  appStore.set({ session });
  if (session && bootstrappedFor !== session.user.id) {
    bootstrappedFor = session.user.id;
    try { await ensureCurrentUserData(); } catch (e) { console.warn('ensure user', e); }
    loadThemeFromServer();
    loadMyProfile().catch(() => {});
    syncPush();
  }
  if (!session) bootstrappedFor = null;
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') appStore.set({ recovery: true });
  // Defer Supabase calls out of the auth callback (avoids a supabase-js deadlock).
  setTimeout(() => onSession(session), 0);
});
supabase.auth.getSession().then(({ data }) => onSession(data.session));

render(html`<${App} />`, document.getElementById('app'));
watchForUpdates();

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
