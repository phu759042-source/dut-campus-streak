// Achievements and About pages.
import { html, useState, useEffect } from 'preact';
import { supabase, loadMyLeaderboardRow, errMsg, ASSET_BASE, APP_VERSION, CHANGELOG } from '../lib.js';
import { Icon, Skeleton, ErrorBox } from '../ui.js';
import { PageHeader } from './shared.js';
import { CountUp } from './home.js';
import { useIsAdmin } from './admin.js';

const ACHIEVEMENTS = [
  { id: 'first_check_in', title: 'Bước đầu tiên', desc: 'Hoàn thành check-in đầu tiên.', target: 1, streak: false, emoji: '👣' },
  { id: 'check_in_10', title: 'Chăm chỉ', desc: 'Đạt 10 check-in đã được xác minh.', target: 10, streak: false, emoji: '📚' },
  { id: 'check_in_25', title: 'Không bỏ cuộc', desc: 'Đạt 25 check-in đã được xác minh.', target: 25, streak: false, emoji: '💪' },
  { id: 'check_in_50', title: 'Bậc thầy check-in', desc: 'Đạt 50 check-in đã được xác minh.', target: 50, streak: false, emoji: '🎓' },
  { id: 'streak_3', title: 'Khởi động streak', desc: 'Duy trì streak 3 ngày học liên tiếp.', target: 3, streak: true, emoji: '🔥' },
  { id: 'streak_7', title: 'Một tuần bền bỉ', desc: 'Duy trì streak 7 ngày học liên tiếp.', target: 7, streak: true, emoji: '⚡' },
  { id: 'streak_14', title: 'Hai tuần kỷ luật', desc: 'Duy trì streak 14 ngày học liên tiếp.', target: 14, streak: true, emoji: '👑' },
];

export function AchievementsPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  async function load() {
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('get_my_achievement_stats');
      if (err) throw err;
      const row = data?.[0] || {};
      let longest = Number(row.longest_streak) || 0;
      // Current streak may already be longer than the stored historical value.
      try { const me = await loadMyLeaderboardRow(); longest = Math.max(longest, Number(me?.current_streak) || 0); } catch { /* optional */ }
      setStats({ total: Number(row.total_check_ins) || 0, longest });
    } catch (e) { setError(errMsg(e)); }
  }
  useEffect(() => { load(); }, []);

  if (error) return html`<div class="page narrow"><${PageHeader} title="Thành tích" /><${ErrorBox} message=${'Không thể tải thành tích. ' + error} onRetry=${load} /></div>`;
  if (!stats) return html`<div class="page narrow"><${PageHeader} title="Thành tích" /><${Skeleton} h=${130} r=${24} /><${Skeleton} h=${90} count=${4} /></div>`;

  const list = ACHIEVEMENTS.map((a) => {
    const progress = a.streak ? stats.longest : stats.total;
    return { ...a, progress, unlocked: progress >= a.target, ratio: Math.min(1, progress / a.target) };
  });
  const unlocked = list.filter((a) => a.unlocked).length;
  return html`<div class="page narrow">
    <${PageHeader} title="Thành tích" />
    <section class="ach-hero pop-in">
      <div class="ach-count"><${CountUp} value=${unlocked} /><small>/${list.length}</small></div>
      <div><b>Tiến trình thành tích</b><br /><span class="small">${stats.total} check-in · streak dài nhất ${stats.longest} ngày</span></div>
      <div class="ach-bar"><span style=${`width:${(unlocked / list.length) * 100}%`}></span></div>
    </section>
    <div class="ach-grid">
      ${list.map((a, i) => html`<div class=${'ach slide-up' + (a.unlocked ? ' unlocked' : '')} style=${`--d:${i * 60}ms`}>
        <div class="ach-badge">${a.unlocked ? a.emoji : html`<${Icon} name="lock" size=${24} />`}</div>
        <div class="grow">
          <div class="strong">${a.title}</div>
          <div class="muted small">${a.desc}</div>
          <div class="ach-progress"><span style=${`width:${a.ratio * 100}%`}></span></div>
          <div class="small ${a.unlocked ? 'ok-text' : 'muted'}">${a.unlocked ? 'Đã mở khóa' : `${a.progress} / ${a.target} ${a.streak ? 'ngày streak' : 'check-in'}`}</div>
        </div>
      </div>`)}
    </div>
  </div>`;
}

