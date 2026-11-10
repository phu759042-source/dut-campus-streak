// Achievements and About pages.
import { html, useState, useEffect } from 'preact';
import { supabase, loadMyLeaderboardRow, errMsg, ASSET_BASE, APP_VERSION } from '../lib.js';
import { Icon, Skeleton, ErrorBox } from '../ui.js';
import { PageHeader } from './shared.js';
import { CountUp } from './home.js';

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
  const sections = [
    ['Tác giả / Nhóm phát triển', 'Nguyễn Tấn Phú', 'Sinh viên phát triển sản phẩm DUT Campus Streak.'],
    ['Liên hệ', 'phu759042@gmail.com', 'Email liên hệ về sản phẩm, góp ý và báo lỗi.'],
    ['Bản quyền & sở hữu trí tuệ', 'DUT Campus Streak © 2026', 'Mã nguồn, giao diện, thiết kế và nội dung do tác giả tự phát triển được bảo lưu quyền sở hữu trí tuệ trong phạm vi pháp luật áp dụng. Các thư viện, SDK và thành phần của bên thứ ba tuân theo giấy phép riêng của chúng.'],
    ['Về sản phẩm', null, 'DUT Campus Streak hỗ trợ sinh viên theo dõi lịch học, check-in lớp học, xác minh phòng, duy trì streak và xem thành tích. Đồng thời còn hỗ trợ học sinh tạo nhắc hẹn deadline và lưu trữ tài liệu.'],
  ];
  return html`<div class="page narrow">
    <${PageHeader} title="Liên hệ & Giới thiệu" />
    <section class="about-hero pop-in">
      <img src=${`${ASSET_BASE}/icon/dut_campus_streak.png`} alt="" width="88" height="88" />
      <div class="about-name">DUT Campus Streak</div>
      <div class="muted small">Phiên bản web ${APP_VERSION}</div>
    </section>
    ${sections.map(([t, strong, text], i) => html`<section class="card slide-up" style=${`--d:${i * 60}ms`}>
      <h3 class="card-title">${t}</h3>
      ${strong && (t === 'Liên hệ' ? html`<a class="link strong" href=${'mailto:' + strong}>${strong}</a>` : html`<div class="strong">${strong}</div>`)}
      <div class="muted">${text}</div>
    </section>`)}
  </div>`;
}
