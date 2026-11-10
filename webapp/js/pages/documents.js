import { html, useState, useEffect, useRef } from 'preact';
import { supabase, currentUser, errMsg, fmtBytes, readLocal, writeLocal } from '../lib.js';
import { Icon, Spinner, Skeleton, ErrorBox, Empty, openSheet, confirmDialog, promptDialog, toast } from '../ui.js';
import { PageHeader } from './shared.js';

const BUCKET = 'student-documents';
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
};
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
const isImage = (it) => String(it.mime_type || mimeOf(it.name)).startsWith('image/');

function fileTone(name) {
  const e = extOf(name);
  if (e === 'pdf') return ['PDF', 'red'];
  if (['doc', 'docx'].includes(e)) return ['DOC', 'blue'];
  if (['xls', 'xlsx', 'csv'].includes(e)) return ['XLS', 'green'];
  if (['ppt', 'pptx'].includes(e)) return ['PPT', 'amber'];
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return ['IMG', 'violet'];
  if (['zip', 'rar'].includes(e)) return ['ZIP', 'gray'];
  return [(e || 'FILE').slice(0, 4).toUpperCase(), 'gray'];
}

export function DocumentsPage() {
  const [stack, setStack] = useState([]); // folder path
  const [items, setItems] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(readLocal('cs-docs-grid') === '1');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  const parentId = stack.length ? stack[stack.length - 1].id : null;
  const uid = currentUser().id;

  async function load() {
    setError(null); setItems(null);
    let q = supabase.from('documents').select().eq('user_id', uid);
    q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
    const { data, error: err } = await q.order('item_type', { ascending: false }).order('name');
    if (err) return setError('Không tải được tài liệu: ' + errMsg(err));
    const list = (data || []).sort((a, b) => (a.item_type === b.item_type ? a.name.localeCompare(b.name) : a.item_type === 'folder' ? -1 : 1));
    setItems(list);
    const imgs = list.filter((it) => it.item_type === 'file' && it.storage_path && isImage(it));
    if (imgs.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(imgs.map((i) => i.storage_path), 3600);
      const map = {};
      (signed || []).forEach((s) => { if (s.signedUrl) map[s.path] = s.signedUrl; });
      setThumbs(map);
    }
  }
  useEffect(() => { load(); }, [parentId]);

  async function createFolder() {
    const name = await promptDialog({ title: 'Tạo thư mục', placeholder: 'Tên thư mục' });
    if (!name) return;
    setBusy(true);
    const { error: err } = await supabase.from('documents').insert({ user_id: uid, name, item_type: 'folder', parent_id: parentId });
    setBusy(false);
    if (err) return toast('Không tạo được thư mục: ' + errMsg(err), 'error');
    load();
  }

  async function upload(files) {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of files) {
        const rawExt = extOf(file.name);
        const safeExt = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : 'bin';
        const path = `${uid}/${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}.${safeExt}`;
        const mime = mimeOf(file.name);
        const { error: e1 } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
        if (e1) throw e1;
        const { error: e2 } = await supabase.from('documents').insert({
          user_id: uid, name: file.name, item_type: 'file', parent_id: parentId, storage_path: path, mime_type: mime, file_size: file.size,
        });
        if (e2) { await supabase.storage.from(BUCKET).remove([path]); throw e2; }
        ok++;
      }
      toast(`Đã tải lên ${ok} tệp.`, 'success');
    } catch (e) { toast('Tải tệp thất bại: ' + errMsg(e), 'error'); }
    setBusy(false);
    load();
  }

  async function openFile(it) {
    const win = window.open('', '_blank');
    const { data, error: err } = await supabase.storage.from(BUCKET).createSignedUrl(it.storage_path, 600);
    if (err) { win?.close(); return toast('Không mở được tệp: ' + errMsg(err), 'error'); }
    if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
  }
  async function download(it) {
    const { data, error: err } = await supabase.storage.from(BUCKET).createSignedUrl(it.storage_path, 600, { download: it.name });
    if (err) return toast(errMsg(err), 'error');
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = it.name; a.click();
  }
  async function rename(it) {
    const name = await promptDialog({ title: 'Đổi tên', initial: it.name });
    if (!name || name === it.name) return;
    const { error: err } = await supabase.from('documents').update({ name, updated_at: new Date().toISOString() }).eq('id', it.id).eq('user_id', uid);
    if (err) return toast('Đổi tên thất bại: ' + errMsg(err), 'error');
    load();
  }
  async function deleteRecursive(it) {
    if (it.item_type === 'folder') {
      const { data: children } = await supabase.from('documents').select().eq('parent_id', it.id);
      for (const ch of children || []) await deleteRecursive(ch);
    } else if (it.storage_path) {
      await supabase.storage.from(BUCKET).remove([it.storage_path]);
    }
    const { error: err } = await supabase.from('documents').delete().eq('id', it.id).eq('user_id', uid);
    if (err) throw err;
  }
  async function remove(it) {
    const folder = it.item_type === 'folder';
    const ok = await confirmDialog({
      title: folder ? 'Xóa thư mục?' : 'Xóa tệp?', danger: true, confirmText: 'Xóa',
      message: folder ? 'Thư mục và toàn bộ nội dung bên trong sẽ bị xóa. Bạn không thể hoàn tác.' : 'Tệp này sẽ bị xóa khỏi tài liệu của bạn.',
    });
    if (!ok) return;
    setBusy(true);
    try { await deleteRecursive(it); toast('Đã xóa.', 'success'); } catch (e) { toast('Xóa thất bại: ' + errMsg(e), 'error'); }
    setBusy(false);
    load();
  }
  async function menu(it) {
    const folder = it.item_type === 'folder';
    const c = await openSheet(({ close }) => html`<div class="stack-sm">
      <div class="muted small ellipsis">${it.name}</div>
      ${!folder && html`<button class="menu-item" onClick=${() => close('open')}><span class="list-icon blue"><${Icon} name="eye" /></span><b>Mở</b></button>`}
      ${!folder && html`<button class="menu-item" onClick=${() => close('download')}><span class="list-icon green"><${Icon} name="download" /></span><b>Tải xuống</b></button>`}
      <button class="menu-item" onClick=${() => close('rename')}><span class="list-icon violet"><${Icon} name="edit" /></span><b>Đổi tên</b></button>
      <button class="menu-item" onClick=${() => close('delete')}><span class="list-icon red"><${Icon} name="trash" /></span><b>Xóa</b></button>
    </div>`, { title: folder ? 'Thư mục' : 'Tệp' });
    if (c === 'open') openFile(it);
    if (c === 'download') download(it);
    if (c === 'rename') rename(it);
    if (c === 'delete') remove(it);
  }
  const activate = (it) => (it.item_type === 'folder' ? setStack([...stack, it]) : openFile(it));
  const toggleGrid = () => { setGrid(!grid); writeLocal('cs-docs-grid', grid ? '0' : '1'); };

  return html`<div class=${'page' + (dragging ? ' dropping' : '')}
    onDragOver=${(e) => { e.preventDefault(); setDragging(true); }} onDragLeave=${(e) => { if (e.target === e.currentTarget) setDragging(false); }}
    onDrop=${(e) => { e.preventDefault(); setDragging(false); upload([...e.dataTransfer.files]); }}>
    <${PageHeader} title="Tài liệu" actions=${html`
      ${busy && html`<${Spinner} size=${20} />`}
      <button class="icon-btn" aria-label="Đổi kiểu hiển thị" onClick=${toggleGrid}><${Icon} name=${grid ? 'list' : 'grid'} /></button>`} />
    <div class="crumbs">
      <button class=${!stack.length ? 'active' : ''} onClick=${() => setStack([])}><${Icon} name="home" size=${15} /> Tài liệu của tôi</button>
      ${stack.map((f, i) => html`<span class="crumb-sep">›</span><button class=${i === stack.length - 1 ? 'active' : ''} onClick=${() => setStack(stack.slice(0, i + 1))}>${f.name}</button>`)}
    </div>
    <div class="row gap wrap">
      <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${() => fileRef.current?.click()}><${Icon} name="upload" size=${18} /> Tải tệp lên</button>
      <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${createFolder}><${Icon} name="folder" size=${18} /> Thư mục mới</button>
      <input ref=${fileRef} type="file" multiple class="hidden" onChange=${(e) => { upload([...e.target.files]); e.target.value = ''; }} />
    </div>
    <div class="gap-top"></div>
    ${error ? html`<${ErrorBox} message=${error} onRetry=${load} />`
      : !items ? html`<${Skeleton} h=${64} count=${4} />`
      : !items.length ? html`<${Empty} icon="folder" title="Thư mục trống" text="Tải tệp lên hoặc kéo thả tệp vào đây." />`
      : html`<div class=${grid ? 'doc-grid' : 'doc-list'}>
          ${items.map((it, i) => {
            const folder = it.item_type === 'folder';
            const [label, tone] = folder ? ['', 'amber'] : fileTone(it.name);
            const thumb = !folder && thumbs[it.storage_path];
            return html`<div key=${it.id} class="doc slide-up" style=${`--d:${Math.min(i, 15) * 30}ms`}>
              <button class="doc-main" onClick=${() => activate(it)}>
                <span class=${'doc-thumb tone-' + tone}>
                  ${thumb ? html`<img src=${thumb} alt="" loading="lazy" />` : folder ? html`<${Icon} name="folder" size=${grid ? 40 : 24} />` : html`<b>${label}</b>`}
                </span>
                <span class="doc-info"><span class="doc-name">${it.name}</span>
                  <span class="muted small">${folder ? 'Thư mục' : fmtBytes(it.file_size)}</span></span>
              </button>
              <button class="icon-btn doc-more" aria-label="Tùy chọn" onClick=${() => menu(it)}><${Icon} name="more" /></button>
            </div>`;
          })}
        </div>`}
    ${dragging && html`<div class="drop-hint"><${Icon} name="upload" size=${40} /> Thả tệp để tải lên</div>`}
  </div>`;
}
