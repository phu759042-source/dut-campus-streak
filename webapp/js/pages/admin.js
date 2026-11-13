// /admin: usage statistics for the site owner (accounts listed in the app_admins table). Everything comes from one
// RPC, admin_stats(p_days), which refuses anyone else. Charts are plain SVG bars with a hover tooltip.
import { html, useState, useEffect, useRef } from 'preact';
import { supabase, errMsg } from '../lib.js';
import { Icon, Skeleton, ErrorBox, Segmented } from '../ui.js';
import { PageHeader } from './shared.js';

// two-series palette (checked for colour-blind separation and contrast on light and dark surfaces)
const C1 = '#2f6bff', C2 = '#c96a12';
const nf = new Intl.NumberFormat('vi-VN');
const n = (v) => nf.format(Math.round(+v || 0));
const pct = (yes, of) => (of > 0 ? `${Math.round((100 * yes) / of)}%` : '–');
const dm = (d) => { const [, m, dd] = String(d).split('-'); return `${+dd}/${+m}`; };
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wd = (d) => WD[new Date(d + 'T00:00:00').getDay()];

/** Is the signed-in account an admin? (cached for the tab) */
let adminCache = null;
export function useIsAdmin() {
  const [ok, setOk] = useState(adminCache);
  useEffect(() => {
    if (adminCache !== null) return;
    supabase.rpc('is_admin').then(({ data }) => { adminCache = !!data; setOk(adminCache); }, () => setOk(false));
  }, []);
  return ok;
}

/**
 * Vertical bar chart. rows: [{ label, tip, values: [v1, v2?] }]; series: [{ name, color }] (stacked when 2).
 * Bars start at zero; a few light grid lines; hover (or tap) a column for its numbers.
 */
