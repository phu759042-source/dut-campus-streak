// Download several shared files (and whole folders) as one .zip, built in the browser with JSZip.
// ZIP rather than RAR: every OS opens ZIP without extra software, and RAR cannot be created in a browser.
// Files are stored without re-compression (PDF/JPG/DOCX are already compressed), which keeps it fast.
import { html } from 'preact';
import { createStore } from './lib.js';
import { Icon } from './ui.js';

const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024; // browser memory limit we accept (1 GB)
const PARALLEL = 3;

// { phase: 'scan'|'fetch'|'pack'|'done'|'error'|'canceled', name, files, doneFiles, bytes, doneBytes, pct, error }
export const zipStore = createStore({ job: null });
let controller = null;

const set = (p) => zipStore.set((s) => ({ job: s.job ? { ...s.job, ...p } : null }));

/** Unique path inside the zip ("a.pdf", "a (2).pdf", ...). */
function uniquePath(used, path) {
  if (!used.has(path)) { used.add(path); return path; }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const [base, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 2; ; n++) {
    const p = `${base} (${n})${ext}`;
    if (!used.has(p)) { used.add(p); return p; }
  }
}
const clean = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'tep';

async function fetchWithProgress(url, signal, onBytes) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Không tải được tệp (${res.status}).`);
  if (!res.body?.getReader) { const b = await res.blob(); onBytes(b.size); return b; }
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  return new Blob(parts);
}

/**
 * items: chosen documents ({id, name, item_type, file_size}); folders are expanded with listFolder(id) -> items.
 * signUrls(ids) -> { id: url } (at most 60 ids per call).
 */
export async function downloadZip({ items, zipName, listFolder, signUrls }) {
  if (zipStore.get().job && ['scan', 'fetch', 'pack'].includes(zipStore.get().job.phase)) return;
  controller = new AbortController();
  const { signal } = controller;
  zipStore.set({ job: { phase: 'scan', name: zipName, files: 0, doneFiles: 0, bytes: 0, doneBytes: 0, pct: 0, error: null } });
  try {
    // 1) Expand folders into a flat list of { item, path }.
    const files = [];
    const walk = async (list, prefix) => {
      for (const it of list) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (it.item_type === 'folder') await walk(await listFolder(it.id), `${prefix}${clean(it.name)}/`);
        else files.push({ item: it, path: `${prefix}${clean(it.name)}` });
      }
      set({ files: files.length });
    };
    await walk(items, '');
    if (!files.length) throw new Error('Không có tệp nào để tải.');
    const bytes = files.reduce((a, f) => a + (f.item.file_size || 0), 0);
    if (bytes > MAX_ZIP_BYTES) throw new Error('Tổng dung lượng vượt 1 GB. Hãy chọn ít tệp hơn và tải thành nhiều lần.');
    set({ phase: 'fetch', files: files.length, bytes });

    // 2) Download files (a few at a time) into the zip.
    const JSZip = await import(JSZIP).then((m) => m.default || m);
    const zip = new JSZip();
    const used = new Set();
    let doneBytes = 0, doneFiles = 0, next = 0;
    const urls = {};
    let signing = null;
    const worker = async () => {
      while (next < files.length) {
        const idx = next++;
        const f = files[idx];
        // Sign lazily in batches of up to 60 (signed URLs live 10 minutes); one batch at a time.
        while (!urls[f.item.id]) {
          if (signing) { await signing; continue; }
          const batch = files.slice(idx, idx + 60).map((x) => x.item.id).filter((id) => !urls[id]);
          signing = signUrls(batch).then((u) => { Object.assign(urls, u); }).finally(() => { signing = null; });
          await signing;
          break;
        }
        if (!urls[f.item.id]) throw new Error(`Không lấy được link tải cho "${f.item.name}".`);
        const blob = await fetchWithProgress(urls[f.item.id], signal, (n) => {
          doneBytes += n;
          set({ doneBytes, pct: Math.min(95, Math.round((doneBytes / (bytes || 1)) * 95)) });
        });
        zip.file(uniquePath(used, f.path), blob, { binary: true });
        set({ doneFiles: ++doneFiles });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));

    // 3) Pack and save.
    set({ phase: 'pack', pct: 96 });
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true },
      (m) => set({ pct: 96 + Math.round(m.percent * 0.04) }));
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const url = URL.createObjectURL(out);
    const a = document.createElement('a');
    a.href = url; a.download = `${clean(zipName)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
    set({ phase: 'done', pct: 100, zipSize: out.size });
  } catch (e) {
    if (e?.name === 'AbortError') set({ phase: 'canceled' });
    else set({ phase: 'error', error: e?.message || String(e) });
  } finally {
    controller = null;
  }
}

export function cancelZip() { controller?.abort(); }
export function closeZip() { zipStore.set({ job: null }); }

window.addEventListener('beforeunload', (e) => {
  const j = zipStore.get().job;
  if (j && ['scan', 'fetch', 'pack'].includes(j.phase)) { e.preventDefault(); e.returnValue = ''; }
});

const fmt = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Progress card. */
export function ZipPanel({ job }) {
  if (!job) return null;
  const active = ['scan', 'fetch', 'pack'].includes(job.phase);
  const title = {
    scan: `Đang gom tệp… ${job.files ? `(${job.files})` : ''}`,
    fetch: `Đang tải ${job.doneFiles}/${job.files} tệp`,
    pack: 'Đang đóng gói ZIP…',
    done: 'Đã tải xong file ZIP',
    error: 'Không tải được',
    canceled: 'Đã huỷ tải',
  }[job.phase];
  const sub = job.phase === 'fetch' ? `${fmt(job.doneBytes)} / ${fmt(job.bytes)} · Giữ trang này mở cho tới khi xong.`
    : job.phase === 'done' ? `${job.name}.zip · ${fmt(job.zipSize || job.bytes)} · ${job.files} tệp`
    : job.phase === 'error' ? job.error
    : job.phase === 'canceled' ? '' : 'Giữ trang này mở cho tới khi xong.';
  return html`<section class=${'upload-panel zip-panel pop-in' + (job.phase === 'done' ? ' all-done' : job.phase === 'error' ? ' has-error' : '')}>
    <div class="up-head">
      <span class="up-icon">${job.phase === 'done' ? html`<${Icon} name="check" size=${20} stroke=${3} />` : job.phase === 'error' ? html`<${Icon} name="info" size=${20} />` : html`<${Icon} name="download" size=${20} />`}</span>
      <div class="grow">
        <div class="up-title"><b>${title}</b>${job.phase !== 'error' && html`<span class="up-pct">${job.pct}%</span>`}</div>
        ${job.phase !== 'error' && html`<div class="up-bar"><span style=${`width:${job.pct}%`}></span></div>`}
        ${sub && html`<div class="muted small">${sub}</div>`}
      </div>
    </div>
    <div class="up-actions">
      ${active ? html`<button class="btn btn-ghost btn-sm danger-text" onClick=${cancelZip}>Huỷ</button>`
        : html`<button class="btn btn-ghost btn-sm" onClick=${closeZip}>Đóng</button>`}
    </div>
  </section>`;
}
