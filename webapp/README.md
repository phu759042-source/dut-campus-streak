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

Thông báo trong app (`js/update.js`): khi có bản deploy mới, trang đang mở hiện thanh **Có bản cập nhật mới** kèm nút
Tải lại. Muốn báo cho người dùng một thay đổi cụ thể (vd bản đồ có cầu mới) thì sửa `NEWS` trong file đó: mỗi `id` mới
hiện một lần trên mỗi trình duyệt (nhớ bằng `localStorage` `cs-news`), tự ẩn sau 15 giây và thôi hiện sau ngày `until`.
Nút trên thanh mở `path`; nếu đang ở `/map` thì bản đồ tự đi tới địa điểm `place` (sự kiện `cs-goto`).

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
- Mặt đất: mọi lớp phẳng (nền trường, cỏ, sân, đường, lối đi, sân bóng, đường chạy) nằm ở đúng cao độ `y = 0`, nơi
  nhân vật và bánh xe đứng. Các lớp không tranh độ sâu với nhau vì được vẽ trước, theo thứ tự (`renderOrder`), và
  không ghi depth (`depthWrite: false`); mọi vật khác nằm trên mặt đất nên vẽ đè lên. Mô hình sinh viên có đế giày
  cao hơn gốc toạ độ `SOLE` (`js/walk.js`), các tư thế đứng/chạy trừ đi khoảng đó để chân chạm đất.
- Cầu vượt đường sắt Ngô Sĩ Liên (`js/bridge.js`, dữ liệu `bridge` / `rail` / `signs` trong campus.json): dựng theo
  số liệu thật (Km 784+425 đường sắt Bắc – Nam, thông xe 27-10-2013; 7 nhịp dầm bản 20 m, mặt cầu rộng 11 m gồm
  7 m xe chạy + 2 lề bộ hành 1,5 m + 2 dải lan can 0,5 m, tĩnh không 4,75 m, đường gom hai bên). Đường dẫn hai đầu
  là tường chắn, 6 trụ thân tường + xà mũ, đỉnh cầu cao khoảng 7 m ngay trên đường sắt (nhịp 5). Đường gom bên phải
  là lối vào, đi vòng dưới nhịp 5 rồi ra bằng đường gom bên trái (đầu đường có 2 biển cấm đi ngược chiều). Gầm cầu
  (nhịp 1–4) lát nền, có ghế, loa kéo và đèn: chỗ tập văn nghệ; cổng sau khu E (cạnh nhà xe khu E) mở ra đây.
  Đi bộ / đi xe lên cầu được (mặt cầu là các `surfaces` dốc, lan can và tường chắn là `walls` có khoảng cao độ, trụ
  là `posts`); xe tự nghiêng theo dốc; đứng dưới gầm thì camera nằm dưới mặt cầu (`under` của surface).
- Địa điểm (`pois` trong campus.json): `at` là chỗ đặt nhãn, `spot` là chỗ nhân vật xuất hiện khi "đi tới" và `look` là
  hướng nhìn (nhà xe khu B, nhà xe khu E, cầu vượt). `wallH` cho chiều cao riêng của từng đoạn tường (tường sân vận
  động cao 2,8 m để đứng ngoài đường gom không nhìn thấy sân).
- Đi vào bên trong (`js/interiors.js`): Căn tin cạnh Khu E1 (cửa trước + cửa hông, 5 bàn ăn, tủ lạnh nước, quầy cà phê, bếp
  phía sau quầy phục vụ; mái tự ẩn khi đứng trong) và Khu E1 có hành lang tầng 1–2 + cầu thang ở đầu gần căn tin.
- Logo trường trên bản đồ (lõi Nhà S, khối vuông trên cột ở cổng chính, ô nhỏ chân cột, bảng xanh trên nhà bảo vệ)
  luôn dùng đúng ảnh gốc `img/dut-logo.jpg`, không tự vẽ lại (`emblemTex` / `drawEmblem` trong `js/campus-details.js`).
