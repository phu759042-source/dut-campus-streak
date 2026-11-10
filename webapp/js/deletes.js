// Background delete manager for Documents (same idea as uploads.js).
// Deleting a folder first lists everything inside it, removes the files from Storage in batches
// (that is where the progress comes from), then deletes the folder row; child rows go with it
// through ON DELETE CASCADE on documents.parent_id.
import { html, useState, useEffect } from 'preact';
import { supabase, createStore, currentUser, errMsg } from './lib.js';
import { Icon } from './ui.js';
import { thumbPath, forgetThumbs } from './thumbs.js';

const BUCKET = 'student-documents';
const BATCH = 40;

// jobs: { id, docId, name, item_type, parentId, folderName, total, done, status: 'queued'|'scanning'|'deleting'|'done'|'error', error }
export const deleteStore = createStore({ jobs: [], doneTick: 0, lastDoneParent: undefined });
let seq = 0;
let running = false;

function patch(id, p) {
  deleteStore.set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
}

export function enqueueDeletes(items, parentId, folderName) {
  const pending = new Set(deleteStore.get().jobs.filter((j) => !['done', 'error'].includes(j.status)).map((j) => j.docId));
  const add = items.filter((it) => !pending.has(it.id)).map((it) => ({
    id: ++seq, docId: it.id, name: it.name, item_type: it.item_type, storage_path: it.storage_path,
    parentId, folderName, total: 1, done: 0, status: 'queued', error: null,
  }));
  deleteStore.set((s) => ({ jobs: [...s.jobs.filter((j) => j.status !== 'done'), ...add] }));
  pump();
}

/** Ids of documents that are queued or being deleted (to grey them out in lists). */
export function pendingDeleteIds(jobs = deleteStore.get().jobs) {
  return new Set(jobs.filter((j) => !['done', 'error'].includes(j.status)).map((j) => j.docId));
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = deleteStore.get().jobs.find((j) => j.status === 'queued');
      if (!job) break;
      await run(job);
    }
  } finally {
    running = false;
    scheduleCleanup();
  }
}

/** All storage paths under a folder (breadth-first, a few queries per level). */
async function collectFiles(rootId, uid) {
  const paths = [];
  const ids = [];
  let level = [rootId];
  while (level.length) {
    const next = [];
    for (let k = 0; k < level.length; k += 100) {
      const { data, error } = await supabase.from('documents').select('id, item_type, storage_path')
        .in('parent_id', level.slice(k, k + 100));
      if (error) throw error;
      for (const d of data || []) {
        if (d.item_type === 'folder') next.push(d.id);
        else if (d.storage_path) { paths.push(d.storage_path, thumbPath(uid, d.id)); ids.push(d.id); }
      }
    }
    level = next;
  }
  return { paths, ids };
}

async function run(job) {
  try {
    const uid = currentUser()?.id;
    if (!uid) throw new Error('Phiên đăng nhập đã hết.');
    patch(job.id, { status: 'scanning' });
    // Each file has two objects: the document and its thumbnail (missing thumbnails are simply ignored).
    const { paths, ids } = job.item_type === 'folder'
      ? await collectFiles(job.docId, uid)
      : { paths: job.storage_path ? [job.storage_path, thumbPath(uid, job.docId)] : [], ids: [job.docId] };
    const total = paths.length + 1; // +1 for the database row
    patch(job.id, { status: 'deleting', total, done: 0 });
    for (let k = 0; k < paths.length; k += BATCH) {
      const chunk = paths.slice(k, k + BATCH);
      const { error } = await supabase.storage.from(BUCKET).remove(chunk);
      if (error) throw error;
      patch(job.id, { done: Math.min(paths.length, k + chunk.length) });
    }
    const { error } = await supabase.from('documents').delete().eq('id', job.docId).eq('user_id', uid);
    if (error) throw error;
    forgetThumbs(uid, ids);
    patch(job.id, { status: 'done', done: total });
    deleteStore.set((s) => ({ doneTick: s.doneTick + 1, lastDoneParent: job.parentId }));
  } catch (e) {
    patch(job.id, { status: 'error', error: errMsg(e) });
  }
}

export function retryDelete(id) {
  patch(id, { status: 'queued', error: null, done: 0 });
  pump();
}
export function cancelQueuedDeletes() {
  deleteStore.set((s) => ({ jobs: s.jobs.filter((j) => j.status !== 'queued') }));
  scheduleCleanup();
}
export function clearFinishedDeletes() {
  deleteStore.set((s) => ({ jobs: s.jobs.filter((j) => !['done', 'error'].includes(j.status)) }));
}

