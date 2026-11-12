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

## Bản đồ trường 3D (`/map`)

- Trang công khai (không cần đăng nhập), dùng Three.js 0.169 qua import map; chỉ tải khi mở `/map`.
- Dữ liệu: `data/campus.json`, sinh từ bản trích OpenStreetMap `dev/osm/dut-osm.json` (© OpenStreetMap contributors, ODbL) bằng
  `python -I -X utf8 dev/build_campus.py`. Toạ độ tính bằng mét, xoay giống bản đồ khuôn viên chính thức
  (đường Nguyễn Lương Bằng ở dưới, Ngô Sĩ Liên bên phải).
- Tên khu (A, B, C1–C3, D, E1, E2, F, G, H, I, K, L, M, N, P, S, X) được gán theo id OSM trong `ZONES` của script.
  Số tầng lấy từ OSM nếu có, còn lại là ước lượng (`estimated: true`). Sửa script rồi chạy lại để cập nhật.
- Tìm kiếm: mã phòng (vd `F305`) dẫn tới khu theo chữ cái đầu; link sâu `/map?k=F` hoặc `/map?room=F305`.
- Code: `js/map3d.js` (cảnh 3D, vẽ theo yêu cầu, không vẽ liên tục), `js/pages/map.js` (giao diện, nhãn, thẻ thông tin).
- Chế độ nhập vai (`js/walk.js`): nhân vật low-poly tự dựng bằng khối cơ bản; WASD/mũi tên, Shift chạy, Space nhảy,
  kéo chuột xoay camera, O khóa chuột (pointer lock) để di chuột là xoay, lăn chuột zoom (sát vào hoặc F = góc nhìn thứ nhất),
  E xem tòa nhà đang đứng gần, Esc thoát. Điện thoại: joystick ảo (đẩy hết cỡ để chạy),
  nút nhảy, vuốt để xoay, 2 ngón để zoom. Va chạm theo footprint 2D của tòa nhà; tòa nhà che camera sẽ mờ đi.
  Phím 1/2/3 (hoặc nút bên phải): đi bộ, xe tay ga, xe máy — W/S ga/phanh, A/D lái, Space bóp còi. H ẩn/hiện nhãn.
- Chi tiết công trình (`js/campus-details.js`): mặt tường theo khu (trắng có hành lang, kem, gạch nâu khu F, kính Nhà S,
  Trung tâm Học liệu mái xanh), mái dốc ngói đỏ cho H/F/N/P/X/E1, tường chắn mái + cụm máy trên mái, chân tường,
  sảnh mái che, tường rào (`walls` trong campus.json, có va chạm), cổng có biển tên, mái che bãi xe, đèn đường, hàng cây ven đường.
- Đi vào bên trong (`js/interiors.js`): Căn tin cạnh Khu E1 (cửa trước + cửa hông, 5 bàn ăn, tủ lạnh nước, quầy cà phê, bếp
  phía sau quầy phục vụ; mái tự ẩn khi đứng trong) và Khu E1 có hành lang tầng 1–2 + cầu thang ở đầu gần căn tin.
  Bộ đi bộ hỗ trợ sàn tầng 2, bậc thang (ramp) và tường/lan can chỉ chặn ở đúng độ cao.

### Chế độ server (nhiều người chơi)

- Nút **Vào server** trên `/map` (cần đăng nhập). Lần đầu chọn nhân vật (màu da, kiểu tóc, màu tóc, áo, quần, balo, kính);
  lựa chọn lưu trong `user_metadata.campus_look` của tài khoản Supabase. Tên trên đầu là `profiles.display_name`.
- Thấy các bạn khác đi bộ / đi xe theo thời gian thực, chat chung (Enter để gõ, bong bóng chữ trên đầu), biểu cảm,
  danh sách người online (bấm vào tên/nhân vật để Đi tới, Vẫy tay, Mời họp).
- Phòng họp: công khai hoặc riêng tư (chỉ người được mời), tối đa 8 người, có chat riêng và **voice chat** bằng micro.
  Giọng nói đi thẳng giữa các trình duyệt (WebRTC, mesh); server chỉ chuyển tin nhắn thiết lập.
  Không có TURN nên một số mạng 4G/công ty có thể không nối được giọng (vòng tên mờ đi). Có thể bật TURN miễn phí của
  Cloudflare: tạo TURN key trong dashboard Cloudflare (Realtime → TURN) rồi
  `npx wrangler secret put TURN_KEY_ID` và `npx wrangler secret put TURN_KEY_API_TOKEN`.
- Server: `world-server/` (Cloudflare Worker + Durable Object, WebSocket Hibernation), địa chỉ
  `wss://dut-campus-world.dut-campus-world.workers.dev/world` (khai báo ở `js/world.js`). Server kiểm tra token đăng nhập
  với Supabase Auth, chỉ nhận kết nối từ campusstreak.com (và localhost, preview Vercel), mỗi tài khoản một kết nối.
  Deploy: `cd world-server && npm install && npx wrangler deploy` (cần `npx wrangler login` một lần).
- Thử ở máy: `cd world-server && npx wrangler dev --port 8787`, tạo file `world-server/.dev.vars` với `DEV_FAKE_AUTH=1`,
  rồi mở nhiều tab `http://localhost:5173/map?dev=TenBatKy` để vào server như các sinh viên giả (chỉ có ở máy cục bộ).
- Code: `js/world.js` (kết nối, gửi vị trí ~8 lần/giây khi di chuyển, voice), `js/players.js` (nhân vật của người khác,
  nội suy chuyển động), `js/pages/map-world.js` (giao diện server, chỉnh nhân vật).
