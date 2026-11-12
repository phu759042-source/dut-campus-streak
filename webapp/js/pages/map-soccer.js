// Football UI in server mode of the 3D campus map: scoreboard, goal / full-time banners, shot power and stamina,
// the buttons on phones, the team panel, and the notice that tells students elsewhere on the campus a match has
// started (so they can come and watch from the stands). The game itself is in js/soccer.js.
import { html } from 'preact';
import { Icon } from '../ui.js';
import { TEAM_NAMES, TEAM_SIZE } from '../soccer-core.js';

export const TEAM_CSS = ['#2563eb', '#f97316'];
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const secs = (ms) => Math.max(0, Math.ceil(ms / 1000));
const CLOCK = ['kick', 'play', 'goal', 'wait', 'end'];
const HOW = { v: 'bằng cú vô lê', h: 'bằng cú đánh đầu', b: 'bằng cú xe đạp chổng ngược', l: 'bằng cú lốp bóng' };
const HOW_SHORT = { v: 'vô lê', h: 'đánh đầu', b: 'xe đạp chổng ngược' };

/** One line about where the match is at. */
export function soccerStatus(v) {
  const a = v.teams[0].length, b = v.teams[1].length;
  switch (v.st) {
    case 'idle': return 'Chưa có ai đá. Vào một đội để bắt đầu!';
    case 'warm': return a && b ? 'Khởi động' : `Khởi động · chờ người vào đội ${TEAM_NAMES[a ? 1 : 0]}`;
    case 'count': return `Trận đấu bắt đầu sau ${secs(v.left)} giây`;
    case 'kick': return `Giao bóng sau ${secs(v.left)}…`;
    case 'play': return 'Đang đá';
    case 'goal': return 'Bàn thắng!';
    case 'wait': return `Tạm dừng · chờ người vào đội ${TEAM_NAMES[a ? 1 : 0]} (${secs(v.left)} giây)`;
    case 'end': return v.score[0] === v.score[1] ? `Hết giờ · Hòa ${v.score[0]}–${v.score[1]}` : `Hết giờ · Đội ${TEAM_NAMES[v.score[0] > v.score[1] ? 0 : 1]} thắng`;
    default: return '';
  }
}

function Score({ v }) {
  return html`<span class="soc-team" style=${`--c:${TEAM_CSS[0]}`}>${TEAM_NAMES[0]}</span>
    <b class="soc-score">${v.score[0]}<i>–</i>${v.score[1]}</b>
    <span class="soc-team" style=${`--c:${TEAM_CSS[1]}`}>${TEAM_NAMES[1]}</span>`;
}

/** Small live score for the world bar while a match is on (opens the football panel). */
export function SoccerChip({ v, onOpen, open }) {
  if (!v || v.st === 'idle') return html`<button class=${'map-btn sm' + (open ? ' on' : '')} title="Bóng đá ở sân vận động" aria-label="Bóng đá" onClick=${onOpen}>⚽</button>`;
  return html`<button class=${'world-chip soc-chip' + (open ? ' on' : '')} onClick=${onOpen} title="Bóng đá ở sân vận động">
    ⚽ ${CLOCK.includes(v.st) ? html`<b>${v.score[0]}–${v.score[1]}</b><span class="world-chip-long">${v.st === 'end' ? 'Hết giờ' : mmss(v.clock)}</span>` : html`<span>${v.teams[0].length + v.teams[1].length} đang chơi</span>`}
  </button>`;
}

/** Whether the scoreboard is up (it takes the place of the search box). */
export const showBoard = (v) => !!v && (v.myTeam >= 0 || (v.near && v.st !== 'idle'));

