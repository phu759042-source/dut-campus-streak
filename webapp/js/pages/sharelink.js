// Public page for a shared folder/file: /s/<token>. Works without logging in.
import { html, useState, useEffect, useRef } from 'preact';
import { supabase, invokeFunction, fmtBytes, appStore } from '../lib.js';
import { Icon, Avatar, Spinner, Skeleton, Empty, toast } from '../ui.js';
import { navigate } from '../router.js';
import { DocThumb, fileTone } from './documents.js';
import { previewKind, getPreview } from '../preview.js';
import { InstallButton } from '../install.js';
import { openViewer } from '../viewer.js';
import { hideStorageUrl } from '../lib.js';
import { zipStore, downloadZip, ZipPanel } from '../zipdownload.js';

async function call(body) {
  const res = await invokeFunction('shared-documents', body);
  if (!res.ok) throw new Error(res.data?.error || 'Không mở được link chia sẻ.');
  return res.data;
}

export function SharedLinkPage({ token }) {
  const [folderId, setFolderId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [busyId, setBusyId] = useState(null);
  const loggedIn = !!appStore.get().session;
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const press = useRef({ timer: null, fired: false, x: 0, y: 0 });
  const [zip, setZip] = useState(zipStore.get().job);
  useEffect(() => { const u = zipStore.subscribe((s) => setZip(s.job)); setZip(zipStore.get().job); return u; }, []);
  const zipping = !!zip && ['scan', 'fetch', 'pack'].includes(zip.phase);

  // Signed URL cache for this page (valid 10 minutes on the server; refresh after 8).
  const urlCache = useState(() => new Map())[0];
  async function urlsFor(ids, download = false) {
    const need = ids.filter((id) => download || !urlCache.has(id) || Date.now() - urlCache.get(id).at > 8 * 60e3);
    if (need.length) {
      const { urls } = await call({ action: 'urls', token, ids: need, download });
      if (download) return urls;
      for (const [id, url] of Object.entries(urls)) urlCache.set(id, { url, at: Date.now() });
    }
    return Object.fromEntries(ids.filter((id) => urlCache.has(id)).map((id) => [id, urlCache.get(id).url]));
  }

  async function load() {
    setError(null); setData(null); setThumbs({});
    try {
      const d = await call({ action: 'list', token, folder_id: folderId || undefined });
      setData(d);
      document.title = `${d.root.name} · Chia sẻ từ ${d.owner.display_name}`;
      // Stored thumbnails (small images); files without one are rendered on the fly when visible.
      const fileIds = d.items.filter((it) => it.item_type === 'file' && previewKind(it)).map((it) => it.id);
      if (fileIds.length) {
        const { urls } = await call({ action: 'thumbs', token, ids: fileIds }).catch(() => ({ urls: {} }));
        setThumbs(Object.fromEntries(Object.entries(urls || {}).map(([k, v]) => [k, hideStorageUrl(v)])));
      }
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); setSelectMode(false); setSelected(new Set()); }, [folderId]);
  useEffect(() => () => { document.title = 'DUT Campus Streak'; }, []);

  const previewOpts = (it) => ({
    key: `share:${token}:${it.id}`,
    fetchBlob: async () => {
      const urls = await urlsFor([it.id]);
      const r = await fetch(urls[it.id]);
      if (!r.ok) throw new Error('download failed');
      return r.blob();
    },
  });

  function view(it) {
    openViewer(it, async (download) => (await urlsFor([it.id], download))[it.id], { canDownload: !!data?.share.allow_download });
  }
  async function download(it) {
    setBusyId(it.id);
    try {
      const urls = await urlsFor([it.id], true);
      const a = document.createElement('a'); a.href = hideStorageUrl(urls[it.id]); a.download = it.name; a.click();
    } catch (e) { toast(e.message, 'error'); }
    setBusyId(null);
  }

  // ---------- multi-select + ZIP ----------
  const canDl = !!data?.share.allow_download;
  const items = data?.items || [];
  const isFolderShare = data?.root.item_type === 'folder';
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
  const allSelected = items.length > 0 && selected.size === items.length;
  const pressHandlers = (it) => (!canDl || !isFolderShare ? {} : {
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
    if (press.current.fired) { press.current.fired = false; return; }
    if (selectMode) return toggle(it);
    if ((e.ctrlKey || e.metaKey) && canDl && isFolderShare) return startSelect(it);
    if (it.item_type === 'folder') setFolderId(it.id); else view(it);
  }
  const listFolder = async (id) => (await call({ action: 'list', token, folder_id: id })).items;
  const signUrls = async (ids) => (await call({ action: 'urls', token, ids, download: true })).urls || {};
  const here = () => data.path[data.path.length - 1].name;
  function zipItems(list, name) {
    if (zipping) return toast('Đang tải một file ZIP khác, đợi xong nhé.', 'info');
    // A single file needs no zip.
    if (list.length === 1 && list[0].item_type === 'file') { download(list[0]); exitSelect(); return; }
    downloadZip({ items: list, zipName: name, listFolder, signUrls });
    exitSelect();
  }
  const downloadSelected = () => {
    const chosen = items.filter((x) => selected.has(x.id));
    zipItems(chosen, allSelected ? here() : `${here()} (${chosen.length} mục)`);
  };

  const brand = html`<a class="share-brand" href="/" onClick=${(e) => { e.preventDefault(); navigate(loggedIn ? '/' : '/login'); }}>
    <img src="/icon-96.png" alt="" width="34" height="34" /><span>Campus<b>Streak</b></span></a>`;
  const top = html`<div class="share-top">${brand}<${InstallButton} /></div>`;

  if (error) return html`<div class="share-page"><div class="page narrow">${top}
    <${Empty} icon="ban" title="Không mở được link" text=${error}>
      <button class="btn btn-primary" onClick=${() => navigate(loggedIn ? '/' : '/login')}>Về Campus Streak</button><//></div></div>`;

  return html`<div class="share-page"><div class="page">
    ${top}
    ${!data ? html`<${Skeleton} h=${120} r=${24} /><${Skeleton} h=${170} count=${2} />` : html`
      <section class="share-hero pop-in">
        <${Avatar} url=${data.owner.avatar_url} name=${data.owner.display_name} size=${52} ring />
        <div class="grow">
          <div class="small share-kicker"><b>${data.owner.display_name}</b> đã chia sẻ với bạn</div>
          <h1 class="share-title">${data.root.item_type === 'folder' ? '📁 ' : '📄 '}${data.root.name}</h1>
          <div class="small share-kicker">${data.share.allow_download ? 'Xem và tải về' : 'Chỉ xem, không tải về'}</div>
        </div>
      </section>
      ${data.path.length > 1 && html`<div class="crumbs">
        ${data.path.map((p, i) => html`${i > 0 && html`<span class="crumb-sep">›</span>`}
          <button class=${i === data.path.length - 1 ? 'active' : ''} onClick=${() => setFolderId(i === 0 ? null : p.id)}>${i === 0 ? html`<${Icon} name="folder" size=${15} /> ` : ''}${p.name}</button>`)}
      </div>`}
      ${canDl && isFolderShare && items.length > 0 && (selectMode ? html`<div class="select-bar pop-in">
          <button class="icon-btn" aria-label="Thoát chọn" onClick=${exitSelect}><${Icon} name="x" size=${20} /></button>
          <b class="grow">${selected.size ? `Đã chọn ${selected.size}` : 'Chạm để chọn'}</b>
          <button class="btn btn-ghost btn-sm" onClick=${() => setSelected(allSelected ? new Set() : new Set(items.map((x) => x.id)))}>${allSelected ? 'Bỏ chọn' : 'Tất cả'}</button>
          <button class="btn btn-primary btn-sm" disabled=${!selected.size || zipping} onClick=${downloadSelected}><${Icon} name="download" size=${16} /> Tải về</button>
        </div>` : html`<div class="row gap wrap share-actions">
          <button class="btn btn-primary btn-sm" disabled=${zipping} onClick=${() => zipItems(items, here())}><${Icon} name="download" size=${18} /> Tải tất cả (.zip)</button>
          <button class="btn btn-ghost btn-sm" onClick=${() => setSelectMode(true)}><${Icon} name="checkCircle" size=${16} /> Chọn nhiều</button>
          <span class="muted small share-hint">Mẹo: nhấn giữ một mục để chọn nhanh.</span>
        </div>`)}
      <${ZipPanel} job=${zip} />
      ${!data.items.length ? html`<${Empty} icon="folder" title="Thư mục trống" />` : html`<div class="doc-grid share-grid">
        ${data.items.map((it, i) => {
          const folder = it.item_type === 'folder';
          const [label, tone] = folder ? ['', 'amber'] : fileTone(it.name);
          const isSel = selected.has(it.id);
          return html`<div key=${it.id} class=${'doc slide-up' + (selectMode ? ' selecting' : '') + (isSel ? ' selected' : '')} style=${`--d:${Math.min(i, 15) * 30}ms`}>
            <button class="doc-main" onClick=${(e) => onTileClick(e, it)} ...${pressHandlers(it)}>
              ${selectMode && html`<span class=${'doc-check' + (isSel ? ' on' : '')}>${isSel && html`<${Icon} name="check" size=${14} stroke=${3.2} />`}</span>`}
              <${DocThumb} item=${it} folder=${folder} label=${label} tone=${tone} grid=${true} thumb=${thumbs[it.id]} loadThumb=${folder ? null : () => getPreview(it, previewOpts(it))} />
              <span class="doc-info"><span class="doc-name">${it.name}</span>
                <span class="muted small">${folder ? 'Thư mục' : fmtBytes(it.file_size)}</span></span>
            </button>
            ${!folder && canDl && !selectMode && html`<button class="icon-btn doc-more" aria-label="Tải về" title="Tải về" onClick=${() => download(it)}>
              ${busyId === it.id ? html`<${Spinner} size=${16} />` : html`<${Icon} name="download" size=${18} />`}</button>`}
          </div>`;
        })}
      </div>`}
      <div class="share-cta muted small">Lưu tài liệu, theo dõi deadline và giữ lửa đi học cùng
        <a class="link" href="/" onClick=${(e) => { e.preventDefault(); navigate(loggedIn ? '/' : '/register'); }}>DUT Campus Streak</a>.</div>
    `}
  </div></div>`;
}