function BarChart({ rows, series, height = 220, every = 1, unit = '' }) {
  const box = useRef();
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(-1);
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const padL = 40, padR = 8, padT = 10, padB = 26;
  const plotW = Math.max(60, w - padL - padR), plotH = height - padT - padB;
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + (+b || 0), 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + plotH - (v / top) * plotH;
  const slot = plotW / Math.max(1, rows.length);
  const bw = Math.max(2, Math.min(36, slot * 0.72));
  const ev = Math.max(every, Math.ceil(38 / slot)); // keep axis labels from running into each other
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const h = hover >= 0 ? rows[hover] : null;
  return html`<div class="adm-chart" ref=${box} onMouseLeave=${() => setHover(-1)}>
    <svg width=${w} height=${height} role="img" aria-label=${series.map((s) => s.name).join(', ')}>
      ${ticks.map((v) => html`<g>
        <line x1=${padL} x2=${w - padR} y1=${y(v)} y2=${y(v)} class=${v === 0 ? 'adm-axis' : 'adm-grid'} />
        <text x=${padL - 6} y=${y(v) + 4} class="adm-tick" text-anchor="end">${n(v)}${unit}</text>
      </g>`)}
      ${rows.map((r, i) => {
        const cx = padL + slot * i + slot / 2;
        let base = 0;
        const parts = r.values.map((v, k) => {
          v = +v || 0;
          if (v <= 0) return null;
          const y0 = y(base), y1 = y(base + v);
          base += v;
          const topSeg = r.values.slice(k + 1).every((x) => !(+x > 0));
          const hh = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0)); // 2px gap between stacked parts
          return html`<path d=${barPath(cx - bw / 2, y1, bw, hh, topSeg ? Math.min(4, bw / 2, hh) : 0)} fill=${series[k].color} opacity=${hover < 0 || hover === i ? 1 : 0.45} />`;
        });
        return html`<g>
          ${parts}
          <rect x=${padL + slot * i} y=${padT} width=${slot} height=${plotH} fill="transparent" onMouseEnter=${() => setHover(i)} onClick=${() => setHover(i)} />
          ${(rows.length - 1 - i) % ev === 0 && html`<text x=${cx} y=${height - 8} class="adm-tick" text-anchor="middle">${r.label}</text>`}
        </g>`;
      })}
    </svg>
    ${h && html`<div class="adm-tip" style=${`left:${Math.min(w - 150, Math.max(0, padL + slot * hover + slot / 2 - 75))}px`}>
      <b>${h.tip || h.label}</b>
      ${series.map((s, k) => html`<div><span class="adm-dot" style=${`background:${s.color}`}></span>${s.name}: <b>${n(h.values[k])}${unit}</b></div>`)}
      ${series.length > 1 && html`<div class="muted">Tổng: <b>${n(h.values.reduce((a, b) => a + (+b || 0), 0))}${unit}</b></div>`}
    </div>`}
  </div>`;
}
function niceStep(raw) {
  if (raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
/** Bar with only the top corners rounded (anchored to the baseline). */
function barPath(x, y, w, h, r) {
  if (!r) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Legend({ series }) {
  if (series.length < 2) return null;
  return html`<div class="adm-legend">${series.map((s) => html`<span><span class="adm-dot" style=${`background:${s.color}`}></span>${s.name}</span>`)}</div>`;
}

function Tile({ label, value, sub, hint }) {
  return html`<div class="adm-tile" title=${hint || ''}>
    <div class="adm-tile-label">${label}</div>
    <div class="adm-tile-value">${value}</div>
    ${sub && html`<div class="adm-tile-sub">${sub}</div>`}
  </div>`;
}

function Card({ title, note, children }) {
  return html`<section class="card adm-card">
    <h3 class="card-title">${title}</h3>
    ${note && html`<p class="muted small adm-note">${note}</p>`}
    ${children}
  </section>`;
}

export function AdminPage() {
  const isAdmin = useIsAdmin();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setErr('');
    const { data: d, error } = await supabase.rpc('admin_stats', { p_days: days });
    setBusy(false);
    if (error) { setErr(errMsg(error)); return; }
    setData(d);
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, days]);

  if (isAdmin === false) return html`<div class="page narrow"><${PageHeader} title="Quản trị" />
    <div class="card"><b>Trang này chỉ dành cho quản trị viên.</b></div></div>`;

  const T = data?.totals, R = data?.retention, F = data?.features;
  const daily = data?.daily || [];
  const every = daily.length > 45 ? 7 : daily.length > 20 ? 3 : 1;
  const acc = T?.accounts || 0;
  const DEPTH = ['1 ngày', '2 ngày', '3–5 ngày', '6–10 ngày', '11+ ngày'];
  const depth = DEPTH.map((label, i) => ({ label, values: [(data?.depth || []).find((b) => b.k === i + 1)?.n || 0] }));
  const hours = Array.from({ length: 24 }, (_, hh) => ({ label: String(hh), tip: `${hh}:00 – ${hh}:59`, values: [(data?.hours || []).find((x) => x.hour === hh)?.n || 0] }));
  const feats = F ? [
    ['Nhập thời khoá biểu', F.timetable], ['Đã check-in', F.checkin_users], ['Bật thông báo', F.push_users],
    ['Tải tài liệu lên', F.doc_users], ['Tạo deadline', F.deadline_users],
  ] : [];

  return html`<div class="page adm">
    <${PageHeader} title="Quản trị · Thống kê" subtitle=${data ? `Số liệu đến hôm nay ${dm(data.today)} (giờ Việt Nam)` : 'Đang tải…'}
      actions=${html`<button class="icon-btn" aria-label="Tải lại" disabled=${busy} onClick=${load}><${Icon} name="refresh" /></button>`} />
    <div class="adm-filters">
      <${Segmented} value=${days} onChange=${setDays} options=${[{ value: 14, label: '14 ngày' }, { value: 30, label: '30 ngày' }, { value: 60, label: '60 ngày' }, { value: 90, label: '90 ngày' }]} />
    </div>
    ${err && html`<${ErrorBox} message=${err} onRetry=${load} />`}
    ${!data && !err && html`<${Skeleton} h=${110} count=${3} />`}
    ${data && html`
      <div class="adm-tiles">
        <${Tile} label="Tài khoản" value=${n(acc)} sub=${`+${n(T.signups_today)} hôm nay · +${n(T.signups_7d)} trong 7 ngày`} />
        <${Tile} label="Hoạt động hôm nay (DAU)" value=${n(T.dau)} sub=${`TB 7 ngày: ${nf.format(T.dau_avg7)}/ngày`} />
        <${Tile} label="Hoạt động 7 ngày (WAU)" value=${n(T.wau)} sub=${`30 ngày (MAU): ${n(T.mau)}`} />
        <${Tile} label="Độ gắn bó (DAU/MAU)" value=${pct(T.dau_avg7, T.mau)} sub="Trên 20% là tốt với app thường ngày" hint="Trung bình người hoạt động mỗi ngày (7 ngày gần nhất) chia cho số người hoạt động trong 30 ngày" />
        <${Tile} label="Có quay lại" value=${pct(R.returned.yes, R.returned.n)} sub=${`${n(R.returned.yes)}/${n(R.returned.n)} người dùng lại sau ngày đăng ký`} />
        <${Tile} label="Giữ chân ngày 1 (D1)" value=${pct(R.d1.yes, R.d1.n)} sub=${`Tuần 2 (D7): ${pct(R.d7.yes, R.d7.n)} · D30: ${pct(R.d30.yes, R.d30.n)}`} hint="D1: dùng lại đúng ngày hôm sau ngày đăng ký. D7: dùng lại trong ngày 7–13. D30: dùng lại từ ngày 30 trở đi" />
        <${Tile} label="Lượt mở bản đồ 3D" value=${n(T.map_views)} sub=${T.app_views ? `Lượt vào web: ${n(T.app_views)}` : 'Đếm từ 11/11'} />
        <${Tile} label="Đăng ký chưa xác nhận" value=${n(T.unconfirmed)} sub="Không nhận được / chưa bấm email xác nhận" />
      </div>

      <${Card} title="Người dùng hoạt động mỗi ngày" note="Mỗi tài khoản tính một lần mỗi ngày: người mới (đăng ký hôm đó) và người quay lại (đăng ký từ trước).">
        <${Legend} series=${[{ name: 'Quay lại', color: C1 }, { name: 'Mới đăng ký', color: C2 }]} />
        <${BarChart} every=${every} series=${[{ name: 'Quay lại', color: C1 }, { name: 'Mới đăng ký', color: C2 }]}
          rows=${daily.map((d) => ({ label: dm(d.day), tip: `${wd(d.day)} ${dm(d.day)}`, values: [d.returning, Math.max(0, d.active - d.returning)] }))} />
      <//>

      <div class="adm-grid2">
        <${Card} title="Đăng ký mới mỗi ngày">
          <${BarChart} every=${every} height=${200} series=${[{ name: 'Đăng ký', color: C1 }]}
            rows=${daily.map((d) => ({ label: dm(d.day), tip: `${wd(d.day)} ${dm(d.day)}`, values: [d.signups] }))} />
        <//>
        <${Card} title="Lượt mở bản đồ 3D mỗi ngày" note="Kể cả người chưa đăng nhập.">
          <${BarChart} every=${every} height=${200} series=${[{ name: 'Lượt mở', color: C1 }]}
            rows=${daily.map((d) => ({ label: dm(d.day), tip: `${wd(d.day)} ${dm(d.day)}`, values: [d.map] }))} />
        <//>
      </div>

      ${T.app_views > 0 && html`<${Card} title="Lượt vào web mỗi ngày" note="Mỗi lần mở web (một tab) tính một lượt, kể cả chưa đăng nhập.">
        <${BarChart} every=${every} height=${200} series=${[{ name: 'Lượt vào', color: C1 }]}
          rows=${daily.map((d) => ({ label: dm(d.day), tip: `${wd(d.day)} ${dm(d.day)}`, values: [d.app] }))} />
      <//>`}

      <div class="adm-grid2">
        <${Card} title="Giữ chân người dùng" note="Trong số người đã đăng ký đủ lâu, bao nhiêu phần trăm quay lại. Số trong ngoặc là số người được tính: nhóm nhỏ thì tỉ lệ chưa đáng tin.">
          <${BarChart} height=${200} unit="%" series=${[{ name: 'Tỉ lệ', color: C1 }]} rows=${[
            ['Có quay lại', R.returned], ['Ngày 1', R.d1], ['Tuần 2', R.d7], ['Sau 30 ngày', R.d30],
          ].map(([label, r]) => ({ label: `${label} (${n(r.n)})`, tip: `${label}: ${n(r.yes)}/${n(r.n)} người`, values: [r.n ? (100 * r.yes) / r.n : 0] }))} />
        <//>
        <${Card} title="Mỗi người đã dùng bao nhiêu ngày" note="Số ngày khác nhau mỗi tài khoản có mở app.">
          <${BarChart} height=${200} series=${[{ name: 'Tài khoản', color: C1 }]} rows=${depth} />
        <//>
      </div>

      <${Card} title="Giờ dùng nhiều nhất (30 ngày gần đây)" note="Số lần đăng nhập / làm mới phiên theo giờ Việt Nam: giờ nào nên đăng bài, chạy quảng cáo.">
        <${BarChart} height=${200} series=${[{ name: 'Lượt', color: C1 }]} rows=${hours} />
      <//>

      <div class="adm-grid2">
        <${Card} title="Tính năng được dùng" note=${`Phần trăm trên ${n(acc)} tài khoản.`}>
          <div class="adm-bars">${feats.map(([label, v]) => html`<div class="adm-hbar">
            <span class="adm-hbar-label">${label}</span>
            <span class="adm-hbar-track"><span style=${`width:${acc ? Math.max(1, (100 * v) / acc) : 0}%`}></span></span>
            <b>${n(v)}</b><span class="muted small">${pct(v, acc)}</span>
          </div>`)}</div>
          <p class="muted small adm-note adm-after">${n(F.checkins)} lượt check-in · ${n(F.docs)} tệp tài liệu · ${n(F.shares)} link chia sẻ (${n(F.share_views)} lượt xem)</p>
        <//>
        <${Card} title="Theo tuần đăng ký" note="Mỗi nhóm: số người đăng ký trong tuần, bao nhiêu người đã quay lại, bao nhiêu người còn dùng trong 7 ngày qua.">
          <div class="adm-table-wrap"><table class="adm-table">
            <thead><tr><th>Tuần từ</th><th>Đăng ký</th><th>Quay lại</th><th>Còn dùng</th></tr></thead>
            <tbody>${(data.cohorts || []).slice().reverse().map((c) => html`<tr>
              <td>${dm(c.week)}</td><td>${n(c.size)}</td><td>${n(c.returned)} <span class="muted">(${pct(c.returned, c.size)})</span></td><td>${n(c.active_now)} <span class="muted">(${pct(c.active_now, c.size)})</span></td>
            </tr>`)}</tbody>
          </table></div>
        <//>
      </div>

      <p class="muted small adm-note">Cách tính: "hoạt động" là ngày một tài khoản có mở app. ${T.tracked_since
        ? `Từ ${dm(T.tracked_since)} web ghi lại chính xác mỗi ngày; trước đó là ước tính từ phiên đăng nhập, check-in, tài liệu và deadline, nên có thể thấp hơn thực tế.`
        : 'Trước khi có bản ghi hằng ngày, số liệu được ước tính từ phiên đăng nhập, check-in, tài liệu và deadline, nên có thể thấp hơn thực tế.'}
        ${' '}Tài khoản chỉ tính khi đã xác nhận email.</p>
    `}
  </div>`;
}
