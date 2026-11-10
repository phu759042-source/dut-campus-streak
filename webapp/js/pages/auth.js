import { html, useState } from 'preact';
import { supabase, errMsg, ensureCurrentUserData, appStore } from '../lib.js';
import { Icon, IconInput, PasswordInput, Spinner, toast } from '../ui.js';
import { navigate } from '../router.js';
import { InstallButton } from '../install.js';

function AuthShell({ title, subtitle, children }) {
  return html`<div class="auth">
    <div class="auth-bg">
      <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
      <div class="auth-grid"></div>
    </div>
    <div class="auth-install"><${InstallButton} variant="light" /></div>
    <div class="auth-card pop-in">
      <div class="auth-brand">
        <img class="brand-mark" src="/icon-192.png" alt="" width="56" height="56" />
        <div>
          <div class="brand-name">DUT Campus Streak</div>
          <div class="brand-tag">Đi học đều, giữ lửa streak</div>
        </div>
      </div>
      <h1 class="auth-title">${title}</h1>
      ${subtitle && html`<p class="muted auth-sub">${subtitle}</p>`}
      ${children}
    </div>
  </div>`;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Vui lòng nhập email và mật khẩu.');
    setLoading(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) { setLoading(false); return setError(errMsg(err)); }
    navigate('/', { replace: true });
  }

  return html`<${AuthShell} title="Chào mừng trở lại 👋" subtitle="Đăng nhập để tiếp tục chuỗi check-in của bạn.">
    <form class="stack" onSubmit=${submit}>
      <${IconInput} icon="mail" type="email" autocomplete="email" placeholder="Email" value=${email}
        onInput=${(e) => setEmail(e.target.value)} />
      <${PasswordInput} autocomplete="current-password" placeholder="Mật khẩu" value=${password}
        onInput=${(e) => setPassword(e.target.value)} />
      <div class="row-end"><a class="link" href="/forgot" onClick=${(e) => { e.preventDefault(); navigate('/forgot'); }}>Quên mật khẩu?</a></div>
      ${error && html`<div class="form-error shake">${error}</div>`}
      <button class="btn btn-primary btn-lg btn-block" disabled=${loading}>
        ${loading ? html`<${Spinner} size=${18} />` : 'Đăng nhập'}
      </button>
    </form>
    <div class="auth-foot">Chưa có tài khoản? <a class="link strong" href="/register" onClick=${(e) => { e.preventDefault(); navigate('/register'); }}>Đăng ký</a></div>
    <div class="auth-foot">Tân sinh viên? <a class="link strong" href="/map" onClick=${(e) => { e.preventDefault(); navigate('/map'); }}>Khám phá bản đồ trường 3D</a></div>
  <//>`;
}

export function RegisterPage() {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!f.email.trim() || !f.password || !f.name.trim()) return setError('Vui lòng nhập đầy đủ thông tin.');
    if (f.password.length < 6) return setError('Mật khẩu phải có ít nhất 6 ký tự.');
    if (f.password !== f.confirm) return setError('Mật khẩu xác nhận không khớp.');
    setLoading(true); setError(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: { emailRedirectTo: `${location.origin}/`, data: { display_name: f.name.trim() } },
    });
    if (err) { setLoading(false); return setError(errMsg(err)); }
    if (!data.session) {
      toast('Tài khoản đã tạo. Hãy kiểm tra email để xác nhận, sau đó đăng nhập.', 'success', 6000);
      return navigate('/login', { replace: true });
    }
    try { await ensureCurrentUserData(f.name.trim()); } catch (e2) { console.warn(e2); }
    navigate('/', { replace: true });
  }

  return html`<${AuthShell} title="Tạo tài khoản" subtitle="Vài giây thôi, rồi bắt đầu streak đầu tiên.">
    <form class="stack" onSubmit=${submit}>
      <${IconInput} icon="user" placeholder="Tên hiển thị" value=${f.name} onInput=${set('name')} autocomplete="nickname" />
      <${IconInput} icon="mail" type="email" placeholder="Email" value=${f.email} onInput=${set('email')} autocomplete="email" />
      <${PasswordInput} placeholder="Mật khẩu (ít nhất 6 ký tự)" value=${f.password} onInput=${set('password')} autocomplete="new-password" />
      <${PasswordInput} placeholder="Nhập lại mật khẩu" value=${f.confirm} onInput=${set('confirm')} autocomplete="new-password" />
      ${error && html`<div class="form-error shake">${error}</div>`}
      <button class="btn btn-primary btn-lg btn-block" disabled=${loading}>
        ${loading ? html`<${Spinner} size=${18} />` : 'Đăng ký'}
      </button>
    </form>
    <div class="auth-foot">Đã có tài khoản? <a class="link strong" href="/login" onClick=${(e) => { e.preventDefault(); navigate('/login'); }}>Đăng nhập</a></div>
  <//>`;
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Vui lòng nhập email đã đăng ký.');
    setLoading(true); setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset` });
    setLoading(false);
    if (err) return setError(errMsg(err));
    setSent(true);
  }

  return html`<${AuthShell} title="Quên mật khẩu" subtitle="Nhập email, mình sẽ gửi liên kết đặt lại mật khẩu.">
    ${sent ? html`<div class="success-box pop-in"><${Icon} name="mail" /> <span>Đã gửi email tới <b>${email}</b>. Mở liên kết trong email trên thiết bị này để đặt mật khẩu mới.</span></div>`
      : html`<form class="stack" onSubmit=${submit}>
        <${IconInput} icon="mail" type="email" placeholder="Email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
        ${error && html`<div class="form-error shake">${error}</div>`}
        <button class="btn btn-primary btn-lg btn-block" disabled=${loading}>${loading ? html`<${Spinner} size=${18} />` : 'Gửi liên kết'}</button>
      </form>`}
    <div class="auth-foot"><a class="link strong" href="/login" onClick=${(e) => { e.preventDefault(); navigate('/login'); }}>← Quay lại đăng nhập</a></div>
  <//>`;
}

export function ResetPasswordPage() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasSession = !!appStore.get().session;

  async function submit(e) {
    e.preventDefault();
    if (pw.length < 6) return setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
    if (pw !== confirm) return setError('Mật khẩu xác nhận không khớp.');
    setLoading(true); setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) { setLoading(false); return setError(errMsg(err)); }
    await supabase.auth.signOut();
    appStore.set({ recovery: false });
    toast('Đã đổi mật khẩu. Hãy đăng nhập lại.', 'success');
    navigate('/login', { replace: true });
  }

  return html`<${AuthShell} title="Đặt mật khẩu mới">
    ${!hasSession ? html`<div class="form-error">Liên kết đã hết hạn hoặc không hợp lệ. Hãy yêu cầu gửi lại.</div>
      <div class="auth-foot"><a class="link strong" href="/forgot" onClick=${(e) => { e.preventDefault(); navigate('/forgot'); }}>Gửi lại liên kết</a></div>`
    : html`<form class="stack" onSubmit=${submit}>
      <${PasswordInput} placeholder="Mật khẩu mới" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
      <${PasswordInput} placeholder="Nhập lại mật khẩu mới" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} autocomplete="new-password" />
      ${error && html`<div class="form-error shake">${error}</div>`}
      <button class="btn btn-primary btn-lg btn-block" disabled=${loading}>${loading ? html`<${Spinner} size=${18} />` : 'Cập nhật mật khẩu'}</button>
    </form>`}
  <//>`;
}
