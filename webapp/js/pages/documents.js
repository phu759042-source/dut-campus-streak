import { html, useState, useEffect, useRef } from 'preact';
import { supabase, currentUser, errMsg, fmtBytes, readLocal, writeLocal } from '../lib.js';
import { Icon, Spinner, Skeleton, ErrorBox, Empty, openSheet, confirmDialog, promptDialog, toast } from '../ui.js';
import { PageHeader } from './shared.js';
import { getPreview, previewKind } from '../preview.js';
import { publishShareCard } from '../sharecard.js';
import { enqueueUploads, UploadPanel, useUploads } from '../uploads.js';
import { enqueueDeletes, DeletePanel, useDeletes, pendingDeleteIds } from '../deletes.js';
import { appStore } from '../lib.js';

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

export function fileTone(name) {
  const e = extOf(name);
  if (e === 'pdf') return ['PDF', 'red'];
  if (['doc', 'docx'].includes(e)) return ['DOC', 'blue'];
  if (['xls', 'xlsx', 'csv'].includes(e)) return ['XLS', 'green'];
  if (['ppt', 'pptx'].includes(e)) return ['PPT', 'amber'];
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return ['IMG', 'violet'];
  if (['zip', 'rar'].includes(e)) return ['ZIP', 'gray'];
  return [(e || 'FILE').slice(0, 4).toUpperCase(), 'gray'];
}


/** Thumbnail tile: real preview for images, PDFs, Office and text files (lazy, when visible). */
export function DocThumb({ item, folder, label, tone, grid, thumb, previewOpts }) {
  const ref = useRef();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const kind = folder ? null : previewKind(item);
  useEffect(() => {
    if (!kind || kind === 'image' || !ref.current) return;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setLoading(true);
      getPreview(item, previewOpts).then((p) => { if (alive) { setPreview(p); setLoading(false); } });
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => { alive = false; io.disconnect(); };
  }, [item.storage_path]);

  const img = thumb || (preview?.type === 'image' ? preview.url : null);
  const badge = !folder && html`<span class=${'doc-badge tone-' + tone}>${label}</span>`;
  let body;
  if (folder) body = html`<${Icon} name="folder" size=${grid ? 40 : 24} />`;
  else if (img) body = html`<img src=${img} alt="" loading="lazy" class=${kind === 'pdf' || kind === 'office' ? 'page-img' : ''} />`;
  else if (preview?.type === 'text') body = html`<div class="doc-paper"><b>${preview.title}</b><span>${preview.text}</span></div>`;
  else body = html`<b class="doc-label">${label}</b>`;
  return html`<span ref=${ref} class=${'doc-thumb tone-' + tone + (img || preview ? ' has-preview' : '') + (loading ? ' loading' : '')}>
    ${body}${(img || preview) && badge}${preview?.pages > 1 && grid ? html`<span class="doc-pages">${preview.pages} trang</span>` : null}
  </span>`;
}


const SHARE_BASE = `${location.hostname.endsWith('campusstreak.com') ? 'https://www.campusstreak.com' : location.origin}/s/`;

const cardsDone = new Set();
const ownerName = () => appStore.get().profile?.display_name || 'Một sinh viên';

