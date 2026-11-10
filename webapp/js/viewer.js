// Full-screen in-app viewer for documents: images, PDFs (pdf.js), text files.
// Files are fetched through our own domain, so no Supabase address is ever shown.
import { html, useState, useEffect, useRef } from 'preact';
import { hideStorageUrl, fmtBytes } from './lib.js';
import { Icon, Spinner, openSheet, toast } from './ui.js';
import { loadPdfjs, previewKind, extOf } from './preview.js';

const MAX_TEXT = 200_000;

function ImageView({ url, name }) {
  const [zoom, setZoom] = useState(false);
  return html`<div class=${'viewer-img' + (zoom ? ' zoomed' : '')} onClick=${() => setZoom(!zoom)}>
    <img src=${url} alt=${name} />
  </div>`;
}

function PdfView({ url }) {
  const box = useRef();
  const [state, setState] = useState({ loading: true, pages: 0, error: null });
  useEffect(() => {
    let cancelled = false;
    let doc = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
        doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setState({ loading: false, pages: doc.numPages, error: null });
        const width = Math.min(box.current?.clientWidth || 800, 1100);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.className = 'pdf-page';
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          box.current?.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
        }
      } catch (e) {
        console.warn(e);
        if (!cancelled) setState({ loading: false, pages: 0, error: 'Không hiển thị được PDF này. Hãy tải về để xem.' });
      }
    })();
    return () => { cancelled = true; doc?.destroy(); };
  }, [url]);
  return html`<div class="viewer-pdf">
    ${state.loading && html`<div class="viewer-msg"><${Spinner} size=${28} /><div>Đang mở PDF…</div></div>`}
    ${state.error && html`<div class="viewer-msg">${state.error}</div>`}
    ${state.pages > 0 && html`<div class="muted small viewer-pages">${state.pages} trang</div>`}
    <div ref=${box} class="pdf-pages"></div>
  </div>`;
}

function TextView({ url }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    fetch(url).then((r) => r.text()).then((t) => setText(t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n…' : t))
      .catch(() => setText('Không đọc được tệp.'));
  }, [url]);
  return text === null ? html`<div class="viewer-msg"><${Spinner} size=${28} /></div>` : html`<pre class="viewer-text">${text}</pre>`;
}

function OtherView({ name, size, onDownload, url }) {
  return html`<div class="viewer-msg">
    <div class="viewer-ext">${(extOf(name) || 'FILE').toUpperCase()}</div>
    <div class="strong">${name}</div>
    <div class="muted small">${fmtBytes(size)} · Định dạng này chưa xem trực tiếp được trên web.</div>
    <div class="row gap center">
      ${onDownload && html`<button class="btn btn-primary" onClick=${onDownload}><${Icon} name="download" size=${18} /> Tải về</button>`}
      <a class="btn btn-ghost" href=${url} target="_blank" rel="noopener">Mở bằng trình duyệt</a>
    </div>
  </div>`;
}

/**
 * Open a file in the in-app viewer.
 * item: { name, mime_type, file_size }; getUrl(download:boolean) -> Promise<raw or proxied URL>.
 * canDownload: show the download button.
 */
export async function openViewer(item, getUrl, { canDownload = true } = {}) {
  let url;
  try { url = hideStorageUrl(await getUrl(false)); } catch (e) { return toast('Không mở được tệp: ' + (e.message || e), 'error'); }
  const kind = previewKind(item);
  async function download() {
    try {
      const href = hideStorageUrl(await getUrl(true));
      const a = document.createElement('a'); a.href = href; a.download = item.name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Không tải được: ' + (e.message || e), 'error'); }
  }
  await openSheet(({ close }) => html`<div class="viewer">
    <div class="viewer-bar">
      <button class="icon-btn" aria-label="Đóng" onClick=${() => close()}><${Icon} name="back" /></button>
      <div class="grow viewer-title"><b class="ellipsis">${item.name}</b><span class="muted small">${fmtBytes(item.file_size)}</span></div>
      ${canDownload && html`<button class="icon-btn" aria-label="Tải về" title="Tải về" onClick=${download}><${Icon} name="download" /></button>`}
    </div>
    <div class="viewer-body">
      ${kind === 'image' ? html`<${ImageView} url=${url} name=${item.name} />`
        : kind === 'pdf' ? html`<${PdfView} url=${url} />`
        : kind === 'text' ? html`<${TextView} url=${url} />`
        : html`<${OtherView} name=${item.name} size=${item.file_size} url=${url} onDownload=${canDownload ? download : null} />`}
    </div>
  </div>`, { full: true });
}
