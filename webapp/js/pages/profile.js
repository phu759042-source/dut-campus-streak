import { html, useState, useEffect, useRef } from 'preact';
import {
  supabase, appStore, currentUser, ensureCurrentUserData, loadMyProfile, saveTheme, errMsg,
  invokeFunction, loadImage, canvasToBlob, applyTheme, resizeToJpeg,
} from '../lib.js';
import { pushStatus, enablePush, disablePush, isPushOn, sendTestPush } from '../push.js';

/** Banner shape used everywhere (profile, leaderboard card, cropper). */
export const BANNER_ASPECT = 2.4;
import { Icon, Avatar, Spinner, Skeleton, openSheet, confirmDialog, toast, Field, PasswordInput } from '../ui.js';
import { navigate } from '../router.js';
import { PageHeader } from './shared.js';
import { useStore } from './home.js';

// ------------------------------------------------------------------
// Image cropper (drag to move, slider / wheel / pinch to zoom)
// ------------------------------------------------------------------
export function Cropper({ src, aspect, outW, round = false, close }) {
  const frameRef = useRef();
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const pointers = useRef(new Map());

  const [, rerender] = useState(0);
  useEffect(() => { loadImage(src).then(setImg).catch(() => toast('Không đọc được ảnh.', 'error')); }, [src]);
  useEffect(() => {
    const onResize = () => { rerender((x) => x + 1); setPos((p) => clamp(p)); };
    window.addEventListener('resize', onResize);
    const t = setTimeout(onResize, 450); // after the open animation
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [img]);

  // Geometry: image scaled to cover the frame at zoom 1.
  function geom(z = zoom) {
    // offsetWidth/Height = layout size, unaffected by the sheet's opening scale animation.
    const el = frameRef.current;
    if (!el || !img || !el.offsetWidth) return null;
    const f = { width: el.offsetWidth, height: el.offsetHeight };
    const cover = Math.max(f.width / img.naturalWidth, f.height / img.naturalHeight) * z;
    return { fw: f.width, fh: f.height, w: img.naturalWidth * cover, h: img.naturalHeight * cover, scale: cover };
  }
  function clamp(p, z = zoom) {
    const g = geom(z);
    if (!g) return p;
    const mx = (g.w - g.fw) / 2, my = (g.h - g.fh) / 2;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  }
  const setZoomClamped = (z) => { const nz = Math.max(1, Math.min(4, z)); setZoom(nz); setPos((p) => clamp(p, nz)); };

  function onDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = { x: e.clientX, y: e.clientY, pos, zoom, dist: null };
  }
  function onMove(e) {
    if (!drag.current || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!drag.current.dist) drag.current.dist = d;
      setZoomClamped(drag.current.zoom * (d / drag.current.dist));
      return;
    }
    setPos(clamp({ x: drag.current.pos.x + e.clientX - drag.current.x, y: drag.current.pos.y + e.clientY - drag.current.y }));
  }
  function onUp(e) { pointers.current.delete(e.pointerId); if (!pointers.current.size) drag.current = null; }

  async function done() {
    const g = geom();
    if (!g) return;
    const outH = Math.round(outW / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // Top-left of the frame in image pixels.
    const sx = ((g.w - g.fw) / 2 - pos.x) / g.scale;
    const sy = ((g.h - g.fh) / 2 - pos.y) / g.scale;
    ctx.drawImage(img, sx, sy, g.fw / g.scale, g.fh / g.scale, 0, 0, outW, outH);
    close(await canvasToBlob(canvas, 0.9));
  }

  const g = img && geom();
  return html`<div class="stack">
    <div ref=${frameRef} class=${'crop-frame' + (round ? ' round' : '')} style=${`aspect-ratio:${aspect}`}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
      onWheel=${(e) => { e.preventDefault(); setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 0.92)); }}>
      ${img ? html`<img src=${src} alt="" draggable="false" style=${g ? `width:${g.w}px;height:${g.h}px;transform:translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` : 'opacity:0'} />`
        : html`<div class="center pad"><${Spinner} /></div>`}
    </div>
    <label class="zoom-row"><${Icon} name="zoom" size=${18} />
      <input type="range" min="1" max="4" step="0.01" value=${zoom} onInput=${(e) => setZoomClamped(+e.target.value)} /></label>
    <div class="muted small center">Kéo để căn chỉnh, kéo thanh trượt hoặc chụm hai ngón để phóng to.</div>
    <div class="dialog-actions">
      <button class="btn btn-ghost" onClick=${() => close(null)}>Hủy</button>
      <button class="btn btn-primary" disabled=${!img} onClick=${done}>Xong</button>
    </div>
  </div>`;
}

