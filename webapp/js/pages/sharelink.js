// Public page for a shared folder/file: /s/<token>. Works without logging in.
import { html, useState, useEffect } from 'preact';
import { supabase, invokeFunction, fmtBytes, appStore } from '../lib.js';
import { Icon, Avatar, Spinner, Skeleton, Empty, toast } from '../ui.js';
import { navigate } from '../router.js';
import { DocThumb, fileTone } from './documents.js';
import { previewKind } from '../preview.js';

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
      const imgs = d.items.filter((it) => it.item_type === 'file' && previewKind(it) === 'image').map((it) => it.id);
      if (imgs.length) setThumbs(await urlsFor(imgs));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [folderId]);
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

  async function view(it) {
    const win = window.open('', '_blank');
    try {
      const urls = await urlsFor([it.id]);
      if (win) win.location = urls[it.id]; else location.href = urls[it.id];
    } catch (e) { win?.close(); toast(e.message, 'error'); }
  }
  async function download(it) {
    setBusyId(it.id);
    try {
      const urls = await urlsFor([it.id], true);
      const a = document.createElement('a'); a.href = urls[it.id]; a.download = it.name; a.click();
    } catch (e) { toast(e.message, 'error'); }
    setBusyId(null);
  }

  const brand = html`<a class="share-brand" href="/" onClick=${(e) => { e.preventDefault(); navigate(loggedIn ? '/' : '/login'); }}>
    <img src="/icon-96.png" alt="" width="34" height="34" /><span>Campus<b>Streak</b></span></a>`;

  if (error) return html`<div class="share-page"><div class="page narrow">${brand}
    <${Empty} icon="ban" title="Không mở được link" text=${error}>
      <button class="btn btn-primary" onClick=${() => navigate(loggedIn ? '/' : '/login')}>Về Campus Streak</button><//></div></div>`;

  return html`<div class="share-page"><div class="page">
    ${brand}
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
      ${!data.items.length ? html`<${Empty} icon="folder" title="Thư mục trống" />` : html`<div class="doc-grid share-grid">
        ${data.items.map((it, i) => {
          const folder = it.item_type === 'folder';
          const [label, tone] = folder ? ['', 'amber'] : fileTone(it.name);
          return html`<div key=${it.id} class="doc slide-up" style=${`--d:${Math.min(i, 15) * 30}ms`}>
            <button class="doc-main" onClick=${() => (folder ? setFolderId(it.id) : view(it))}>
              <${DocThumb} item=${it} folder=${folder} label=${label} tone=${tone} grid=${true} thumb=${thumbs[it.id]} previewOpts=${folder ? null : previewOpts(it)} />
              <span class="doc-info"><span class="doc-name">${it.name}</span>
                <span class="muted small">${folder ? 'Thư mục' : fmtBytes(it.file_size)}</span></span>
            </button>
            ${!folder && data.share.allow_download && html`<button class="icon-btn doc-more" aria-label="Tải về" title="Tải về" onClick=${() => download(it)}>
              ${busyId === it.id ? html`<${Spinner} size=${16} />` : html`<${Icon} name="download" size=${18} />`}</button>`}
          </div>`;
        })}
      </div>`}
      <div class="share-cta muted small">Lưu tài liệu, theo dõi deadline và giữ lửa đi học cùng
        <a class="link" href="/" onClick=${(e) => { e.preventDefault(); navigate(loggedIn ? '/' : '/register'); }}>DUT Campus Streak</a>.</div>
    `}
  </div></div>`;
}
