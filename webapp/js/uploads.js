// Background upload manager for Documents.
// Lives outside any page, so uploads keep going while the user browses other pages.
// Uses XMLHttpRequest against the Storage REST API to get real byte-level progress
// (supabase-js upload() has no progress callback), then inserts the `documents` row.
import { html, useState, useEffect } from 'preact';
import { supabase, SUPABASE_URL, SUPABASE_KEY, createStore, currentUser, errMsg, fmtBytes } from './lib.js';
import { Icon } from './ui.js';
import { navigate } from './router.js';
import { useDeletes, deleteStats } from './deletes.js';
import { createThumbFromFile } from './thumbs.js';

const BUCKET = 'student-documents';
const PARALLEL = 2;
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
};
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';

// items: { id, file, name, size, loaded, status: 'queued'|'uploading'|'saving'|'done'|'error'|'canceled', error, parentId, folderName }
export const uploadStore = createStore({ items: [], doneTick: 0, lastDoneParent: undefined });
const xhrs = new Map();
let running = 0;
let seq = 0;

function patch(id, p) {
  uploadStore.set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
}

export function enqueueUploads(files, parentId, folderName) {
  const add = [...files].map((file) => ({
    id: ++seq, file, name: file.name, size: file.size, loaded: 0, status: 'queued', error: null, parentId, folderName,
  }));
  uploadStore.set((s) => ({ items: [...s.items.filter((x) => x.status !== 'done' && x.status !== 'canceled'), ...add] }));
  pump();
}

function pump() {
  while (running < PARALLEL) {
    const next = uploadStore.get().items.find((x) => x.status === 'queued');
    if (!next) break;
    running++;
    patch(next.id, { status: 'uploading' });
    run(next).finally(() => { running--; pump(); scheduleCleanup(); });
  }
}

function xhrUpload(path, file, mime, token, onProgress, id) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrs.set(id, xhr);
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      xhrs.delete(id);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Lỗi ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* not JSON */ }
      if (/exceeded|too large|payload/i.test(msg)) msg = 'Tệp quá lớn so với giới hạn cho phép.';
      reject(new Error(msg));
    };
    xhr.onerror = () => { xhrs.delete(id); reject(new Error('Mất kết nối mạng.')); };
    xhr.onabort = () => { xhrs.delete(id); reject(Object.assign(new Error('Đã huỷ'), { canceled: true })); };
    xhr.send(file);
  });
}

async function run(it) {
  try {
    const user = currentUser();
    const { data } = await supabase.auth.getSession(); // refreshes the token if needed
    const token = data.session?.access_token;
    if (!user || !token) throw new Error('Phiên đăng nhập đã hết.');
    const rawExt = extOf(it.name);
    const safeExt = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : 'bin';
    const path = `${user.id}/${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}.${safeExt}`;
    const mime = mimeOf(it.name);
    let last = 0;
    await xhrUpload(path, it.file, mime, token, (loaded) => {
      const now = performance.now();
      if (now - last > 120 || loaded === it.size) { last = now; patch(it.id, { loaded }); }
    }, it.id);
    patch(it.id, { loaded: it.size, status: 'saving' });
    const { data: row, error } = await supabase.from('documents').insert({
      user_id: user.id, name: it.name, item_type: 'file', parent_id: it.parentId,
      storage_path: path, mime_type: mime, file_size: it.size,
    }).select('id').single();
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
    // Thumbnail from the local file, so the list never has to download the whole document.
    await createThumbFromFile(user.id, row.id, { name: it.name, mime_type: mime }, it.file);
    patch(it.id, { status: 'done', file: null });
    uploadStore.set((s) => ({ doneTick: s.doneTick + 1, lastDoneParent: it.parentId }));
  } catch (e) {
    if (e.canceled) patch(it.id, { status: 'canceled', file: null });
    else patch(it.id, { status: 'error', error: errMsg(e) });
  }
}

export function cancelUpload(id) {
  const it = uploadStore.get().items.find((x) => x.id === id);
  if (!it) return;
  if (it.status === 'queued') patch(id, { status: 'canceled', file: null });
  else xhrs.get(id)?.abort();
  scheduleCleanup();
}
export function cancelAll() {
  for (const it of uploadStore.get().items) if (it.status === 'queued' || it.status === 'uploading') cancelUpload(it.id);
}
export function retryUpload(id) {
  patch(id, { status: 'queued', loaded: 0, error: null });
  pump();
}
export function clearFinished() {
  uploadStore.set((s) => ({ items: s.items.filter((x) => !['done', 'canceled', 'error'].includes(x.status)) }));
}

// When everything finished without errors, clear the list a few seconds later.
let cleanupTimer = null;
function scheduleCleanup() {
  clearTimeout(cleanupTimer);
  const items = uploadStore.get().items;
  if (!items.length || items.some((x) => ['queued', 'uploading', 'saving', 'error'].includes(x.status))) return;
  cleanupTimer = setTimeout(clearFinished, 6000);
}

export function uploadStats(items = uploadStore.get().items) {
  const live = items.filter((x) => x.status !== 'canceled');
  const total = live.reduce((a, x) => a + (x.size || 0), 0) || 1;
  const loaded = live.reduce((a, x) => a + (x.status === 'done' ? x.size : x.status === 'error' ? 0 : x.loaded), 0);
  const done = live.filter((x) => x.status === 'done').length;
  const errors = live.filter((x) => x.status === 'error').length;
  const active = live.some((x) => ['queued', 'uploading', 'saving'].includes(x.status));
  return { count: live.length, done, errors, active, pct: Math.min(100, Math.round((loaded / total) * 100)), loaded, total };
}