/** Everything football shows over the map: scoreboard, banners, meters, phone buttons, notices. */
export function SoccerHud({ v, soccer, mobile, onOpen }) {
  if (!v) return null;
  const inTeam = v.myTeam >= 0, b = v.banner;
  const board = showBoard(v);
  const status = soccerStatus(v);
  return html`
    ${board && html`<div class="soc-board">
      <div class="soc-row"><${Score} v=${v} /><span class="soc-clock">${CLOCK.includes(v.st) ? mmss(v.clock) : '--:--'}</span></div>
      ${v.st !== 'play' && status && html`<div class="soc-status">${status}</div>`}
    </div>`}

    ${b && b.kind === 'goal' && (b.near || inTeam) && html`<div class="soc-banner" key=${'g' + b.until} style=${`--c:${TEAM_CSS[b.team]}`}>
      <b>VÀOOO!</b>
      <span>${b.own ? `${b.name || 'Ai đó'} đá phản lưới nhà` : `${b.name || 'Ai đó'} ghi bàn ${HOW[b.how] ? HOW[b.how] + ' ' : ''}cho đội ${TEAM_NAMES[b.team]}`}</span>
      ${b.score && html`<span class="soc-banner-score">${TEAM_NAMES[0]} ${b.score[0]} – ${b.score[1]} ${TEAM_NAMES[1]}</span>`}
    </div>`}
    ${b && b.kind === 'goal' && !b.near && !inTeam && html`<div class="soc-ticker pop-in" key=${'t' + b.until} onClick=${onOpen}>⚽ <b>${b.name || 'Ai đó'}</b> ghi bàn · ${TEAM_NAMES[0]} ${b.score?.[0]}–${b.score?.[1]} ${TEAM_NAMES[1]}</div>`}
    ${b && b.kind === 'practice' && (v.near || inTeam) && html`<div class="soc-ticker pop-in" key=${'p' + b.until}>⚽ ${b.name ? `${b.name} sút tung lưới` : 'Vào lưới'} · khởi động nên chưa tính điểm</div>`}
    ${b && b.kind === 'final' && (v.near || inTeam) && html`<div class="soc-banner final" key=${'f' + b.until}>
      <b>HẾT GIỜ</b>
      <span>${b.score[0] === b.score[1] ? 'Hai đội hòa nhau' : `Đội ${TEAM_NAMES[b.score[0] > b.score[1] ? 0 : 1]} thắng`}</span>
      <span class="soc-banner-score">${TEAM_NAMES[0]} ${b.score[0]} – ${b.score[1]} ${TEAM_NAMES[1]}</span>
      ${v.goals.length > 0 && html`<span class="soc-banner-goals">${v.goals.map((g) => `⚽ ${g.name}${g.own ? ' (phản lưới)' : HOW_SHORT[g.how] ? ` (${HOW_SHORT[g.how]})` : ''} ${Math.floor(g.ms / 60000) + 1}'`).join('   ')}</span>`}
    </div>`}
    ${v.flash && html`<div class="soc-ticker warn pop-in">${v.flash.text}</div>`}

    ${inTeam && html`<div class=${'soc-meters' + (mobile ? ' m' : '')}>
      ${v.armed && html`<div class="soc-armed">${v.armed === 'v' ? 'Vô lê' : 'Đánh đầu'}: chờ bóng tới…</div>`}
      ${v.power != null && html`<div class="soc-meter power"><span style=${`width:${Math.round(v.power * 100)}%`}></span><b>Lực sút</b></div>`}
      ${v.lob != null && html`<div class="soc-meter lob"><span style=${`width:${Math.round(v.lob * 100)}%`}></span><b>Chuyền cao</b></div>`}
      <div class=${'soc-meter stamina' + (v.tired ? ' tired' : '')}><span style=${`width:${Math.round(v.stamina * 100)}%`}></span><b>${v.tired ? 'Mệt, chờ hồi sức' : 'Thể lực'}</b></div>
    </div>`}
    ${inTeam && !mobile && html`<div class="soc-keys">
      <span><b>Chuột phải</b> giữ rồi thả: sút · <b>Chuột trái</b> bấm: chuyền thấp, giữ: chuyền cao · <b>E</b> xoạc · <b>Q</b> lừa bóng · <b>Shift</b> chạy nhanh</span>
      <span><b>Space</b> nhảy, trên không: <b>chuột phải</b> vô lê, <b>chuột trái</b> đánh đầu · giữ chuột rồi bấm <b>Space</b>: xe đạp chổng ngược</span>
    </div>`}
    ${inTeam && mobile && html`<div class="soc-pad">
      <button class="soc-btn tackle" aria-label="Xoạc bóng" onPointerDown=${(e) => { e.preventDefault(); soccer.tackle(); }}>Xoạc</button>
      <button class="soc-btn dribble" aria-label="Lừa bóng" onPointerDown=${(e) => { e.preventDefault(); soccer.dribble(); }}>Lừa</button>
      <button class="soc-btn jump" aria-label="Nhảy (giữ Sút hoặc Chuyền rồi bấm: xe đạp chổng ngược)" onPointerDown=${(e) => { e.preventDefault(); soccer.jump(); }}>Nhảy</button>
      ${[['pass', 'Chuyền', 'Chuyền (chạm: thấp, giữ: cao; trên không: đánh đầu)'], ['shoot', 'Sút', 'Sút (giữ lâu sút mạnh; trên không: vô lê)']].map(([k, label, aria]) => html`
        <button class=${'soc-btn ' + k} aria-label=${aria}
          onPointerDown=${(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browser */ } soccer.press(k); }}
          onPointerUp=${() => soccer.release(k)} onPointerCancel=${() => soccer.release(k)}>${label}</button>`)}
    </div>`}

    ${v.notice && !inTeam && html`<div class="soc-notice pop-in">
      <span class="soc-notice-ico">⚽</span>
      <span class="grow"><b>${v.notice.kind === 'start' ? 'Trận bóng vừa bắt đầu ở sân vận động!' : 'Đang có trận bóng ở sân vận động'}</b>
        <span class="muted small">${TEAM_NAMES[0]} ${v.teams[0].length} người · ${TEAM_NAMES[1]} ${v.teams[1].length} người · lên khán đài xem nhé</span></span>
      <span class="soc-notice-actions">
        <button class="btn btn-primary btn-sm" onClick=${() => soccer.watch()}>Đến xem</button>
        ${(v.teams[0].length < TEAM_SIZE || v.teams[1].length < TEAM_SIZE) && html`<button class="btn btn-ghost btn-sm" onClick=${() => { soccer.dismiss(); onOpen(); }}>Vào đá</button>`}
      </span>
      <button class="icon-btn" aria-label="Bỏ qua" onClick=${() => soccer.dismiss()}><${Icon} name="x" size=${16} /></button>
    </div>`}
    ${v.near && !inTeam && !v.notice && !board && html`<button class="soc-near pop-in" onClick=${onOpen}>⚽ <span>Sân bóng · <b>Vào đá</b></span></button>`}
  `;
}

/** Team lists, join / switch / leave, watch from the stands, and how to play. */
export function SoccerPanel({ v, soccer, me, nameOf, mobile, onClose }) {
  if (!v) return null;
  const full = (t) => v.teams[t].length >= TEAM_SIZE;
  return html`<div class="world-panel soc-panel pop-in">
    <div class="world-panel-head"><b>⚽ Bóng đá ở sân vận động</b><button class="icon-btn" aria-label="Đóng" onClick=${onClose}><${Icon} name="x" size=${18} /></button></div>
    <div class="soc-panel-score">
      ${CLOCK.includes(v.st) && html`<span class="soc-row"><${Score} v=${v} /><span class="soc-clock">${mmss(v.clock)}</span></span>`}
      <span class="muted small">${soccerStatus(v)}</span>
    </div>
    <div class="soc-teams">
      ${[0, 1].map((t) => html`<div class="soc-col" style=${`--c:${TEAM_CSS[t]}`}>
        <div class="soc-col-head"><span class="soc-dot"></span><b>Đội ${TEAM_NAMES[t]}</b><span class="muted small">${v.teams[t].length}/${TEAM_SIZE}</span></div>
        ${v.teams[t].length
          ? v.teams[t].map((id) => html`<div class=${'soc-player' + (id === me ? ' me' : '')}>${nameOf(id)}${id === me ? ' (bạn)' : ''}</div>`)
          : html`<div class="muted small">Chưa có ai</div>`}
        ${v.myTeam !== t && html`<button class="btn btn-sm soc-join" disabled=${full(t)} onClick=${() => { soccer.join(t); onClose(); }}>${full(t) ? 'Đã đủ người' : v.myTeam >= 0 ? 'Đổi sang đội này' : `Vào đội ${TEAM_NAMES[t]}`}</button>`}
      </div>`)}
    </div>
    <div class="world-card-actions">
      ${v.myTeam < 0 && !(full(0) && full(1)) && html`<button class="btn btn-primary btn-sm" onClick=${() => { soccer.join(-1); onClose(); }}>🎲 Ghép ngẫu nhiên</button>`}
      ${v.myTeam >= 0
        ? html`<button class="btn btn-ghost btn-sm" onClick=${() => soccer.leave()}>Rời đội</button>`
        : html`<button class="btn btn-ghost btn-sm" onClick=${() => { soccer.watch(); onClose(); }}>👀 Lên khán đài xem</button>`}
    </div>
    ${v.goals.length > 0 && html`<div class="soc-goals">${v.goals.map((g) => html`<div class="small"><span class="soc-dot" style=${`--c:${TEAM_CSS[g.team]}`}></span> ${g.name}${g.own ? ' (phản lưới)' : ''} · phút ${Math.floor(g.ms / 60000) + 1}</div>`)}</div>`}
    <div class="soc-help small">
      <b>Cách chơi.</b> Chạy vào bóng để dắt bóng. ${mobile
        ? html`Nút <b>Sút</b> (giữ lâu sút càng mạnh), <b>Chuyền</b> (chạm: chuyền thấp, giữ: chuyền cao), <b>Xoạc</b> cướp bóng, <b>Lừa</b> lừa bóng.
          Bấm <b>Nhảy</b> rồi bấm <b>Sút</b> để vô lê, bấm <b>Chuyền</b> để đánh đầu; giữ Sút hoặc Chuyền rồi bấm Nhảy: xe đạp chổng ngược. Đẩy cần điều khiển hết cỡ để chạy nhanh.`
        : html`<b>Chuột phải</b> giữ để lấy lực rồi thả để sút (bóng bay theo hướng camera), <b>chuột trái</b> bấm để chuyền thấp, giữ để chuyền cao,
          <b>E</b> xoạc cướp bóng, <b>Q</b> lừa bóng (lướt nhanh, người khác xoạc hụt), <b>Shift</b> chạy nhanh (tốn thể lực).
          <b>Space</b> để nhảy; trên không bấm <b>chuột phải</b> để vô lê, <b>chuột trái</b> để đánh đầu. Giữ chuột rồi bấm <b>Space</b>: xe đạp chổng ngược.`}${' '}
      Mỗi trận 5 phút, mỗi đội tối đa ${TEAM_SIZE} người, thủ môn do máy bắt. Người không đá có thể lên khán đài hai bên sân ngồi xem.
    </div>
  </div>`;
}