- Khu H đi vào được hết (`js/khu-h.js`), dựng theo sơ đồ phòng chức năng treo trong khu H: khối giữa 4 tầng, hai cánh
  3 tầng, sàn tầng 1 nâng cao 0,75 m (chân tường gạch, bậc lên ở mọi cửa), hành lang phía sân trong có cửa kính + mái
  ngói nhỏ, phòng học đánh số như sơ đồ (101–108, 201–208, 301–308, 401–402, có bảng, bàn giáo viên, dãy bàn ghế),
  WC / Kho vật tư / Phòng nước GV, cầu thang chữ U ở sảnh chính (bậc tròn, sảnh kính cong tầng 2–4) và ở hai tháp góc
  (lam ngang trắng). Khi đứng bên trong, các tầng phía trên tự ẩn để camera nhìn thấy tầng đang đứng. Layout đo theo 16
  góc của đường viền OSM; nếu đường viền đổi thì khu H quay về khối đặc như cũ (`isKhuH`).
  Bộ đi bộ hỗ trợ sàn tầng 2, bậc thang (ramp) và tường/lan can chỉ chặn ở đúng độ cao.

### Chế độ server (nhiều người chơi)

- Nút **Vào server** trên `/map` (cần đăng nhập). Lần đầu chọn nhân vật (màu da, kiểu tóc, màu tóc, áo, quần, balo, kính);
  lựa chọn lưu trong `user_metadata.campus_look` của tài khoản Supabase. Tên trên đầu là `profiles.display_name`.
- Thấy các bạn khác đi bộ / đi xe theo thời gian thực, chat chung (phím / để gõ, Enter để gửi, bong bóng chữ trên đầu), biểu cảm,
  danh sách người online (bấm vào tên/nhân vật để Đi tới, Vẫy tay, Mời họp).
- **Đèo nhau**: đứng gần một bạn đang đi xe tay ga / xe máy, nhấn **E** (hoặc nút "Ngồi sau xe…") để ngồi lên yên sau;
  nhấn E lần nữa để xuống. Mỗi xe chở thêm một người; người lái có nút "Cho xuống", và khi người lái xuống xe
  thì người ngồi sau cũng xuống. Server chỉ ghi ai ngồi sau xe ai (`ride` / `unride`, trường `r`); mỗi máy tự vẽ
  người ngồi sau ngay trên xe của người lái nên không bị trễ.
- Phòng họp: công khai hoặc riêng tư (chỉ người được mời), tối đa 8 người, có chat riêng và **voice chat** bằng micro.
  Giọng nói đi thẳng giữa các trình duyệt (WebRTC, mesh); server chỉ chuyển tin nhắn thiết lập.
  Khi hai máy không nối thẳng được (4G, mạng công ty…), giọng nói đi vòng qua TURN của Cloudflare: key tạo trong
  dashboard Cloudflare (Realtime → TURN), lưu bằng `npx wrangler secret put TURN_KEY_ID` và
  `npx wrangler secret put TURN_KEY_API_TOKEN`; `/turn-check` trên worker cho biết đã bật chưa.
- Server: `world-server/` (Cloudflare Worker + Durable Object, WebSocket Hibernation), địa chỉ
  `wss://dut-campus-world.dut-campus-world.workers.dev/world` (khai báo ở `js/world.js`). Server kiểm tra token đăng nhập
  với Supabase Auth, chỉ nhận kết nối từ campusstreak.com (và localhost, preview Vercel), mỗi tài khoản một kết nối.
  Deploy: `cd world-server && npm install && npx wrangler deploy` (cần `npx wrangler login` một lần).
- Thử ở máy: `cd world-server && npx wrangler dev --port 8787`, tạo file `world-server/.dev.vars` với `DEV_FAKE_AUTH=1`,
  rồi mở nhiều tab `http://localhost:5173/map?dev=TenBatKy` để vào server như các sinh viên giả (chỉ có ở máy cục bộ).
- Code: `js/world.js` (kết nối, gửi vị trí ~8 lần/giây khi di chuyển, voice), `js/players.js` (nhân vật của người khác,
  nội suy chuyển động), `js/pages/map-world.js` (giao diện server, chỉnh nhân vật).

### Bóng đá ở sân vận động (trong chế độ server)

- Nút ⚽ trên thanh server mở bảng **Bóng đá**: vào đội **Xanh** hoặc **Cam** (tối đa 5 người mỗi đội) hoặc
  **Ghép ngẫu nhiên**. Vào đội là mặc áo đội và được đưa xuống sân. Khi cả hai đội đều có người: đếm ngược 10 giây,
  giao bóng, trận 5 phút; bàn thắng có thông báo lớn, hết giờ có kết quả và danh sách ghi bàn, rồi tự đá trận mới.
  Thủ môn hai bên do máy điều khiển (bắt bóng, đẩy bóng, phát bóng).
