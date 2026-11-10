// DEV ONLY (not deployed): fake session + fake RPC data to preview the UI without logging in.
// In the browser console:  await import('/dev/mock.js')
const m = await import('/js/lib.js');
const r = await import('/js/router.js');
const me = '00000000-0000-0000-0000-000000000000';
const now = m.vnNow();
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
const t = now.minutes;
const today = [
  { occurrence_id: 'o1', class_session_id: 'c1', subject: 'Giải tích 2', room: 'F305', start_time: hm(t - 120), end_time: hm(t - 60), teacher: 'Nguyễn Văn A', day_of_week: now.weekday, checked_in: true, status: 'active' },
  { occurrence_id: 'o2', class_session_id: 'c2', subject: 'Cấu trúc dữ liệu và giải thuật', room: 'C201', start_time: hm(t - 10), end_time: hm(t + 80), teacher: 'Trần Thị B', day_of_week: now.weekday, checked_in: false, status: 'active' },
  { occurrence_id: 'o3', class_session_id: 'c3', subject: 'Giáo dục thể chất GDTC 3', room: 'SVĐ', start_time: hm(t + 100), end_time: hm(t + 190), teacher: '', day_of_week: now.weekday, checked_in: false, status: 'active' },
  { occurrence_id: 'o4', class_session_id: 'c4', subject: 'Vật lý 1', room: 'F107', start_time: hm(t + 200), end_time: hm(t + 290), teacher: 'Lê C', day_of_week: now.weekday, checked_in: false, status: 'rescheduled', makeup_date: '2026-11-14' },
];
const names = ['Trần Quân', 'Lê Minh Anh', 'Phạm Hoàng', 'Nguyễn Văn Demo', 'Võ Thu Hà', 'Đặng Khoa', 'Bùi Lan'];
const lb = names.map((n, i) => ({ user_id: i === 3 ? me : 'u' + i, display_name: n, avatar_url: null, student_code: '1022300' + i, class_name: i % 2 ? '23T_DT1' : '23T_DT2', current_streak: 20 - i * 3, weekly_streak: 5 - (i % 3), total_check_ins: 60 - i * 7, rank: i + 1 }));
const sessions = [1, 1, 2, 3, 4, 5].map((d, i) => ({ id: 's' + i, subject_id: 'sub' + i, room: ['F305', 'C201', 'F107', 'H102', 'MSTEAM', 'E201'][i], start_time: ['07:00:00', '09:00:00', '12:30:00', '07:00:00', '13:30:00', '15:30:00'][i], end_time: ['08:50:00', '10:50:00', '14:20:00', '09:50:00', '15:20:00', '17:20:00'][i], teacher: 'GV ' + i, day_of_week: d, is_active: true, subjects: { name: ['Giải tích 2', 'CTDL & GT', 'Vật lý 1', 'Triết học', 'Tiếng Anh', 'Lập trình Web'][i], subject_code: '1020063.2310.23.1' + i } }));
const tasks = [
  { id: 'd1', title: 'Nộp bài tập Giải tích', description: 'Chương 3, bài 1-10', deadline_at: new Date(Date.now() + 3 * 3600e3).toISOString(), created_at: new Date(Date.now() - 86400e3).toISOString(), is_completed: false },
  { id: 'd2', title: 'Báo cáo đồ án Web', description: null, deadline_at: new Date(Date.now() + 5 * 86400e3).toISOString(), created_at: new Date(Date.now() - 86400e3).toISOString(), is_completed: false },
  { id: 'd4', title: 'Tự nhập điểm thành viên sau khi hoàn thành bài môn triết trên link', description: 'Link: https://dueudn-my.sharepoint.com/:x:/g/personal/lamtuelam_due_udn_vn/IQDl_E9nTMvdTY7ZZHXk1OOJAaed8ZBnYCY0RSCT6sjy6jM?e=LGfn5C sau deadline link sẽ bị xóa', deadline_at: new Date(Date.now() - 2 * 86400e3).toISOString(), created_at: new Date(Date.now() - 5 * 86400e3).toISOString(), completed_at: new Date(Date.now() - 3 * 86400e3).toISOString(), is_completed: true },
  { id: 'd3', title: 'Quiz Vật lý', deadline_at: new Date(Date.now() - 3600e3).toISOString(), created_at: new Date(Date.now() - 3 * 86400e3).toISOString(), is_completed: false },
];
const docs = [
  { id: 'f1', name: 'Đề cương', item_type: 'folder' },
  { id: 'f2', name: 'Slide bài giảng.pdf', item_type: 'file', file_size: 2400000, storage_path: 'x/1.pdf', mime_type: 'application/pdf' },
  { id: 'f3', name: 'Bao_cao.docx', item_type: 'file', file_size: 84000, storage_path: 'x/2.docx' },
];

m.supabase.rpc = (fn) => Promise.resolve({
  data: fn === 'get_my_today_classes' ? today : fn === 'get_leaderboard' ? lb : fn === 'get_public_profile_banners' ? []
    : fn === 'get_my_achievement_stats' ? [{ total_check_ins: 12, longest_streak: 5 }]
    : fn === 'get_class_absence_info' ? { quota_left: 1, absences: [{ date: '2026-11-13', kind: 'rescheduled', makeup_date: '2026-11-14', makeup_start: '07:00:00', makeup_end: '09:00:00', makeup_room: 'F305' }] } : null,
  error: null,
});
const table = { class_sessions: sessions, deadline_tasks: tasks, documents: docs };
m.supabase.from = (name) => {
  const result = { data: table[name] || null, error: null };
  const q = new Proxy({}, {
    get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve(result).then(res, rej);
      if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve({ data: (table[name] || [])[0] || null, error: null });
      return () => q;
    },
  });
  return q;
};
m.appStore.set({ session: { user: { id: me, email: 'demo@example.com' } }, profile: { display_name: 'Nguyễn Văn Demo', class_name: '23T_DT1', student_code: '102230000', email: 'demo@example.com' } });
export const go = async (path) => { r.navigate('/about'); await new Promise((x) => setTimeout(x, 200)); r.navigate(path); };