export function useUploads() {
  const [s, set] = useState(uploadStore.get());
  useEffect(() => { const u = uploadStore.subscribe(set); set(uploadStore.get()); return u; }, []);
  return s;
}

// Warn before closing the tab in the middle of an upload.
window.addEventListener('beforeunload', (e) => {
  if (uploadStats().active) { e.preventDefault(); e.returnValue = ''; }
});

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------
const STATUS = { queued: 'Đang chờ', uploading: '', saving: 'Đang lưu…', done: 'Xong', error: 'Lỗi', canceled: 'Đã huỷ' };

/** Full progress panel for the Documents page. */
export function UploadPanel() {
  const { items } = useUploads();
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const st = uploadStats(items);
  const title = st.active ? `Đang tải lên ${st.done}/${st.count} tệp` : st.errors ? `Xong ${st.done}/${st.count} tệp · ${st.errors} lỗi` : `Đã tải lên ${st.done} tệp 🎉`;
  return html`<section class=${'upload-panel pop-in' + (st.active ? '' : st.errors ? ' has-error' : ' all-done')}>
    <div class="up-head">
      <span class="up-icon">${st.active ? html`<${Icon} name="upload" size=${20} />` : st.errors ? html`<${Icon} name="info" size=${20} />` : html`<${Icon} name="check" size=${20} stroke=${3} />`}</span>
      <div class="grow">
        <div class="up-title"><b>${title}</b><span class="up-pct">${st.pct}%</span></div>
        <div class="up-bar"><span style=${`width:${st.pct}%`}></span></div>
        <div class="muted small">${fmtBytes(st.loaded)} / ${fmtBytes(st.total)}</div>
      </div>
    </div>
    <div class="up-actions">
      <button class="btn btn-ghost btn-sm" onClick=${() => setOpen(!open)}>${open ? 'Thu gọn' : `Xem ${items.length} tệp`}</button>
      ${st.active ? html`<button class="btn btn-ghost btn-sm danger-text" onClick=${cancelAll}>Huỷ tất cả</button>`
        : html`<button class="btn btn-ghost btn-sm" onClick=${clearFinished}>Đóng</button>`}
    </div>
    ${open && html`<div class="up-list">
      ${items.map((it) => {
        const pct = it.size ? Math.round(((it.status === 'done' ? it.size : it.loaded) / it.size) * 100) : 100;
        return html`<div key=${it.id} class=${'up-item s-' + it.status}>
          <div class="grow">
            <div class="up-name"><span class="ellipsis">${it.name}</span>
              <span class="small muted">${it.status === 'uploading' ? `${pct}%` : STATUS[it.status]}${it.folderName ? ` · ${it.folderName}` : ''}</span></div>
            ${it.status === 'error' ? html`<div class="small up-err">${it.error}</div>`
              : html`<div class="up-bar thin"><span style=${`width:${it.status === 'canceled' ? 0 : pct}%`}></span></div>`}
          </div>
          ${it.status === 'error' ? html`<button class="btn btn-ghost btn-sm" onClick=${() => retryUpload(it.id)}>Thử lại</button>`
            : (it.status === 'queued' || it.status === 'uploading') ? html`<button class="icon-btn" aria-label="Huỷ" onClick=${() => cancelUpload(it.id)}><${Icon} name="x" size=${16} /></button>`
            : it.status === 'done' ? html`<span class="up-ok"><${Icon} name="check" size=${14} stroke=${3} /></span>` : null}
        </div>`;
      })}
    </div>`}
  </section>`;
}

/** Small floating chip shown on other pages while uploads run. */
export function UploadIndicator({ path }) {
  const { items } = useUploads();
  const { jobs } = useDeletes();
  if (path.startsWith('/documents')) return null;
  const up = uploadStats(items);
  const del = deleteStats(jobs);
  const showUp = items.length && (up.active || up.errors);
  const showDel = jobs.length && (del.active || del.errors);
  if (!showUp && !showDel) return null;
  // Upload first if both run; the Documents page shows both panels.
  const st = showUp ? up : del;
  const label = showUp
    ? (up.active ? `Đang tải ${up.done}/${up.count}` : `${up.errors} tệp lỗi`)
    : (del.active ? `Đang xóa ${del.finished}/${del.count}` : `${del.errors} mục xóa lỗi`);
  const extra = showUp && showDel && del.active ? ' · đang xóa' : '';
  const err = (showUp ? !up.active && up.errors : !del.active && del.errors);
  const R = 15, C = 2 * Math.PI * R;
  return html`<button class=${'upload-chip pop-in' + (err ? ' err' : '') + (!showUp ? ' del' : '')} onClick=${() => navigate('/documents')} aria-label="Xem tiến trình">
    <svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r=${R} class="uc-bg" /><circle cx="19" cy="19" r=${R} class="uc-fg"
      stroke-dasharray=${C} stroke-dashoffset=${C * (1 - st.pct / 100)} /></svg>
    <span><b>${label}</b><small>${st.pct}% · Tài liệu${extra}</small></span>
  </button>`;
}