function ShareSheet({ item }) {
  const [shares, setShares] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    const { data, error } = await supabase.from('document_shares').select('*').eq('document_id', item.id)
      .is('revoked_at', null).order('created_at', { ascending: false });
    if (error) return toast('Không tải được link chia sẻ: ' + errMsg(error), 'error');
    setShares(data || []);
    // Make sure every active link has its preview card (links created before cards existed, renamed items...).
    for (const sh of data || []) {
      if (cardsDone.has(sh.token)) continue;
      cardsDone.add(sh.token);
      publishShareCard(sh, item, ownerName());
    }
  }
  useEffect(() => { load(); }, []);
  async function create() {
    setBusy(true);
    const { data: created, error } = await supabase.from('document_shares')
      .insert({ document_id: item.id, allow_download: true }).select().single();
    if (error) { setBusy(false); return toast('Không tạo được link: ' + errMsg(error), 'error'); }
    await publishShareCard(created, item, ownerName()); // so the link shows a preview card right away
    cardsDone.add(created.token);
    setBusy(false);
    load();
  }
  async function update(s, patch) {
    const { error } = await supabase.from('document_shares').update(patch).eq('id', s.id);
    if (error) return toast(errMsg(error), 'error');
    load();
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast('Đã sao chép link.', 'success'); }
    catch { prompt('Sao chép link này:', url); }
  }
  async function shareNative(url) {
    try { await navigator.share({ title: item.name, text: `Tài liệu "${item.name}" trên Campus Streak`, url }); } catch { /* cancelled */ }
  }
  const folder = item.item_type === 'folder';
  return html`<div class="stack">
    <div class="share-target"><span class=${'list-icon ' + (folder ? 'amber' : 'blue')}><${Icon} name=${folder ? 'folder' : 'file'} /></span>
      <span class="grow"><b class="ellipsis">${item.name}</b><br /><span class="muted small">${folder ? 'Người có link xem được mọi tệp trong thư mục này (chỉ đọc).' : 'Người có link xem được tệp này (chỉ đọc).'}</span></span></div>
    ${shares === null ? html`<div class="center pad"><${Spinner} /></div>`
      : shares.length === 0 ? html`<button class="btn btn-primary btn-lg btn-block" disabled=${busy} onClick=${create}>
          ${busy ? html`<${Spinner} size=${18} />` : html`<${Icon} name="sparkles" size=${18} /> Tạo link chia sẻ`}</button>`
      : shares.map((s) => {
        const url = SHARE_BASE + s.token;
        return html`<div class="share-box fade-in" key=${s.id}>
          <div class="share-url" onClick=${() => copy(url)}>${url}</div>
          <div class="row gap wrap">
            <button class="btn btn-primary btn-sm grow" onClick=${() => copy(url)}><${Icon} name="paste" size=${16} /> Sao chép</button>
            ${navigator.share && html`<button class="btn btn-ghost btn-sm grow" onClick=${() => shareNative(url)}><${Icon} name="upload" size=${16} /> Gửi…</button>`}
            <a class="btn btn-ghost btn-sm grow" href=${url} target="_blank" rel="noopener"><${Icon} name="eye" size=${16} /> Xem thử</a>
          </div>
          <label class="switch-row"><span>Cho phép tải về<br /><span class="muted small">Tắt thì người xem chỉ mở xem được</span></span>
            <input type="checkbox" class="switch" checked=${s.allow_download} onChange=${(e) => update(s, { allow_download: e.target.checked })} /></label>
          <div class="row gap share-foot"><span class="muted small grow">${s.view_count || 0} lượt mở · tạo ${new Date(s.created_at).toLocaleDateString('vi-VN')}</span>
            <button class="btn btn-sm btn-ghost danger-text" onClick=${async () => {
              if (await confirmDialog({ title: 'Thu hồi link?', message: 'Link này sẽ ngừng hoạt động ngay. Bạn có thể tạo link mới sau.', confirmText: 'Thu hồi', danger: true }))
                update(s, { revoked_at: new Date().toISOString() });
            }}>Thu hồi link</button></div>
        </div>`;
      })}
  </div>`;
}

