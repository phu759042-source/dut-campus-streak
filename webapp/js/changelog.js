// Version history of the web app, newest first. The first entry is the version shown on "Liên hệ & Giới thiệu"
// (APP_VERSION in lib.js). Every release adds an entry here:
//  - a new feature or a big change: next minor version (1.9.x -> 1.10.0)
//  - fixes and small changes: next patch version (1.9.2 -> 1.9.3)
// 1.1.2 was the version of the mobile app when the web app was released (10/11/2026); it continues from there.
export const CHANGELOG = [
  { v: '1.10.0', d: '19/11/2026', items: ['Bản đồ 3D: nút ⚙️ Cài đặt với chất lượng đồ họa (Tự động / Cao / Vừa / Thấp), giới hạn FPS (30 / 60 / không giới hạn) và bộ đếm FPS', 'Chế độ Tự động tự hạ đồ họa khi máy bị giật, hợp với laptop không có card đồ họa rời'] },
  { v: '1.9.7', d: '19/11/2026', items: ['Chat: hiện đúng tên, ảnh đại diện và lớp của người nhắn', 'Giao diện điện thoại: thanh điều hướng dưới luôn một dòng (tự chỉ hiện biểu tượng khi màn hình quá hẹp hoặc chữ hệ thống quá to), thanh chọn mục và ô nhắn tin gọn trên máy 320–430px'] },
  { v: '1.9.6', d: '18/11/2026', items: ['Check-in: tự thử lại khi máy chủ nhận diện ảnh (Gemini) quá tải, báo rõ "đang quá tải" thay vì "không xác minh được phòng"'] },
  { v: '1.9.5', d: '18/11/2026', items: ['Tìm kiếm Google: trang bản đồ đổi tiêu đề thành "Map DUT 3D", thêm mô tả các khu và câu hỏi thường gặp cho Google đọc'] },
  { v: '1.9.4', d: '18/11/2026', items: ['Lịch sử cập nhật chỉ hiện với quản trị viên'] },
  { v: '1.9.3', d: '18/11/2026', items: ['Trang Liên hệ & Giới thiệu: số phiên bản, lịch sử cập nhật và giới thiệu đầy đủ các tính năng'] },
  { v: '1.9.2', d: '18/11/2026', items: ['Khu B: mái sảnh trên hai chân trụ giống nhau, cửa sổ tròn khoét xuyên qua tường đá'] },
  { v: '1.9.1', d: '18/11/2026', items: ['Khu B: mái sảnh theo ảnh thật; logo trường đầy đủ trên Khu B và khối lập phương Khu F'] },
  { v: '1.9.0', d: '18/11/2026', items: ['Bản đồ 3D: Khu B đi vào được, 4 tầng, hành lang, phòng học B101–B407, ba cầu thang, tháp sảnh theo ảnh'] },
  { v: '1.8.0', d: '18/11/2026', items: ['Chat: phòng chung, nhắn tin riêng, kết bạn, chặn và báo cáo', 'Bảng xếp hạng: tìm theo tên hoặc lớp'] },
  { v: '1.7.1', d: '17/11/2026', items: ['Đăng nhập: báo khi tài khoản chưa được tạo, đã bị xóa hoặc chưa xác nhận email', 'Trang đăng nhập, đăng ký, mật khẩu và giới thiệu luôn ở giao diện tối'] },
  { v: '1.7.0', d: '16/11/2026', items: ['Bản đồ 3D: nhạc nền piano tự sáng tác (bật/tắt, âm lượng, chuyển bài)', 'Đá bóng: vật lý bóng thực tế (lực cản, xoáy Magnus, độ bám cỏ), chạm nhẹ để dẫn bóng, hủy cú sút giữ quá lâu', 'Trang quản trị: kéo trên biểu đồ để xem từng ngày'] },
  { v: '1.6.0', d: '15/11/2026', items: ['Sự kiện Đồ thất lạc: danh hiệu theo điểm công đức', 'Trang Giới thiệu & câu hỏi thường gặp', 'Bắt buộc nhập lớp, nhắc kiểm tra thư rác khi đăng ký email sinh viên', 'Quên mật khẩu chỉ gửi thư cho tài khoản đã đăng ký'] },
  { v: '1.5.0', d: '14/11/2026', items: ['Bản đồ 3D: Khu H đi vào được theo sơ đồ phòng thật, Khu F (hội trường, khối logo, sân F), đài phun nước', 'Sự kiện Đồ thất lạc trong server', 'Giữ đăng nhập khi tải lại trang'] },
  { v: '1.4.0', d: '13/11/2026', items: ['Trang quản trị với thống kê sử dụng', 'Chấm sao và góp ý cho ứng dụng', 'Bản đồ 3D: cầu vượt đường sắt Ngô Sĩ Liên, nhà xe khu E'] },
  { v: '1.3.0', d: '12/11/2026', items: ['Server bản đồ nhiều người chơi: chat, phòng họp voice chat, tùy chỉnh nhân vật, chở nhau bằng xe', 'Đá bóng ở sân vận động', 'Thông báo khi có phiên bản mới'] },
  { v: '1.2.0', d: '10–11/11/2026', items: ['Bản đồ 3D khuôn viên trường: đi dạo nhập vai, xe máy, căn tin, Khu E1, Nhà S, cổng trường, sân vận động'] },
  { v: '1.1.2', d: '10/11/2026', items: ['Ra mắt bản web: check-in, streak, thời khóa biểu, deadline có thông báo, tài liệu và link chia sẻ, mini game'] },
];
