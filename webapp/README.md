# DUT Campus Streak — bản web

Bản web của app Flutter (`lib/main.dart`), dùng chung backend Supabase (`gmwurbvhhzgdikogxiqb`).
Trang tĩnh, **không cần build**: Preact + htm và supabase-js tải từ CDN qua import map trong `index.html`.

Địa chỉ: https://campusstreak.com (Vercel project `campusstreak`, team DUT).

## Tính năng

Giống app: đăng nhập / đăng ký / quên mật khẩu, Trang chủ (lịch hôm nay, buổi tiếp theo + đếm ngược, ngọn lửa streak),
check-in bằng camera điện thoại, Đã check-in hôm nay, Xếp hạng (ngày/tuần, chung/theo lớp, banner hồ sơ, định vị tôi),
Thời khóa biểu (thêm/sửa/xóa mềm, xóa toàn bộ, nhập bảng lịch DUT), báo nghỉ / học bù, Deadline (đếm ngược, meme),
Tài liệu (thư mục/tệp, kéo thả), Hồ sơ (avatar, banner có khung cắt, sáng/tối, đổi email/mật khẩu, xóa tài khoản),
Thành tích, Liên hệ & Giới thiệu.

Riêng bản web có thêm:

- **Chia sẻ tài liệu qua link** (`/s/<mã>`): người nhận không cần đăng nhập, xem trước và mở tệp, tải về nếu được cho phép.
  Thu hồi link bất cứ lúc nào. Backend: bảng `document_shares` + Edge Function `shared-documents` (service role, chỉ đọc,
  kiểm tra tệp nằm trong thư mục được chia sẻ, signed URL 10 phút).
- **Web Push nhắc deadline**: 7h, 13h, 19h (giờ VN) và trước hạn 24h, 6h, 1h, 15 phút, lúc đến hạn — kể cả khi đã đóng trang.
  Backend: bảng `push_subscriptions`, `push_reminder_log`, RPC `register_push_subscription`, Edge Function `push-reminders`,
  job pg_cron `push-deadline-reminders` (5 phút/lần, gọi qua pg_net). Khóa VAPID và cron secret nằm trong Supabase Vault
  (`push_vapid_public`, `push_vapid_private`, `push_vapid_subject`, `push_cron_secret`); khóa công khai cũng có trong `js/push.js`.
  iPhone: cần “Thêm vào MH chính” và mở từ màn hình chính thì mới bật được thông báo (iOS 16.4+).
- **Trò chơi nhỏ** trên trang chủ (Lật thẻ — bàn mới mỗi ngày, Toán nhanh, Bắt lửa); điểm lưu trong trình duyệt.
- **Xem trước tài liệu**: trang đầu PDF (pdf.js), ảnh thu nhỏ hoặc chữ đầu của docx/pptx/xlsx (JSZip), dòng đầu của txt/csv.

Migration: `supabase/migrations/20261110160000_document_shares_and_web_push.sql`; mã Edge Function trong `supabase/functions/`.

Chưa có: nhắc lịch học (app Android vẫn nhắc bằng thông báo cục bộ).

## Cấu trúc

```
webapp/
├── index.html            # import map, font, theme trước khi vẽ
├── styles.css            # toàn bộ giao diện (sáng/tối, animation)
├── vercel.json           # SPA rewrite + header bảo mật
├── js/
│   ├── lib.js            # Supabase client, giờ VN, helper lớp học, Edge Function
│   ├── ui.js             # icon, sheet/dialog, toast, ngọn lửa, confetti, meme
│   ├── router.js         # router History API
│   ├── app.js            # khởi động, phiên đăng nhập, khung điều hướng
│   ├── memes.js          # danh sách meme (ảnh/âm thanh lấy từ assets/ qua jsDelivr)
│   └── pages/*.js        # từng màn hình
├── dev/mock.js           # chỉ dùng khi dev: dữ liệu giả để xem giao diện
├── dev_server.py         # server cục bộ có SPA fallback
└── build.py              # (tùy chọn) xuất bản rút gọn vào dist/
```

## Chạy cục bộ

Cần Python 3.

```bash
cd webapp
python dev_server.py
```

Mở http://localhost:5173. Server trả `index.html` cho mọi đường dẫn không phải file (giống rewrite trên Vercel).

Xem giao diện không cần đăng nhập: mở console trình duyệt, chạy `await import('/dev/mock.js')`, rồi
`(await import('/dev/mock.js')).go('/leaderboard')`. Dữ liệu chỉ là giả, không ghi gì lên Supabase.

## Deploy

Vercel project `campusstreak` được nối với repo GitHub này, **Root Directory = `webapp`**, không có build command.
Push lên nhánh production là Vercel tự deploy; nhánh khác tạo bản preview.

Deploy tay (cần Node.js):

```bash
cd webapp
npx vercel --prod
```

`.vercelignore` loại `dev/`, `dev_server.py`, `build.py`, `dist/` khỏi bản deploy.

## Tên miền campusstreak.com

Tên miền đăng ký ở Namecheap. Trỏ về Vercel bằng một trong hai cách:

- Giữ DNS ở Namecheap: bản ghi `A @ 76.76.21.21` và `CNAME www cname.vercel-dns.com` (giá trị chính xác xem ở Vercel → Project → Settings → Domains).
- Hoặc đổi nameserver sang `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.

## Cấu hình Supabase cần có

Authentication → URL Configuration:

- **Site URL** hoặc **Additional Redirect URLs** phải có `https://campusstreak.com/**`
  (dùng cho email xác nhận đăng ký, đặt lại mật khẩu `/reset`, đổi email). Thiếu thì link trong email sẽ trỏ về Site URL cũ.
- Khi dev cục bộ có thể thêm `http://localhost:5173/**`.

Trình duyệt chỉ dùng **publishable key** (trong `js/lib.js`). Không bao giờ đưa service role key vào web.

## Luồng check-in (giống app)

1. Chỉ mở từ 15 phút trước giờ học đến hết giờ học, tính theo giờ Việt Nam (`Asia/Ho_Chi_Minh`), không phụ thuộc múi giờ máy.
2. Chụp ảnh biển phòng bằng camera sau (`getUserMedia`). Nếu trình duyệt chặn camera, nút “Mở camera máy” dùng
   `<input capture="environment">`.
3. Ảnh được thu nhỏ (≤1600px, JPEG) và tải lên `check-in-images/<uid>/<class_session_id>/<ms>.jpg`.
4. Gọi Edge Function `complete-check-in` với `{ image_path, class_session_id }` (không có tiền tố bucket).
   Server kiểm tra giờ, đọc biển phòng bằng Gemini và ghi `check_ins`. Client không có quyền ghi `check_ins`.

Camera trên web cần HTTPS (hoặc `localhost`).
