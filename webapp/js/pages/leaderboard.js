import { html, useState, useEffect, useRef } from 'preact';
import { supabase, currentUser, errMsg, hideStorageUrl } from '../lib.js';
import { Icon, Avatar, Skeleton, ErrorBox, Empty, Segmented, openSheet } from '../ui.js';
import { PageHeader } from './shared.js';
import { WORLD_HTTP } from '../world.js';
import { navigate } from '../router.js';

const PAGE_SIZE = 50;
const name = (r) => String(r.display_name || '').trim() || 'Sinh viên';
const cls = (r) => String(r.class_name || '').trim() || 'Chưa có lớp';
const num = (v) => Number(v) || 0;
// what each board ranks by: streak days, streak weeks, or merit points of the lost-and-found event on the 3D map
const SCORE = {
  daily: (r) => html`<b>${num(r.current_streak)}</b><small>ngày</small>`,
  weekly: (r) => html`<b>${num(r.weekly_streak)}</b><small>tuần</small>`,
  merit: (r) => html`<b>${num(r.pts)}</b><small>công đức</small>`,
};
const RANK_LABEL = { daily: 'Hạng ngày', weekly: 'Hạng tuần', merit: 'Hạng công đức' };

/** Merit leaderboard (from the world server), with the profile details of each student from Supabase. */
async function loadMerit() {
  const r = await fetch(`${WORLD_HTTP}/merit`, { cache: 'no-store' });
  if (!r.ok) throw new Error('máy chủ bản đồ chưa trả lời');
  const top = (await r.json()).top || [];
  const { data } = await supabase.rpc('get_leaderboard', { p_scope: 'all', p_class_name: null, p_metric: 'daily' });
  const byId = Object.fromEntries((data || []).map((p) => [p.user_id, p]));
  return top.map((t) => ({ ...(byId[t.id] || {}), user_id: t.id, display_name: byId[t.id]?.display_name || t.name, pts: t.pts, n: t.n, rank: null }));
}

function ProfileSheet({ row, rank, metric }) {
  const me = row.user_id === currentUser()?.id;
  return html`<div class="pcard">
    <div class="pcard-banner" style=${row.banner_url ? `background-image:url('${row.banner_url}')` : ''}></div>
    <div class="pcard-avatar"><${Avatar} url=${row.avatar_url} name=${name(row)} size=${88} ring /></div>
    <div class="pcard-body">
      <div class="pcard-name">${name(row)} ${me && html`<span class="chip chip-blue">Bạn</span>`}</div>
      <div class="muted">${cls(row)}</div>
      <div class="pcard-stats">
        <div><b>#${rank}</b><span>${RANK_LABEL[metric]}</span></div>
        ${metric === 'merit' && html`<div><b>🙏 ${num(row.pts)}</b><span>Công đức</span></div>`}
        <div><b>🔥 ${num(row.current_streak)}</b><span>Streak ngày</span></div>
        <div><b>📅 ${num(row.weekly_streak)}</b><span>Streak tuần</span></div>
        <div><b>${num(row.total_check_ins)}</b><span>Check-in</span></div>
      </div>
    </div>
  </div>`;
}

function Podium({ rows, metric, onOpen }) {
  const order = [rows[1], rows[0], rows[2]];
  const medal = ['🥈', '🥇', '🥉'];
  const place = [2, 1, 3];
  return html`<div class="podium">
    ${order.map((r, i) => r ? html`<button key=${r.user_id} class=${'podium-col p' + place[i]} style=${`--d:${i * 120}ms`} onClick=${() => onOpen(r)}>
      <div class="podium-avatar"><${Avatar} url=${r.avatar_url} name=${name(r)} size=${place[i] === 1 ? 76 : 60} ring />
        <span class="podium-medal">${medal[i]}</span></div>
      <div class="podium-name">${name(r)}</div>
      <div class="podium-score">${metric === 'merit' ? `🙏 ${num(r.pts)} công đức` : metric === 'weekly' ? `📅 ${num(r.weekly_streak)} tuần` : `🔥 ${num(r.current_streak)} ngày`}</div>
      <div class="podium-block" style=${r.banner_url ? `background-image:linear-gradient(180deg,transparent,rgba(0,0,0,.45)),url('${r.banner_url}')` : ''}>
        <span>${r.rank ?? place[i]}</span></div>
    </button>` : html`<div class="podium-col empty-col"></div>`)}
  </div>`;
}

