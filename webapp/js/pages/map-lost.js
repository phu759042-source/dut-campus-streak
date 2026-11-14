// UI of the "Đồ thất lạc" event in server mode (see ../lost-core.js): the merit chip and panel (what is lost where,
// the merit leaderboard), the pick-up button, and the show when you pick something up: a phone photo of it, then
// the post on the (in-game) confession page asking the owner to come and get it, and the merit points.
import { html, useState, useEffect, useRef } from 'preact';
import { Icon } from '../ui.js';
import { ITEM, ZONES, SPOTS, placeOf } from '../lost-core.js';

export const SLOGAN = 'Nam 1 lốc Sting, nữ 1 hôn lốc xoáy kiểu Pháp 💋';
// where "Tới đó" takes you in each place: [spot, look at]
const ZONE_GO = [[[55.6, -238.4], [30, -232]], [[2.0, 122.4], [-5.6, 135]], [[-100.8, 49.3], [-98.6, 42.7]]];
const ZONE_ICON = ['🛵', '🛵', '🏫'];

const pick = (list, r = Math.random()) => list[Math.floor(r * list.length) % list.length];
const OPENERS = ['Ai làm rơi', 'Có bạn nào để quên', 'Bạn nào đánh rơi', 'Tìm chủ nhân của'];
const ASKS = [
  'Chủ nhân ơi về đi, em nó nhớ bạn lắm rồi 🥺',
  'Ai nhận thì ib page nha, nhận xong nhớ khao mình ly trà đá 🧋',
  'Mất đồ không đáng sợ, đáng sợ là quên luôn mình để ở đâu 🫠',
  'Đồ thì tìm được chủ rồi, còn mình thì chưa 💔',
  'Cầm giùm nãy giờ run tay quá, chủ nhân lên tiếng với 😭',
  'Ai biết chủ nhân thì tag vào giúp mình với ạ 🙏',
];
const PEOPLE = ['Minh Anh', 'Quốc Bảo', 'Thu Hà', 'Đức Huy', 'Lan Chi', 'Gia Bảo', 'Ngọc Trâm', 'Hoàng Nam', 'Bảo Ngọc', 'Tuấn Kiệt'];
const COMMENTS = [
  'Ủa của mình nè 😭 cảm ơn bạn nhiều lắm',
  'Người tốt việc tốt, công đức vô lượng 🙏',
  'Nam 1 lốc Sting thì được chứ nữ thì… 🫣',
  'Lốc xoáy kiểu Pháp là sao ạ 🤣',
  'Tuần này lần thứ 3 rồi đó, ai mà hay quên dữ',
  'Hóng chủ nhân 👀',
  'Cho mình xin in4 người nhặt với, muốn làm quen 😳',
  '@{p} của mày kìa, suốt ngày để quên',
  'Bách khoa ít người giàu nhưng nhiều người tốt 🥹',
  'Admin duyệt bài nhanh ghê',
];

/** Text of the confession post for thing k found on spot s. */
export function confessionText(k, s, cfs) {
  const it = ITEM[k];
  const ask = Math.random() < 0.65 ? `👉 Phí chuộc: ${SLOGAN}` : pick(ASKS);
  return `#cfs${cfs} [TÌM CHỦ NHÂN 🔍]\n${pick(OPENERS)} ${it.name.charAt(0).toLowerCase() + it.name.slice(1)} ở ${placeOf(s)} không ạ 😭 `
    + `Nhận dạng: ${it.desc}. Mình đang giữ giùm, chủ nhân liên hệ page để nhận lại nha.\n${ask}`;
}

/** Chip in the server bar: your merit points. */
export function LostChip({ me, open, onOpen }) {
  return html`<button class=${'world-chip lf-chip' + (open ? ' on' : '')} title="Sự kiện Đồ thất lạc: điểm công đức" onClick=${onOpen}>
    <span>🙏</span><span><b>${me?.pts ?? 0}</b><span class="world-chip-long"> công đức</span></span></button>`;
}

