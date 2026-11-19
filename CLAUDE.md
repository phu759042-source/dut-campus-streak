# DUT Campus Streak

Ứng dụng cho sinh viên Trường Đại học Bách khoa – ĐH Đà Nẵng (DUT): check-in lớp học bằng ảnh biển số phòng, streak,
thời khóa biểu, deadline, tài liệu, chat, bảng xếp hạng và **bản đồ 3D khuôn viên trường** (đi dạo, server nhiều người
chơi). Chủ dự án làm một mình, giao tiếp bằng tiếng Việt: trả lời bằng tiếng Việt.

- Tên thương hiệu: **DUT Campus Streak** (mọi chỗ hiển thị). Tên miền **giữ nguyên `campusstreak.com`** (www là bản chính).
- Hơn 440 tài khoản; trang `/map` được Google lập chỉ mục với từ khóa "map dut".

## Các phần của repo

| Thư mục | Là gì |
|---|---|
| `lib/main.dart` | App Flutter (Android/iOS), build bằng Codemagic (`codemagic.yaml`). Một file rất lớn. |
| `webapp/` | **Bản web** (phần làm nhiều nhất). Trang tĩnh Preact + htm, supabase-js và three.js qua import map trong `index.html`, **không cần build**. Vercel project `dut-campus-streak-webapp`, Root Directory `webapp`, tự deploy từ `main`. |
| `webapp/api/` | Vercel functions: `seo-page.js` (HTML cho Google ở `/map`, `/gioi-thieu`: tiêu đề, mô tả, JSON-LD, FAQ), `share-page.js` (`/s/<mã>`), `version.js` (`/api/version`). |
| `webapp/world-server/` | Server bản đồ nhiều người chơi (Cloudflare Worker + Durable Object, `wrangler.toml`): vị trí, chat, voice, đá bóng, sự kiện đồ thất lạc. |
| `supabase/` | Backend: `schema/` (ảnh chụp schema), `migrations/` (mỗi thay đổi DB một file), `functions/` (Edge Functions), `templates/` (email xác nhận / đặt lại mật khẩu / đổi mật khẩu thành công, giao diện tối). |
| `promo/` | Tài liệu quảng bá. |

### Bản web: file chính (`webapp/js/`)

- `app.js`: khởi động, phiên đăng nhập, khung điều hướng (sidebar trên máy tính, Hồ sơ ở cuối ngay trên nút cài ứng dụng; thanh 6 mục dưới trên điện thoại), router. Tự đăng xuất nếu tài khoản đã bị xóa ở máy khác (`accountGone`).
- `lib.js`: Supabase client, giờ VN, `ensureCurrentUserData`, `errMsg` (dịch lỗi sang tiếng Việt), theme (`FORCED_DARK` cho trang giới thiệu và đăng nhập), số tài khoản, `APP_VERSION`.
- `ui.js`: icon (SVG path trong `P`), `openSheet`, `toast`, `Avatar`, `Segmented`...
- `changelog.js`: lịch sử phiên bản (xem "Quy trình").
- `chat.js` + `pages/chat.js`: phòng chung, tin nhắn riêng, bạn bè, chặn, báo cáo; tên/ảnh/lớp lấy qua RPC `chat_people`.
- `pages/*.js`: từng màn hình (`map.js` bản đồ, `map-world.js` server, `admin.js` + `admin-reports.js` trang quản trị, `misc.js` Giới thiệu...).
- Bản đồ 3D: `map3d.js` (scene, vòng vẽ, mức đồ họa Cao/Vừa/Thấp, giới hạn FPS, bộ đếm FPS), `walk.js` (đi bộ/xe), `interiors.js`, `khu-b.js`, `khu-f.js`, `khu-h.js`, `landmarks.js`, `campus-details.js` (`emblemTex()`, `LOGO_ASPECT`), `stadium.js`, `soccer*.js`, `lost*.js`, `music.js`, `world.js` (kết nối server).
- `update.js`: báo có bản mới, và thông báo sự kiện `NEWS`.

### Supabase

- Project id `gmwurbvhhzgdikogxiqb`. Đổi DB bằng migration mới trong `supabase/migrations/` (đặt tên `YYYYMMDDHHMMSS_ten.sql`), áp dụng qua MCP `apply_migration`, rồi commit file.
- RPC: `SECURITY DEFINER`, `set search_path`, `revoke ... from public, anon`, `grant execute ... to authenticated`. Quyền admin: `is_admin()` đọc bảng `app_admins`.
- RLS: `profiles` và `users` chỉ chủ tài khoản đọc được; thông tin công khai của người khác đi qua RPC (`get_leaderboard`, `get_public_profile`, `chat_people`).
- Trigger `users_require_auth_user`: không tạo được dòng `public.users` cho tài khoản không còn trong `auth.users` (lỗi `account_deleted`).
- Edge Functions: `verify-room` (Gemini đọc biển số phòng; tự thử lại khi 503/429 rồi dùng model dự phòng `GEMINI_FALLBACK_MODEL`), `complete-check-in`, `delete-account`, `push-reminders` (web push, chạy bằng pg_cron), `shared-documents`.
- Email: gửi qua Resend (SMTP của Supabase).