- Cách chơi: chạy vào bóng để dắt bóng. Máy tính (bóng bay theo hướng camera):
  - **Chuột phải** giữ để lấy lực, thả để sút (sút gần khung thành thì bóng được nắn vào trong cột).
  - **Chuột trái** bấm: chuyền thấp; giữ: chuyền cao (bổng qua đầu tới đồng đội). Kéo chuột trái vẫn là xoay camera.
  - **Space** nhảy; đang ở trên không bấm (hoặc giữ) **chuột phải** để vô lê, **chuột trái** để đánh đầu khi bóng tới.
  - Giữ chuột trái hoặc phải rồi bấm **Space**: xe đạp chổng ngược (bóng bay về phía camera nhìn).
  - **E** xoạc cướp bóng, **Q** lừa bóng (lướt nhanh, đối thủ xoạc lúc đó sẽ hụt), **Shift** chạy nhanh (tốn thể lực).
  - Điện thoại: nút Sút / Chuyền (chạm: thấp, giữ: cao) / Nhảy / Xoạc / Lừa; Nhảy rồi bấm Sút = vô lê, Nhảy rồi bấm
    Chuyền = đánh đầu, giữ Sút hoặc Chuyền rồi bấm Nhảy = xe đạp chổng ngược (bóng bay ra sau lưng).
- Khi giữ bóng: đường chấm trắng là đường chuyền thấp; giữ chuyền thì hiện đường chấm vàng của chuyền cao và vòng chỗ
  bóng rơi (giữ càng lâu càng xa: yếu nhất ~14 m, hết lực ~50 m, tức là từ vạch cầu môn rơi đúng giữa sân, cao ~8,5 m);
  giữ sút thì hiện đường chấm đỏ của cú sút theo lực.
- Vật lý bóng (`js/soccer-core.js`) theo bóng thật: trọng lực 9,81 m/s², cản không khí K·v² (K ≈ 0,012/m), lăn trên cỏ
  chậm dần 1,1 m/s² + 0,1/s × vận tốc (bóng 16 m/s lăn ~60 m), nảy giữ ~60 % vận tốc đứng và ~70 % vận tốc ngang.
- Người giữ bóng có vòng tròn màu đội dưới chân (ai cũng thấy); người không đá còn thấy trái banh chỉ xuống đầu họ.
  Xoạc (trượt ~4,8 m) chỉ cướp được bóng khi chân đi qua giữa vòng tròn (`fxh`, server kiểm tra lại); xoạc trúng bóng
  tự do thì lấy luôn bóng. Người bị xoạc ngã sấp nằm 2 giây rồi chống tay, quỳ, đứng dậy (~2,9 giây không chạm bóng).
  Xoạc và lừa bóng hồi 2 giây; bấm khi chưa hồi xong có tiếng báo.
- Vô lê / đánh đầu bấm lúc đang trên không thì chờ bóng 2 giây, kể cả sau khi đã chạm đất: trong 2 giây đó chạm bóng
  (bóng bay, lăn hay đứng yên) là đánh.
- Chuột trái bấm nhanh (nút Chuyền chạm nhanh): đẩy bóng lên trước vừa đủ để chạy theo bắt lại (đứng yên ~4 m, đang chạy
  bóng đi trước vài mét); giữ là chuyền cao. Không còn tự chuyền thấp cho đồng đội.
- Giữ nút sút / chuyền trước khi có bóng: trong 2 giây, vừa chạm bóng là sút / chuyền luôn với lực đã tích tới lúc đó.
- Cầu thủ trên sân có dáng chạy riêng (sải bước dài, người đổ về trước, tay đánh mạnh), không còn là đi bộ nhanh.
- Khán đài 7 bậc hai bên sân (đi lên được, nhấn **E** hoặc nút 🪑 để ngồi xuống ghế). Khi một trận bắt đầu, người
  đang ở chỗ khác trong trường thấy thông báo **Đến xem** (đưa lên ghế khán đài) hoặc **Vào đá**.
- Server là trọng tài: `world-server/src/soccer.js` giữ đội, tỉ số, đồng hồ, kiểm tra từng lần chạm bóng / sút / xoạc /
  vô lê / đánh đầu / xe đạp chổng ngược (bóng phải thật sự ở gần) và lừa bóng,
  và chạy bóng + thủ môn bằng `js/soccer-core.js`. Trình duyệt chạy đúng file đó để đoán trước đường bóng giữa các lần
  server gửi (`js/soccer.js`), nên bóng chạy mượt. Giao diện: `js/pages/map-soccer.js`; khán đài: `js/stadium.js`.
- Thử ở máy: chạy `world-server` như trên rồi mở 2 tab `/map?dev=A`, `/map?dev=B`, mỗi tab vào một đội.