/** The button when a lost thing is within reach. */
export function LostPick({ k, mobile, onPick }) {
  const it = ITEM[k];
  if (!it) return null;
  return html`<button class="world-ride lf-pick pop-in" onClick=${(e) => { e.currentTarget.blur(); onPick(); }}>
    <span>📸 Nhặt <b>${it.short}</b> · đăng confession</span>${!mobile && html`<span class="map-near-key">E</span>`}</button>`;
}

/** Panel: rules, what is lost where, the leaderboard. */
export function LostPanel({ items, me, top, myId, onGo, onClose }) {
  const byZone = ZONES.map(() => []);
  for (const [k, s] of items) if (SPOTS[s]) byZone[SPOTS[s][4]].push(k);
  return html`<div class="world-panel lf-panel pop-in">
    <div class="world-panel-head"><b>🔍 Đồ thất lạc</b><button class="icon-btn" aria-label="Đóng" onClick=${onClose}><${Icon} name="x" size=${18} /></button></div>
    <p class="small lf-rules">Sinh viên Bách khoa lại để quên đồ khắp nơi! Tìm dấu <b>✨</b> ở nhà xe khu E, nhà xe khu B và các phòng học khu H.
      Ai tới trước thì nhặt được (<b>E</b> hoặc nút 📸), đăng confession tìm chủ và nhận <b>điểm công đức</b>. Nhặt xong, món đồ sẽ lại bị ai đó làm rơi ở chỗ khác.</p>
    <div class="lf-zones">${ZONES.map((z, i) => html`<div class="lf-zone">
      <span class="lf-zone-ico">${ZONE_ICON[i]}</span>
      <span class="grow"><b>${z}</b><span class="muted small world-block">${byZone[i].length ? byZone[i].map((k) => ITEM[k].short).join(', ') : 'Chưa có gì, chờ chút…'}</span></span>
      <span class="lf-count">${byZone[i].length}</span>
      <button class="btn btn-ghost btn-sm" onClick=${() => onGo(ZONE_GO[i])}>Tới đó</button>
    </div>`)}</div>
    <div class="lf-board-head"><b>🙏 Bảng công đức</b>${me && me.n > 0 && html`<span class="muted small">Bạn: hạng #${me.rank} · ${me.pts} điểm · ${me.n} món</span>`}</div>
    ${!top ? html`<p class="muted small">Đang tải…</p>` : !top.length ? html`<p class="muted small">Chưa ai nhặt được gì. Người đầu tiên là bạn?</p>`
      : html`<ol class="lf-board">${top.map((r, i) => html`<li class=${r.id === myId ? 'me' : ''}>
        <span class="lf-rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><span class="grow">${r.name}</span><span class="muted small">${r.n} món</span><b>${r.pts}</b></li>`)}</ol>`}
  </div>`;
}

/** Counts up to `to` over `ms` once shown. */
function useCount(to, ms, start) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const f = () => { const t = Math.min(1, (performance.now() - t0) / ms); setV(Math.round(to * (1 - (1 - t) ** 3))); if (t < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [start]);
  return v;
}

/**
 * The show after you picked something up. show = { k, s, cfs, pts, photo: Promise<data URL> }:
 * the phone camera with the photo, the shutter and flash, "sending to the admin", then the confession post with
 * reactions and comments coming in, and "Công đức +pts".
 */
export function ConfessionShow({ show, onClose }) {
  const it = ITEM[show.k];
  const [stage, setStage] = useState('cam'); // cam -> flash -> send -> post
  const [img, setImg] = useState(null);
  const [nCom, setNCom] = useState(0);
  const fixed = useRef(null);
  if (!fixed.current) {
    const names = [...PEOPLE].sort(() => Math.random() - 0.5);
    const lines = [...COMMENTS].sort(() => Math.random() - 0.5).slice(0, 3);
    fixed.current = {
      text: confessionText(show.k, show.s, show.cfs),
      likes: 120 + Math.floor(Math.random() * 780),
      comments: lines.map((t, i) => ({ n: names[i], t: t.replace('{p}', names[i + 4]) })),
    };
  }
  const { text, comments } = fixed.current;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    let alive = true;
    const timers = [], t0 = performance.now();
    const at = (ms, f) => timers.push(setTimeout(() => { if (alive) f(); }, ms));
    const go = (u) => {
      if (!alive) return;
      setImg(u || null);
      const w = Math.max(0, 1100 - (performance.now() - t0));
      at(w, () => setStage('flash'));
      at(w + 420, () => setStage('send'));
      at(w + 1600, () => setStage('post'));
      at(w + 2700, () => setNCom(1)); at(w + 3900, () => setNCom(2)); at(w + 5200, () => setNCom(3));
      at(w + 26000, () => close.current());
    };
    Promise.resolve(show.photo).then(go, () => go(null));
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close.current(); } };
    addEventListener('keydown', onKey, true);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => { alive = false; timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); };
  }, []);
  const posted = stage === 'post';
  const likes = useCount(fixed.current.likes, 2600, posted);
  return html`<div class="cfs-show" role="dialog" aria-label="Đăng confession tìm chủ nhân" onClick=${(e) => { if (e.target === e.currentTarget && posted) onClose(); }}>
    ${!posted && html`<div class="cfs-cam pop-in">
      <div class="cfs-cam-top"><span>⚡ Tự động</span><b>ẢNH</b><span>HDR</span></div>
      <div class="cfs-cam-view">
        ${img ? html`<img src=${img} alt=${it.name} />` : html`<div class="cfs-cam-wait"></div>`}
        <span class="cfs-focus"></span>
        <span class="cfs-cam-hint">${it.name}</span>
      </div>
      <div class="cfs-cam-bar"><span class=${'cfs-shutter' + (stage !== 'cam' ? ' shot' : '')}></span></div>
      ${stage === 'flash' && html`<div class="cfs-flash"></div>`}
      ${stage === 'send' && html`<div class="cfs-sending pop-in"><b>📮 Đang gửi confession cho admin duyệt…</b><span class="cfs-bar"><i></i></span></div>`}
    </div>`}
    ${posted && html`<div class="cfs-post slide-up">
      <div class="cfs-head"><span class="cfs-avatar">CFS</span>
        <span class="grow"><b>Campus Confession</b><span class="small muted world-block">Vừa xong · người gửi ẩn danh · 🌏</span></span><span class="muted">•••</span></div>
      <div class="cfs-text">${text.split('\n').map((l, i) => html`<p class=${i === 0 ? 'cfs-tag' : l.includes(SLOGAN) ? 'cfs-slogan' : ''}>${l}</p>`)}</div>
      ${img && html`<img class="cfs-photo" src=${img} alt=${'Ảnh ' + it.name} />`}
      <div class="cfs-react"><span><span class="cfs-emo">👍</span><span class="cfs-emo">❤️</span><span class="cfs-emo">😆</span> ${likes}</span>
        <span class="muted small">${Math.round(likes / 8)} bình luận · ${Math.round(likes / 21)} lượt chia sẻ</span></div>
      <div class="cfs-actions"><span>👍 Thích</span><span>💬 Bình luận</span><span>↗ Chia sẻ</span></div>
      <div class="cfs-comments">${comments.slice(0, nCom).map((c) => html`<div class="cfs-cmt pop-in" key=${c.n}>
        <span class="cfs-cmt-av">${c.n.split(' ').pop().charAt(0)}</span><span class="cfs-cmt-body"><b>${c.n}</b>${c.t}</span></div>`)}</div>
      <button class="btn btn-primary cfs-close" onClick=${onClose}>Tiếp tục tìm đồ</button>
    </div>`}
    ${posted && html`<div class="cfs-merit" aria-live="polite">🙏 Công đức +${show.pts}</div>`}
  </div>`;
}
