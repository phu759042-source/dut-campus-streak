// Public "about" page (/gioi-thieu): what the app does and a FAQ, readable without logging in.
// The text lives in /data/faq.json, which api/seo-page.js also turns into the crawler HTML and FAQPage data.
import { html, useState, useEffect } from 'preact';
import { Skeleton } from '../ui.js';
import { navigate } from '../router.js';
import { appStore } from '../lib.js';

export function IntroPage() {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const before = document.title;
    document.title = 'Giới thiệu DUT Campus Streak – App check-in lớp học sinh viên Bách khoa Đà Nẵng';
    fetch('/data/faq.json').then((r) => r.json()).then(setD, () => setFailed(true));
    return () => { document.title = before; };
  }, []);
  const go = (p) => (e) => { e.preventDefault(); navigate(p); };
  const loggedIn = !!appStore.get().session;

  return html`<div class="page narrow intro">
    <header class="intro-head pop-in">
      <a href="/" onClick=${go('/')}><img src="/icon-192.png" alt="Logo DUT Campus Streak" width="72" height="72" /></a>
      <h1>Giới thiệu DUT Campus Streak</h1>
      <p class="muted">Ứng dụng check-in lớp học, giữ streak và bản đồ 3D cho sinh viên Bách khoa Đà Nẵng</p>
      <div class="intro-cta">
        ${loggedIn ? html`<a class="btn btn-primary" href="/" onClick=${go('/')}>Vào ứng dụng</a>`
          : html`<a class="btn btn-primary" href="/register" onClick=${go('/register')}>Đăng ký miễn phí</a>`}
        <a class="btn btn-ghost" href="/map" onClick=${go('/map')}>Bản đồ DUT 3D</a>
      </div>
    </header>
    ${failed ? html`<p class="muted center">Không tải được nội dung. Hãy thử tải lại trang.</p>`
      : !d ? html`<${Skeleton} h=${120} r=${20} /><${Skeleton} h=${64} count=${4} />`
      : html`
        <section class="card"><p class="intro-lead">${d.intro}</p></section>
        <section class="intro-sec">
          <h2>Tính năng chính</h2>
          <div class="intro-grid">${d.features.map(([t, x]) => html`<article class="card"><h3>${t}</h3><p class="muted">${x}</p></article>`)}</div>
        </section>
        <section class="intro-sec">
          <h2>Câu hỏi thường gặp</h2>
          ${d.faq.map(([q, a], i) => html`<details class="card intro-faq" open=${i < 2}><summary><h3>${q}</h3></summary><p>${a}</p></details>`)}
        </section>`}
    <footer class="auth-foot">
      <a class="link strong" href="/login" onClick=${go('/login')}>Đăng nhập</a> ·
      <a class="link strong" href="/register" onClick=${go('/register')}>Đăng ký</a> ·
      <a class="link strong" href="/map" onClick=${go('/map')}>Bản đồ 3D</a>
    </footer>
  </div>`;
}