export function DocumentsPage() {
  const [stack, setStack] = useState([]); // folder path
  const [items, setItems] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(readLocal('cs-docs-grid') === '1');
  const [dragging, setDragging] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const fileRef = useRef();
  const press = useRef({ timer: null, fired: false, x: 0, y: 0 });
  const parentId = stack.length ? stack[stack.length - 1].id : null;
  const uid = currentUser().id;

  async function load(soft = false) {
    setError(null);
    if (!soft) setItems(null);
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
  useEffect(() => { exitSelect(); load(); }, [parentId]);
  // A background upload into this folder finished: refresh the list without flashing.
  const uploads = useUploads();
  useEffect(() => { if (uploads.doneTick && uploads.lastDoneParent === parentId) load(true); }, [uploads.doneTick]);
  const deletes = useDeletes();
  const deleting = pendingDeleteIds(deletes.jobs);
  useEffect(() => { if (deletes.doneTick && deletes.lastDoneParent === parentId) load(true); }, [deletes.doneTick]);
  const currentFolderName = () => (stack.length ? stack[stack.length - 1].name : 'Tài liệu của tôi');

  // ---------- multi-select ----------
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggle(it) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
      if (!next.size) setSelectMode(false);
      return next;
    });
  }
  function startSelect(it) { setSelectMode(true); setSelected(new Set([it.id])); navigator.vibrate?.(25); }
  const allSelected = !!items && items.length > 0 && selected.size === items.length;
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(items.map((x) => x.id)));

  // Long-press (touch or mouse) on a tile enters selection mode.
  const pressHandlers = (it) => ({
    onPointerDown: (e) => {
      if (e.button > 0) return;
      const p = press.current;
      p.fired = false; p.x = e.clientX; p.y = e.clientY;
      clearTimeout(p.timer);
      p.timer = setTimeout(() => { p.fired = true; if (selectMode) toggle(it); else startSelect(it); }, 480);
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) clearTimeout(p.timer);
    },
    onPointerUp: () => clearTimeout(press.current.timer),
    onPointerLeave: () => clearTimeout(press.current.timer),
    onPointerCancel: () => clearTimeout(press.current.timer),
    onContextMenu: (e) => { if (press.current.fired || selectMode) e.preventDefault(); },
  });
  function onTileClick(e, it) {
    if (press.current.fired) { press.current.fired = false; return; } // the long-press already handled it
    if (selectMode) return toggle(it);
    if (e.ctrlKey || e.metaKey) return startSelect(it);
    activate(it);
  }

  async function removeSelected() {
    const chosen = items.filter((x) => selected.has(x.id));
    if (!chosen.length) return;
    const folders = chosen.filter((x) => x.item_type === 'folder').length;
    const files = chosen.length - folders;
    const what = [folders ? `${folders} thư mục` : '', files ? `${files} tệp` : ''].filter(Boolean).join(' và ');
    const ok = await confirmDialog({
      title: allSelected ? 'Xóa tất cả?' : `Xóa ${chosen.length} mục?`, danger: true, confirmText: 'Xóa',
      message: `${what} sẽ bị xóa${folders ? ', kể cả mọi tệp bên trong các thư mục' : ''}. Bạn không thể hoàn tác.`,
    });
    if (!ok) return;
    enqueueDeletes(chosen, parentId, currentFolderName());
    exitSelect();
    toast(`Đang xóa ${chosen.length} mục… Bạn có thể chuyển trang, việc xóa vẫn tiếp tục.`, 'info', 4000);
  }

  async function createFolder() {
    const name = await promptDialog({ title: 'Tạo thư mục', placeholder: 'Tên thư mục' });
    if (!name) return;
    setBusy(true);
    const { error: err } = await supabase.from('documents').insert({ user_id: uid, name, item_type: 'folder', parent_id: parentId });
    setBusy(false);
    if (err) return toast('Không tạo được thư mục: ' + errMsg(err), 'error');
    load();
  }

  function upload(files) {
    if (!files?.length) return;
    enqueueUploads(files, parentId, stack.length ? stack[stack.length - 1].name : 'Tài liệu của tôi');
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
  async function remove(it) {
    const folder = it.item_type === 'folder';
    const ok = await confirmDialog({
      title: folder ? 'Xóa thư mục?' : 'Xóa tệp?', danger: true, confirmText: 'Xóa',
      message: folder ? 'Thư mục và toàn bộ nội dung bên trong sẽ bị xóa. Bạn không thể hoàn tác.' : 'Tệp này sẽ bị xóa khỏi tài liệu của bạn.',
    });
    if (!ok) return;
    enqueueDeletes([it], parentId, currentFolderName());
  }
  async function menu(it) {
    const folder = it.item_type === 'folder';
    const c = await openSheet(({ close }) => html`<div class="stack-sm">
      <div class="muted small ellipsis">${it.name}</div>
      ${!folder && html`<button class="menu-item" onClick=${() => close('open')}><span class="list-icon blue"><${Icon} name="eye" /></span><b>Mở</b></button>`}
      ${!folder && html`<button class="menu-item" onClick=${() => close('download')}><span class="list-icon green"><${Icon} name="download" /></span><b>Tải xuống</b></button>`}
      <button class="menu-item" onClick=${() => close('share')}><span class="list-icon amber"><${Icon} name="users" /></span><b>Chia sẻ qua link</b></button>
      <button class="menu-item" onClick=${() => close('rename')}><span class="list-icon violet"><${Icon} name="edit" /></span><b>Đổi tên</b></button>
      <button class="menu-item" onClick=${() => close('delete')}><span class="list-icon red"><${Icon} name="trash" /></span><b>Xóa</b></button>
    </div>`, { title: folder ? 'Thư mục' : 'Tệp' });
    if (c === 'open') openFile(it);
    if (c === 'download') download(it);
    if (c === 'share') openSheet(() => html`<${ShareSheet} item=${it} />`, { title: 'Chia sẻ' });
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
      ${items?.length > 0 && !selectMode && html`<button class="btn btn-ghost btn-sm" onClick=${() => setSelectMode(true)}><${Icon} name="checkCircle" size=${16} /> Chọn</button>`}
      <button class="icon-btn" aria-label="Đổi kiểu hiển thị" onClick=${toggleGrid}><${Icon} name=${grid ? 'list' : 'grid'} /></button>`} />
    <div class="crumbs">
      <button class=${!stack.length ? 'active' : ''} onClick=${() => setStack([])}><${Icon} name="home" size=${15} /> Tài liệu của tôi</button>
      ${stack.map((f, i) => html`<span class="crumb-sep">›</span><button class=${i === stack.length - 1 ? 'active' : ''} onClick=${() => setStack(stack.slice(0, i + 1))}>${f.name}</button>`)}
    </div>
    ${selectMode ? html`<div class="select-bar pop-in">
        <button class="icon-btn" aria-label="Thoát chọn" onClick=${exitSelect}><${Icon} name="x" size=${20} /></button>
        <b class="grow">${selected.size ? `Đã chọn ${selected.size}` : 'Chạm để chọn'}</b>
        <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${selectAll}>${allSelected ? 'Bỏ chọn' : 'Chọn tất cả'}</button>
        <button class="btn btn-danger btn-sm" disabled=${busy || !selected.size} onClick=${removeSelected}><${Icon} name="trash" size=${16} /> Xóa</button>
      </div>` : html`<div class="row gap wrap">
      <button class="btn btn-primary btn-sm" disabled=${busy} onClick=${() => fileRef.current?.click()}><${Icon} name="upload" size=${18} /> Tải tệp lên</button>
      <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${createFolder}><${Icon} name="folder" size=${18} /> Thư mục mới</button>
    </div>`}
    <${UploadPanel} />
    <${DeletePanel} />
    <input ref=${fileRef} type="file" multiple class="hidden" onChange=${(e) => { upload([...e.target.files]); e.target.value = ''; }} />
    <div class="gap-top"></div>
    ${error ? html`<${ErrorBox} message=${error} onRetry=${load} />`
      : !items ? html`<${Skeleton} h=${64} count=${4} />`
      : !items.length ? html`<${Empty} icon="folder" title="Thư mục trống" text="Tải tệp lên hoặc kéo thả tệp vào đây." />`
      : html`<div class=${grid ? 'doc-grid' : 'doc-list'}>
          ${items.map((it, i) => {
            const folder = it.item_type === 'folder';
            const [label, tone] = folder ? ['', 'amber'] : fileTone(it.name);
            const thumb = !folder && thumbs[it.storage_path];
            const isSel = selected.has(it.id);
            const isDel = deleting.has(it.id);
            return html`<div key=${it.id} class=${'doc slide-up' + (selectMode ? ' selecting' : '') + (isSel ? ' selected' : '') + (isDel ? ' deleting' : '')} style=${`--d:${Math.min(i, 15) * 30}ms`}>
              ${isDel && html`<span class="doc-deleting"><${Spinner} size=${18} /> Đang xóa…</span>`}
              <button class="doc-main" disabled=${isDel} onClick=${(e) => onTileClick(e, it)} ...${pressHandlers(it)}>
                ${selectMode && html`<span class=${'doc-check' + (isSel ? ' on' : '')}>${isSel && html`<${Icon} name="check" size=${14} stroke=${3.2} />`}</span>`}
                <${DocThumb} item=${it} folder=${folder} label=${label} tone=${tone} grid=${grid} thumb=${thumb} />
                <span class="doc-info"><span class="doc-name">${it.name}</span>
                  <span class="muted small">${folder ? 'Thư mục' : fmtBytes(it.file_size)}</span></span>
              </button>
              ${!selectMode && !isDel && html`<button class="icon-btn doc-more" aria-label="Tùy chọn" onClick=${() => menu(it)}><${Icon} name="more" /></button>`}
            </div>`;
          })}
        </div>`}
    ${dragging && html`<div class="drop-hint"><${Icon} name="upload" size=${40} /> Thả tệp để tải lên</div>`}
  </div>`;
}
