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

// school student mail (Outlook on the university's own domain) often files our confirmation mail as junk
const SCHOOL_MAIL = /@sv1\.dut\.udn\.vn$/i;
const SIGNUP_KEY = 'cs-signup-email';

function takeSignupEmail() {
  try { const v = sessionStorage.getItem(SIGNUP_KEY) || ''; sessionStorage.removeItem(SIGNUP_KEY); return v; } catch { return ''; }
}

function SignupMailNote({ email }) {
  const school = SCHOOL_MAIL.test(email);
  const [state, setState] = useState('idle'); // idle | busy | sent | error
  const [msg, setMsg] = useState('');
  async function resend() {
    setState('busy');
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${location.origin}/` } });
    if (error) { setState('error'); setMsg(errMsg(error)); return; }
    setState('sent');
  }
  return html`<div class="note school-mail pop-in">
    <${Icon} name="info" />
    <div class="stack-sm">
      <b>${school ? 'Lưu ý cho email sinh viên @sv1.dut.udn.vn' : 'Chưa nhận được email xác nhận?'}</b>
      ${school ? html`<span>Đây là email sinh viên thuộc tên miền riêng của trường, có thể chịu chính sách lọc thư khác với tài khoản Outlook cá nhân thông thường. Nếu chưa thấy thư xác nhận ở Hộp thư đến, hãy kiểm tra thư mục <b>Rác (Junk Email)</b>.</span>`
        : html`<span>Thư có thể mất vài phút mới tới. Nếu chưa thấy ở Hộp thư đến, hãy xem thêm thư mục Spam/Thư rác.</span>`}
      <span>Trường hợp vẫn không nhận được email, hãy kiểm tra lại địa chỉ <b>${email}</b> đã đúng chưa, hoặc bấm gửi lại.</span>
      <div>
        ${state === 'sent' ? html`<span class="school-mail-ok">Đã gửi lại email xác nhận ✓</span>`
          : html`<button type="button" class="btn btn-sm btn-ghost" disabled=${state === 'busy'} onClick=${resend}>${state === 'busy' ? html`<${Spinner} size=${14} />` : 'Gửi lại email xác nhận'}</button>`}
        ${state === 'error' && html`<div class="school-mail-err">${msg}</div>`}
      </div>
    </div>
  </div>`;
}

export function LoginPage() {
  const [signupEmail] = useState(takeSignupEmail);
  const [email, setEmail] = useState(signupEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Vui lòng nhập email và mật khẩu.');
    setLoading(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) { setLoading(false); return setError(errMsg(err)); }
    let next = '/';
    try { next = sessionStorage.getItem('cs-after-login') || '/'; sessionStorage.removeItem('cs-after-login'); } catch { /* storage off */ }
    navigate(next.startsWith('/map') ? next : '/', { replace: true });
  }

  return html`<${AuthShell} title="Chào mừng trở lại 👋" subtitle="Đăng nhập để tiếp tục chuỗi check-in của bạn.">
    ${signupEmail && html`<${SignupMailNote} email=${signupEmail} />`}
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
    // Supabase does not say "already registered" for an email that is registered and confirmed (so nobody can probe
    // which emails have accounts); it answers with a stand-in user that has no identities and sends no mail.
    if (data.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setLoading(false);
      return setError(html`<span>Email này đã được đăng ký và xác nhận rồi. Hãy <a class="link strong" href="/login" onClick=${(ev) => { ev.preventDefault(); navigate('/login'); }}>đăng nhập</a>, hoặc dùng <a class="link strong" href="/forgot" onClick=${(ev) => { ev.preventDefault(); navigate('/forgot'); }}>Quên mật khẩu</a> nếu không nhớ mật khẩu.</span>`);
    }
    if (!data.session) {
      toast('Tài khoản đã tạo. Hãy kiểm tra email để xác nhận, sau đó đăng nhập.', 'success', 6000);
      try { sessionStorage.setItem(SIGNUP_KEY, f.email.trim()); } catch { /* storage off */ }
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
    await supabase.auth.signOut({ scope: 'global' }); // a new password logs every device out (on purpose)
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