export function AboutPage() {
  const admin = useIsAdmin(); // the update history is only for the site owner (accounts in app_admins)
  const sections = [
    ['Tác giả / Nhóm phát triển', 'Nguyễn Tấn Phú', 'Sinh viên phát triển sản phẩm DUT Campus Streak.'],
    ['Liên hệ', 'phu759042@gmail.com', 'Email liên hệ về sản phẩm, góp ý và báo lỗi.'],
    ['Bản quyền & sở hữu trí tuệ', 'DUT Campus Streak © 2026', 'Mã nguồn, giao diện, thiết kế và nội dung do tác giả tự phát triển được bảo lưu quyền sở hữu trí tuệ trong phạm vi pháp luật áp dụng. Các thư viện, SDK và thành phần của bên thứ ba tuân theo giấy phép riêng của chúng.'],
  ];
  // what the product does, one line per area (kept in step with data/faq.json)
  const FEATURES = [
    ['📸', 'Check-in lớp học', 'chụp biển số phòng, AI xác minh đúng phòng của buổi học'],
    ['🔥', 'Streak & thành tích', 'giữ chuỗi ngày đi học đều, huy hiệu theo mốc'],
    ['🏆', 'Bảng xếp hạng', 'theo streak ngày, tuần và điểm công đức; chung hoặc theo lớp, tìm theo tên'],
    ['📅', 'Thời khóa biểu', 'nhập từ trang đào tạo DUT, báo nghỉ và học bù'],
    ['⏰', 'Deadline', 'nhắc bằng thông báo đẩy trước hạn'],
    ['📁', 'Tài liệu', 'lưu trữ, xem trước, chia sẻ bằng link, tải cả thư mục thành ZIP'],
    ['💬', 'Chat', 'phòng chung, nhắn tin riêng, kết bạn, chặn và báo cáo'],
    ['🗺️', 'Bản đồ 3D khuôn viên', 'tìm phòng, ngày/đêm, đi dạo nhập vai, vào bên trong Khu H, Khu B, căn tin; nhạc nền piano'],
    ['🌐', 'Server online', 'gặp nhau trên bản đồ: chat, voice chat, đá bóng ở sân vận động, sự kiện Đồ thất lạc'],
    ['🎮', 'Mini game hằng ngày', 'Lật thẻ, Toán nhanh, Bắt lửa'],
  ];
  return html`<div class="page narrow">
    <${PageHeader} title="Liên hệ & Giới thiệu" />
    <section class="about-hero pop-in">
      <img src="/icon-192.png" alt="" width="88" height="88" />
      <div class="about-name">DUT Campus Streak</div>
      <div class="muted small">Phiên bản web ${APP_VERSION} · cập nhật ${CHANGELOG[0].d}</div>
    </section>
    ${sections.map(([t, strong, text], i) => html`<section class="card slide-up" style=${`--d:${i * 60}ms`}>
      <h3 class="card-title">${t}</h3>
      ${strong && (t === 'Liên hệ' ? html`<a class="link strong" href=${'mailto:' + strong}>${strong}</a>` : html`<div class="strong">${strong}</div>`)}
      <div class="muted">${text}</div>
    </section>`)}
    <section class="card slide-up" style="--d:180ms">
      <h3 class="card-title">Về sản phẩm</h3>
      <div class="muted">Ứng dụng miễn phí cho sinh viên Trường Đại học Bách khoa – Đại học Đà Nẵng, gom việc học và đời sống sinh viên vào một chỗ:</div>
      <ul class="about-feats">${FEATURES.map(([e, t, x]) => html`<li><span class="about-feat-ic">${e}</span><span><b>${t}</b><span class="muted"> — ${x}</span></span></li>`)}</ul>
    </section>
    ${admin && html`<section class="card slide-up" style="--d:240ms">
      <h3 class="card-title">Lịch sử cập nhật <span class="chip chip-gray">Chỉ quản trị viên thấy</span></h3>
      ${CHANGELOG.map((r, i) => html`<details class="about-ver" open=${i === 0}>
        <summary><b>${r.v}</b><span class="muted small">${r.d}</span>${i === 0 && html`<span class="chip chip-blue">Hiện tại</span>`}</summary>
        <ul>${r.items.map((t) => html`<li>${t}</li>`)}</ul>
      </details>`)}
    </section>`}
  </div>`;
}