## Quy trình

### Đẩy bản web lên (sửa trong `webapp/`)

Đẩy thẳng lên `main`, không cần PR. Checkout này có thay đổi chưa commit ở `lib/`, `supabase/` và `main` cục bộ lệch
`origin/main`, nên **dựng commit trên `origin/main` bằng index tạm** và chỉ `git add` đúng các file mình sửa:

```bash
git fetch -q origin
export GIT_INDEX_FILE=.git/index-web-tmp
git read-tree origin/main
git add webapp/<các file đã sửa>
git diff --cached --stat origin/main   # chỉ được thấy file mình sửa (chủ dự án đôi khi sửa thẳng trên GitHub)
T=$(git write-tree)
C=$(printf 'Mô tả\n\nCo-Authored-By: ...\n' | git commit-tree $T -p origin/main)
git push -q origin $C:refs/heads/main && git update-ref refs/heads/web $C
```

Sau đó chờ Vercel (khoảng 1 phút) và kiểm tra file thật, ví dụ `curl -s https://www.campusstreak.com/js/changelog.js | grep <phiên bản>`.

### Phiên bản

Mỗi lần đẩy web, thêm một dòng **đầu tiên** vào `webapp/js/changelog.js` trong cùng commit: tính năng mới hoặc thay
đổi lớn thì tăng số giữa (1.10.x → 1.11.0), sửa lỗi hoặc chỉnh nhỏ thì tăng số cuối (1.10.4 → 1.10.5). Nội dung tiếng
Việt, ngày `dd/mm/yyyy`. Báo số phiên bản mới cho chủ dự án. Lịch sử cập nhật chỉ admin xem được (trang Giới thiệu); khi
có mảng tính năng mới, cập nhật danh sách tính năng trong `js/pages/misc.js`.

### Chạy thử trên máy

- Web: `python dev_server.py 5173` trong `webapp/`, mở `http://localhost:5173`. Dữ liệu giả không cần đăng nhập: chạy `await import('/dev/mock.js')` trong console (thư mục `dev/` không được deploy).
- Server bản đồ: `npx wrangler dev --port 8787` trong `webapp/world-server`, rồi mở `/map?dev=Tên` để vào server như một sinh viên giả (cổng khác thì thêm `&wsport=<cổng>`).
- Trên localhost, `window.__map` là scene bản đồ (`startWalk`, `teleport`, `measure()`, `setGraphics`, `graphics()`...).
- Khung trình duyệt của app thường bị ẩn nên gần như không vẽ khung hình (`requestAnimationFrame` không chạy). Muốn đo FPS hay chụp bản đồ thì chạy Chrome headless (`--headless=new --use-angle=swiftshader`) qua DevTools Protocol, giả lập cỡ điện thoại bằng `Emulation.setDeviceMetricsOverride`.
- Lệnh Bash dài quá khoảng 8.000 ký tự bị cắt: viết script ra file rồi chạy.
- File trong `webapp/` dùng xuống dòng CRLF: khi sửa bằng script, đọc bình thường rồi ghi lại với `newline='\r\n'`.

## Quy tắc chủ dự án đã đặt

- **Logo trường luôn đầy đủ**: dùng nguyên ảnh `webapp/img/dut-logo.jpg` qua `emblemTex()` / `LOGO_ASPECT`, kể cả chữ "ĐÀ NẴNG / BÁCH KHOA"; không cắt, không tự vẽ logo.
- Giao diện phải vừa mọi điện thoại (320–430px dọc, xoay ngang cao khoảng 320–430px) và máy tính; trên bản đồ, các nút không được che nhau. Thử ở nhiều cỡ trước khi đẩy.
- Máy yếu (laptop không card đồ họa) phải chạy được bản đồ: giữ mức đồ họa Thấp và chế độ Tự động hoạt động.
- Trang Giới thiệu và các trang đăng nhập/đăng ký/mật khẩu luôn giao diện tối.
- Hỏi trước khi làm việc lớn ngoài `webapp/` (app Flutter, xóa dữ liệu thật, tốn tiền).
- **Giữ file này luôn đúng**: mỗi lần cập nhật hay sửa gì làm thay đổi những điều ghi ở đây (file hoặc tính năng mới,
  bảng / RPC / Edge Function mới, quy trình, quy tắc mới chủ dự án đặt ra), sửa luôn `CLAUDE.md` trong cùng commit.
  Chỉ ghi điều phiên sau cần biết, không ghi nhật ký từng lần sửa (cái đó nằm trong `changelog.js` và git).