let cleanupTimer = null;
function scheduleCleanup() {
  clearTimeout(cleanupTimer);
  const jobs = deleteStore.get().jobs;
  if (!jobs.length || jobs.some((j) => ['queued', 'scanning', 'deleting', 'error'].includes(j.status))) return;
  cleanupTimer = setTimeout(clearFinishedDeletes, 5000);
}

export function deleteStats(jobs = deleteStore.get().jobs) {
  const total = jobs.reduce((a, j) => a + (j.total || 1), 0) || 1;
  const done = jobs.reduce((a, j) => a + (j.status === 'done' ? j.total : j.status === 'error' ? 0 : j.done), 0);
  return {
    count: jobs.length,
    finished: jobs.filter((j) => j.status === 'done').length,
    errors: jobs.filter((j) => j.status === 'error').length,
    active: jobs.some((j) => ['queued', 'scanning', 'deleting'].includes(j.status)),
    pct: Math.min(100, Math.round((done / total) * 100)),
  };
}

export function useDeletes() {
  const [s, set] = useState(deleteStore.get());
  useEffect(() => { const u = deleteStore.subscribe(set); set(deleteStore.get()); return u; }, []);
  return s;
}

window.addEventListener('beforeunload', (e) => {
  if (deleteStats().active) { e.preventDefault(); e.returnValue = ''; }
});

const STATUS = { queued: 'Đang chờ', scanning: 'Đang quét thư mục…', deleting: '', done: 'Đã xóa', error: 'Lỗi' };

/** Progress panel for the Documents page. */
export function DeletePanel() {
  const { jobs } = useDeletes();
  const [open, setOpen] = useState(true);
  if (!jobs.length) return null;
  const st = deleteStats(jobs);
  const title = st.active ? `Đang xóa ${st.finished}/${st.count} mục` : st.errors ? `Đã xóa ${st.finished}/${st.count} mục · ${st.errors} lỗi` : `Đã xóa ${st.finished} mục`;
  return html`<section class=${'upload-panel delete-panel pop-in' + (st.active ? '' : st.errors ? ' has-error' : ' all-done')}>
    <div class="up-head">
      <span class="up-icon">${st.active ? html`<${Icon} name="trash" size=${20} />` : st.errors ? html`<${Icon} name="info" size=${20} />` : html`<${Icon} name="check" size=${20} stroke=${3} />`}</span>
      <div class="grow">
        <div class="up-title"><b>${title}</b><span class="up-pct">${st.pct}%</span></div>
        <div class="up-bar"><span style=${`width:${st.pct}%`}></span></div>
        <div class="muted small">${st.active ? 'Bạn có thể chuyển sang trang khác, việc xóa vẫn tiếp tục.' : 'Hoàn tất.'}</div>
      </div>
    </div>
    <div class="up-actions">
      <button class="btn btn-ghost btn-sm" onClick=${() => setOpen(!open)}>${open ? 'Thu gọn' : `Xem ${jobs.length} mục`}</button>
      ${st.active ? (jobs.some((j) => j.status === 'queued') && html`<button class="btn btn-ghost btn-sm danger-text" onClick=${cancelQueuedDeletes}>Huỷ mục đang chờ</button>`)
        : html`<button class="btn btn-ghost btn-sm" onClick=${clearFinishedDeletes}>Đóng</button>`}
    </div>
    ${open && html`<div class="up-list">
      ${jobs.map((j) => {
        const pct = j.status === 'done' ? 100 : Math.round((j.done / (j.total || 1)) * 100);
        const detail = j.status === 'deleting' && j.item_type === 'folder' ? `${pct}% · ${Math.floor(j.done / 2)}/${Math.floor((j.total - 1) / 2)} tệp` : j.status === 'deleting' ? `${pct}%` : STATUS[j.status];
        return html`<div key=${j.id} class=${'up-item s-' + (j.status === 'deleting' || j.status === 'scanning' ? 'uploading' : j.status)}>
          <span class="up-kind"><${Icon} name=${j.item_type === 'folder' ? 'folder' : 'file'} size=${16} /></span>
          <div class="grow">
            <div class="up-name"><span class="ellipsis">${j.name}</span><span class="small muted">${detail}${j.folderName ? ` · ${j.folderName}` : ''}</span></div>
            ${j.status === 'error' ? html`<div class="small up-err">${j.error}</div>` : html`<div class="up-bar thin"><span style=${`width:${pct}%`}></span></div>`}
          </div>
          ${j.status === 'error' ? html`<button class="btn btn-ghost btn-sm" onClick=${() => retryDelete(j.id)}>Thử lại</button>`
            : j.status === 'done' ? html`<span class="up-ok"><${Icon} name="check" size=${14} stroke=${3} /></span>` : null}
        </div>`;
      })}
    </div>`}
  </section>`;
}