export function LeaderboardPage() {
  const [metric, setMetric] = useState('daily');
  const [scope, setScope] = useState('all');
  const [classes, setClasses] = useState([]);
  const [klass, setKlass] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [highlight, setHighlight] = useState(null);
  const listRef = useRef();
  const me = currentUser()?.id;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('get_leaderboard', { p_scope: 'all', p_class_name: null, p_metric: 'daily' });
      const set = new Set();
      let mine = '';
      for (const r of data || []) {
        const v = String(r.class_name || '').trim();
        if (v) set.add(v);
        if (r.user_id === me) mine = v;
      }
      const sorted = [...set].sort((a, b) => a.localeCompare(b));
      setClasses(sorted);
      setKlass(sorted.includes(mine) ? mine : sorted[0] || null);
    })().catch((e) => console.warn(e));
  }, []);

  async function load() {
    setRows(null); setError(null); setHighlight(null);
    if (metric === 'merit') {
      let list;
      try { list = await loadMerit(); } catch (e) { return setError(errMsg(e)); }
      if (scope === 'class') list = list.filter((r) => cls(r) === klass);
      list.sort((a, b) => num(b.pts) - num(a.pts));
      list.forEach((r, i) => { r.rank = i && num(list[i - 1].pts) === num(r.pts) ? list[i - 1].rank : i + 1; });
      setRows(list); setPage(1);
      return;
    }
    const { data, error: err } = await supabase.rpc('get_leaderboard', {
      p_scope: scope, p_class_name: scope === 'class' ? klass : null, p_metric: metric,
    });
    if (err) return setError(errMsg(err));
    const list = (data || []).map((r) => ({ ...r }));
    const ids = list.map((r) => r.user_id).filter(Boolean);
    if (ids.length) {
      const { data: banners } = await supabase.rpc('get_public_profile_banners', { p_user_ids: ids });
      const byId = Object.fromEntries((banners || []).filter((b) => b.banner_url).map((b) => [b.user_id, b.banner_url]));
      list.forEach((r) => { r.banner_url = hideStorageUrl(byId[r.user_id] || null); });
    }
    const val = (r) => num(metric === 'weekly' ? r.weekly_streak : r.current_streak);
    list.sort((a, b) => (num(a.rank) - num(b.rank)) || (val(b) - val(a)) || (num(b.total_check_ins) - num(a.total_check_ins)) || name(a).localeCompare(name(b)));
    list.forEach((r, i) => { if (!r.rank) r.rank = i + 1; });
    setRows(list); setPage(1);
  }
  useEffect(() => { if (scope === 'all' || klass) load(); }, [metric, scope, klass]);

  const open = (r) => openSheet(() => html`<${ProfileSheet} row=${r} rank=${r.rank} metric=${metric} />`, { title: 'Hồ sơ' });

  function locateMe() {
    const idx = rows.findIndex((r) => r.user_id === me);
    if (idx < 0) return;
    const p = Math.floor(idx / PAGE_SIZE) + 1;
    setPage(p);
    setHighlight(me);
    setTimeout(() => document.getElementById('lb-' + me)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    setTimeout(() => setHighlight(null), 2600);
  }

  const totalPages = rows ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
  const myRow = rows?.find((r) => r.user_id === me);
  const pageRows = rows ? rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const listRows = page === 1 ? pageRows.slice(3) : pageRows;

  return html`<div class="page narrow">
    <${PageHeader} title="Xếp hạng" subtitle=${rows ? `${scope === 'class' ? klass || '' : 'Toàn trường'} · ${metric === 'merit' ? 'công đức (sự kiện Đồ thất lạc)' : metric === 'weekly' ? 'streak tuần' : 'streak ngày'} · ${rows.length} sinh viên` : ' '}
      actions=${rows && myRow && html`<button class="icon-btn" aria-label="Định vị tôi" title="Định vị tôi trên bảng xếp hạng" onClick=${locateMe}><${Icon} name="crosshair" /></button>`} />
    <div class="lb-filters">
      <${Segmented} value=${metric} onChange=${setMetric} options=${[{ value: 'daily', label: '🔥 Ngày' }, { value: 'weekly', label: '📅 Tuần' }, { value: 'merit', label: '🙏 Công đức' }]} />
      <${Segmented} value=${scope} onChange=${setScope} options=${[{ value: 'all', label: 'Chung' }, { value: 'class', label: 'Theo lớp' }]} />
      ${scope === 'class' && html`<select class="input fade-in" value=${klass || ''} onChange=${(e) => setKlass(e.target.value)}>
        ${classes.length ? classes.map((k) => html`<option value=${k}>${k}</option>`) : html`<option value="">Chưa có dữ liệu lớp</option>`}
      </select>`}
    </div>

    ${myRow && html`<button class="me-card slide-up" onClick=${locateMe}>
      <${Avatar} url=${myRow.avatar_url} name=${name(myRow)} size=${46} />
      <span class="grow"><b>Hạng #${myRow.rank}</b><br /><span class="small">${metric === 'merit' ? `🙏 ${num(myRow.pts)} công đức · nhặt được ${num(myRow.n)} món đồ thất lạc` : `${num(myRow.total_check_ins)} check-in · 🔥 ${num(myRow.current_streak)} ngày · 📅 ${num(myRow.weekly_streak)} tuần`}</span></span>
      <${Icon} name="crosshair" />
    </button>`}
    ${rows && !myRow && scope === 'class' && html`<div class="note">Bạn không thuộc lớp đang xem.</div>`}
    ${metric === 'merit' && rows && !myRow && scope === 'all' && html`<div class="note"><span>🔍 Sự kiện <b>Đồ thất lạc</b>: vào server bản đồ 3D, tìm đồ các bạn để quên ở nhà xe khu E, nhà xe khu B, các phòng học khu H và đăng confession tìm chủ để nhận điểm công đức.<br />
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onClick=${() => navigate('/map?server=1')}>Vào server tìm đồ</button></span></div>`}

    ${error ? html`<${ErrorBox} message=${'Không thể tải bảng xếp hạng. ' + error} onRetry=${load} />`
      : !rows ? html`<${Skeleton} h=${200} r=${24} /><${Skeleton} h=${64} count=${4} />`
      : !rows.length ? html`<${Empty} icon="chart" title=${metric === 'merit' ? 'Chưa ai nhặt được đồ thất lạc nào.' : 'Chưa có dữ liệu xếp hạng.'} />`
      : html`
        ${page === 1 && html`<${Podium} rows=${pageRows} metric=${metric} onOpen=${open} />`}
        <div class="lb-list" ref=${listRef}>
          ${listRows.map((r, i) => html`<button key=${r.user_id} id=${'lb-' + r.user_id}
              class=${'lb-row slide-up' + (r.user_id === me ? ' me' : '') + (highlight === r.user_id ? ' flash' : '')}
              style=${`--d:${Math.min(i, 12) * 35}ms` + (r.banner_url ? `;--banner:url('${r.banner_url}')` : '')} onClick=${() => open(r)}>
            <span class="lb-rank">${r.rank}</span>
            <${Avatar} url=${r.avatar_url} name=${name(r)} size=${42} />
            <span class="grow lb-who"><b>${name(r)}</b><span class="small muted">${cls(r)}</span></span>
            <span class="lb-score">${SCORE[metric](r)}</span>
          </button>`)}
        </div>
        ${totalPages > 1 && html`<div class="pager">
          <button class="btn btn-ghost btn-sm" disabled=${page <= 1} onClick=${() => setPage(page - 1)}>Trang trước</button>
          <span>${page} / ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" disabled=${page >= totalPages} onClick=${() => setPage(page + 1)}>Trang sau</button>
        </div>`}`}
  </div>`;
}