function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

async function cropImage(file, opts, title) {
  const url = URL.createObjectURL(file);
  try {
    return await openSheet(({ close }) => html`<${Cropper} src=${url} ...${opts} close=${close} />`, { title, wide: true });
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------
// Dialogs
// ------------------------------------------------------------------
function ChangePassword({ close }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (pw.length < 6) return setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
    if (pw !== confirm) return setError('Mật khẩu xác nhận không khớp.');
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) { setBusy(false); return setError(errMsg(err)); }
    close(true);
  }
  return html`<form class="stack" onSubmit=${submit}>
    <${PasswordInput} placeholder="Mật khẩu mới" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
    <${PasswordInput} placeholder="Nhập lại mật khẩu mới" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} autocomplete="new-password" />
    ${error && html`<div class="form-error shake">${error}</div>`}
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" onClick=${() => close(false)}>Hủy</button>
      <button class="btn btn-primary" disabled=${busy}>${busy ? html`<${Spinner} size=${18} />` : 'Đổi mật khẩu'}</button>
    </div>
  </form>`;
}


function PushSetting() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = pushStatus();
  useEffect(() => { isPushOn().then(setOn); }, []);
  async function toggle(e) {
    const want = e.target.checked;
    setBusy(true);
    try {
      if (want) { await enablePush(); setOn(true); toast('Đã bật thông báo nhắc deadline 🔔', 'success'); }
      else { await disablePush(); setOn(false); toast('Đã tắt thông báo trên thiết bị này.', 'info'); }
    } catch (err) { toast(err.message, 'error', 7000); setOn(await isPushOn()); }
    setBusy(false);
  }
  async function test() {
    setBusy(true);
    try { const r = await sendTestPush(); toast(r.sent ? 'Đã gửi thông báo thử. Kiểm tra thanh thông báo nhé!' : 'Chưa có thiết bị nào bật thông báo.', r.sent ? 'success' : 'error'); }
    catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  }
  const hint = status === 'ios-install' ? 'iPhone: Chia sẻ → "Thêm vào MH chính", mở từ màn hình chính rồi bật.'
    : status === 'denied' ? 'Trình duyệt đang chặn thông báo. Hãy cho phép trong cài đặt trang web.'
    : status === 'unsupported' ? 'Trình duyệt này không hỗ trợ thông báo đẩy.'
    : on ? '7h, 13h, 19h và trước hạn 24h, 6h, 1h, 15 phút' : 'Đang tắt trên thiết bị này';
  return html`<label class="setting">
      <span class="list-icon amber"><${Icon} name="bell" /></span>
      <span class="grow"><b>Thông báo nhắc deadline</b><br /><span class="muted small">${hint}</span></span>
      ${busy ? html`<${Spinner} size=${20} />` : html`<input type="checkbox" class="switch" checked=${on}
        disabled=${status === 'unsupported'} onChange=${toggle} />`}
    </label>
    ${on && html`<button class="setting" onClick=${test} disabled=${busy}><span class="list-icon green"><${Icon} name="sparkles" /></span>
      <span class="grow"><b>Gửi thông báo thử</b></span><${Icon} name="chevron" size=${18} /></button>`}`;
}

export async function logout() {
  await supabase.auth.signOut();
  applyTheme('light');
  appStore.set({ profile: null });
  navigate('/login', { replace: true });
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export function ProfilePage() {
  const store = useStore();
  const [orig, setOrig] = useState(null);
  const [f, setF] = useState(null);
  const [avatar, setAvatar] = useState(null); // { blob, url }
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    await ensureCurrentUserData().catch(() => {});
    const p = await loadMyProfile();
    const o = { name: p.display_name || '', email: p.email || '', code: p.student_code || '', klass: p.class_name || '', avatar_url: p.avatar_url, banner_url: p.banner_url };
    setOrig(o); setF(o); setAvatar(null); setBanner(null);
  }
  useEffect(() => { load().catch((e) => toast(errMsg(e), 'error')); }, []);
  useEffect(() => () => { avatar && URL.revokeObjectURL(avatar.url); banner && URL.revokeObjectURL(banner.url); }, [avatar, banner]);

  if (!f) return html`<div class="page narrow"><${PageHeader} title="Hồ sơ" /><${Skeleton} h=${220} r=${26} /><${Skeleton} h=${56} count=${4} /></div>`;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const changed = f.name.trim() !== orig.name || f.email.trim().toLowerCase() !== orig.email.toLowerCase() ||
    f.code.trim() !== orig.code || f.klass.trim() !== orig.klass || avatar || banner;

  async function chooseAvatar() {
    const file = await pickFile();
    if (!file) return;
    const blob = await cropImage(file, { aspect: 1, outW: 512, round: true }, 'Căn chỉnh ảnh đại diện');
    if (blob) setAvatar({ blob, url: URL.createObjectURL(blob) });
  }
  // Banner: the uncropped original is kept at <uid>/banner-original.jpg so it can be re-cropped later.
  const originalUrl = () => supabase.storage.from('profile-banners').getPublicUrl(`${currentUser().id}/banner-original.jpg`).data.publicUrl;

  async function cropBannerFrom(src, original) {
    const blob = await openSheet(({ close }) => html`<${Cropper} src=${src} aspect=${BANNER_ASPECT} outW=${1440} close=${close} />`,
      { title: 'Căn chỉnh banner', wide: true });
    if (blob) setBanner({ blob, url: URL.createObjectURL(blob), original });
  }
  async function newBanner() {
    const file = await pickFile();
    if (!file) return;
    const fileUrl = URL.createObjectURL(file);
    try {
      // Keep a reasonably sized original for later re-cropping.
      const original = await resizeToJpeg(await loadImage(fileUrl), 2400, 0.9);
      await cropBannerFrom(fileUrl, original);
    } catch (e) { toast(errMsg(e), 'error'); }
    finally { URL.revokeObjectURL(fileUrl); }
  }
  async function editBanner() {
    // Prefer the pending original, then the stored original, then the current banner itself.
    if (banner?.original) {
      const u = URL.createObjectURL(banner.original);
      try { await cropBannerFrom(u, banner.original); } finally { URL.revokeObjectURL(u); }
      return;
    }
    let src = `${originalUrl()}?v=${Date.now()}`;
    try { const r = await fetch(src, { method: 'HEAD' }); if (!r.ok) src = null; } catch { src = null; }
    if (!src) src = f.banner_url;
    if (!src) return newBanner();
    await cropBannerFrom(src, null);
  }
  async function chooseBanner() {
    if (!f.banner_url && !banner) return newBanner();
    const c = await openSheet(({ close }) => html`<div class="stack-sm">
      <button class="menu-item" onClick=${() => close('edit')}><span class="list-icon violet"><${Icon} name="zoom" /></span>
        <span class="grow"><b>Chỉnh lại banner hiện tại</b><br /><span class="muted small">Phóng to, thu nhỏ, chọn lại phần hiển thị</span></span></button>
      <button class="menu-item" onClick=${() => close('new')}><span class="list-icon blue"><${Icon} name="image" /></span>
        <span class="grow"><b>Chọn ảnh mới</b><br /><span class="muted small">Tải một ảnh khác từ máy</span></span></button>
    </div>`, { title: 'Banner' });
    if (c === 'edit') editBanner();
    if (c === 'new') newBanner();
  }

  async function save() {
    const user = currentUser();
    const name = f.name.trim(), email = f.email.trim(), code = f.code.trim(), klass = f.klass.trim();
    if (!name) return toast('Tên hiển thị không được để trống.', 'error');
    setSaving(true);
    try {
      let avatarUrl = orig.avatar_url, bannerUrl = orig.banner_url;
      if (avatar) {
        const path = `${user.id}/avatar.jpg`;
        const { error } = await supabase.storage.from('avatars').upload(path, avatar.blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw error;
        avatarUrl = `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      }
      if (banner) {
        const path = `${user.id}/banner.jpg`;
        const { error } = await supabase.storage.from('profile-banners').upload(path, banner.blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
        if (error) throw error;
        bannerUrl = `${supabase.storage.from('profile-banners').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
        if (banner.original) {
          await supabase.storage.from('profile-banners').upload(`${user.id}/banner-original.jpg`, banner.original,
            { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
        }
      }
      const { error: e1 } = await supabase.from('users').update({ student_code: code, class_name: klass }).eq('id', user.id);
      if (e1) throw e1.code === '23505' ? new Error(`Mã sinh viên "${code}" đã được sử dụng bởi một tài khoản khác.`) : e1;
      const { error: e2 } = await supabase.from('profiles').update({
        display_name: name, avatar_url: avatarUrl, banner_url: bannerUrl, updated_at: new Date().toISOString(),
      }).eq('id', user.id);
      if (e2) throw e2;
      const emailChanged = email.toLowerCase() !== orig.email.toLowerCase();
      if (emailChanged) {
        if (!email) throw new Error('Email không được để trống.');
        const { error: e3 } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/` });
        if (e3) throw new Error('Không thể đổi email: ' + errMsg(e3));
      }
      toast(emailChanged ? `Đã gửi email xác nhận đến ${email}. Hãy xác nhận để hoàn tất đổi email.` : 'Đã lưu thay đổi hồ sơ.', 'success', 5000);
      await load();
    } catch (e) {
      toast('Không thể lưu thay đổi: ' + errMsg(e), 'error', 5000);
    }
    setSaving(false);
  }

  async function changePassword() {
    if (await openSheet(ChangePassword, { title: 'Đổi mật khẩu', center: true })) toast('Đã đổi mật khẩu.', 'success');
  }

  async function deleteAccount() {
    const ok = await confirmDialog({
      title: 'Xóa tài khoản?', danger: true, confirmText: 'Xóa tài khoản',
      message: 'Toàn bộ dữ liệu của bạn (lịch học, check-in, ảnh, deadline, tài liệu) sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.',
    });
    if (!ok) return;
    setSaving(true);
    const res = await invokeFunction('delete-account');
    if (!res.ok) { setSaving(false); return toast('Không thể xóa tài khoản: ' + errMsg(res.data?.error || res.error), 'error'); }
    toast('Tài khoản đã được xóa.', 'success');
    await logout();
  }

  const dark = store.theme === 'dark';
  const bannerSrc = banner?.url || f.banner_url;
  return html`<div class="page narrow">
    <${PageHeader} title="Hồ sơ" />
    <section class="profile-hero pop-in">
      <button class="profile-banner" style=${bannerSrc ? `background-image:url('${bannerSrc}')` : ''} onClick=${chooseBanner} disabled=${saving}>
        <span class="banner-edit"><${Icon} name="image" size=${16} /> Sửa banner</span>
      </button>
      <button class="profile-avatar" onClick=${chooseAvatar} disabled=${saving} aria-label="Đổi ảnh đại diện">
        <${Avatar} url=${avatar?.url || f.avatar_url} name=${f.name} size=${96} ring />
        <span class="avatar-edit"><${Icon} name="camera" size=${16} /></span>
      </button>
      <div class="profile-id">
        <div class="profile-name">${f.name || 'Hồ sơ sinh viên'}</div>
        <div class="muted small">${f.klass || 'Chưa có lớp'} · ${f.code || 'Chưa có MSSV'}</div>
      </div>
    </section>

    <section class="card stack">
      <h3 class="card-title">Thông tin cá nhân</h3>
      <${Field} label="Tên hiển thị"><input class="input" value=${f.name} onInput=${set('name')} /><//>
      <${Field} label="Email"><input class="input" type="email" value=${f.email} onInput=${set('email')} /><//>
      <div class="row gap">
        <${Field} label="Mã sinh viên"><input class="input" value=${f.code} onInput=${set('code')} /><//>
        <${Field} label="Lớp"><input class="input" value=${f.klass} onInput=${set('klass')} placeholder="VD: 23T_DT1" /><//>
      </div>
      <button class="btn btn-primary btn-block btn-lg" disabled=${!changed || saving} onClick=${save}>
        ${saving ? html`<${Spinner} size=${18} />` : 'Lưu thay đổi'}</button>
    </section>

    <section class="card settings">
      <h3 class="card-title">Cài đặt</h3>
      <label class="setting">
        <span class="list-icon violet"><${Icon} name=${dark ? 'moon' : 'sun'} /></span>
        <span class="grow"><b>Giao diện tối</b><br /><span class="muted small">${dark ? 'Đang dùng giao diện tối' : 'Đang dùng giao diện sáng'}</span></span>
        <input type="checkbox" class="switch" checked=${dark} onChange=${(e) => saveTheme(e.target.checked ? 'dark' : 'light')} />
      </label>
      <${PushSetting} />
      <button class="setting" onClick=${() => navigate('/achievements')}><span class="list-icon amber"><${Icon} name="trophy" /></span><span class="grow"><b>Thành tích</b></span><${Icon} name="chevron" size=${18} /></button>
      <button class="setting" onClick=${() => navigate('/about')}><span class="list-icon blue"><${Icon} name="info" /></span><span class="grow"><b>Liên hệ & Giới thiệu</b></span><${Icon} name="chevron" size=${18} /></button>
      <button class="setting" onClick=${changePassword}><span class="list-icon green"><${Icon} name="key" /></span><span class="grow"><b>Đổi mật khẩu</b></span><${Icon} name="chevron" size=${18} /></button>
      <button class="setting" onClick=${logout}><span class="list-icon gray"><${Icon} name="logout" /></span><span class="grow"><b>Đăng xuất</b></span></button>
      <button class="setting danger" onClick=${deleteAccount} disabled=${saving}><span class="list-icon red"><${Icon} name="trash" /></span><span class="grow"><b>Xóa tài khoản</b></span></button>
    </section>
  </div>`;
}
