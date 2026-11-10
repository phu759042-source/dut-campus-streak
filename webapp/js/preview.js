// Document previews.
// renderThumbnail(blob, item) turns a file into a small JPEG (stored once by thumbs.js):
//   images -> scaled down; PDF -> first page (pdf.js); docx/pptx/xlsx -> embedded thumbnail or first lines;
//   txt/csv -> first lines drawn on a "paper" card.
// getPreview() is the older on-the-fly path, still used on shared-link pages when no stored thumbnail exists.
import { supabase } from './lib.js';

const BUCKET = 'student-documents';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
const MAX_BYTES = 25 * 1024 * 1024;
export const THUMB_W = 360;

const cache = new Map(); // key -> Promise<preview|null>
let pdfjsPromise = null;
let zipPromise = null;

// Small queue so a folder of 30 files doesn't process everything at once.
let running = 0;
const waiting = [];
export function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++;
      fn().then(resolve, reject).finally(() => { running--; waiting.shift()?.(); });
    };
    if (running < 2) run(); else waiting.push(run);
  });
}

export const extOf = (name) => (String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : '');

export function previewKind(item) {
  const e = extOf(item.name);
  const mime = String(item.mime_type || '');
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return 'image';
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['docx', 'pptx', 'xlsx'].includes(e)) return 'office';
  if (['txt', 'csv', 'md', 'json', 'log'].includes(e) || mime.startsWith('text/')) return 'text';
  return null;
}

async function download(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data; // Blob
}

export function loadPdfjs() {
  pdfjsPromise ??= import(PDFJS).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfjsPromise;
}

const toJpeg = (canvas, q = 0.8) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

async function pdfCanvas(blob, width) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent 'print' renders without requestAnimationFrame, so it also finishes in background tabs.
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    return { canvas, pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

const xmlText = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** { type:'image', blob } | { type:'text', title, text } | null */
async function officeContent(blob, ext) {
  zipPromise ??= import(JSZIP).then((m) => m.default || m);
  const JSZip = await zipPromise;
  const zip = await JSZip.loadAsync(blob);
  const thumb = zip.file(/^docProps\/thumbnail\.(jpe?g|png)$/i)[0];
  if (thumb) {
    const data = await thumb.async('blob');
    const type = thumb.name.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg';
    return { type: 'image', blob: new Blob([data], { type }) };
  }
  let lines = [];
  if (ext === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string');
    if (xml) lines = xml.split(/<\/w:p>/).map((p) => xmlText(p, 'w:t').join('')).filter((l) => l.trim());
  } else if (ext === 'pptx') {
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (xml) lines = xml.split(/<\/a:p>/).map((p) => xmlText(p, 'a:t').join('')).filter((l) => l.trim());
  } else if (ext === 'xlsx') {
    const xml = await zip.file('xl/sharedStrings.xml')?.async('string');
    if (xml) lines = xmlText(xml, 't');
  }
  if (!lines.length) return null;
  return { type: 'text', title: decode(lines[0]).slice(0, 120), text: lines.slice(1, 18).map(decode).join('\n').slice(0, 900) };
}

async function textContent(blob) {
  const text = (await blob.slice(0, 4096).text()).replace(/\r/g, '');
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  return { type: 'text', title: lines[0].slice(0, 120), text: lines.slice(1, 20).join('\n').slice(0, 900) };
}

/** Draw a text preview as a white "page" (so text files also get an image thumbnail). */
function paperCanvas(title, text) {
  const W = THUMB_W, H = Math.round(THUMB_W * 1.33);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const font = '"Be Vietnam Pro", system-ui, sans-serif';
  const wrap = (s, max, size, weight) => {
    ctx.font = `${weight} ${size}px ${font}`;
    const out = [];
    for (const para of String(s).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const t = line ? `${line} ${w}` : w;
        if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  let y = 34;
  ctx.fillStyle = '#1d2433';
  for (const l of wrap(title, W - 40, 19, 800).slice(0, 3)) { ctx.font = `800 19px ${font}`; ctx.fillText(l, 20, y); y += 26; }
  y += 6;
  ctx.fillStyle = '#5b6476';
  for (const l of wrap(text, W - 40, 13, 500)) {
    if (y > H - 16) break;
    ctx.font = `500 13px ${font}`; ctx.fillText(l, 20, y); y += 19;
  }
  return canvas;
}

async function scaledCanvas(blob, width) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, width / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Small JPEG thumbnail for a file, or null when the type has no preview. */
export async function renderThumbnail(blob, item) {
  const kind = previewKind(item);
  if (!kind || blob.size > MAX_BYTES) return null;
  await document.fonts?.load?.('800 19px "Be Vietnam Pro"').catch(() => {});
  if (kind === 'image') return toJpeg(await scaledCanvas(blob, THUMB_W));
  if (kind === 'pdf') return toJpeg((await pdfCanvas(blob, THUMB_W)).canvas);
  const c = kind === 'office' ? await officeContent(blob, extOf(item.name)) : await textContent(blob);
  if (!c) return null;
  if (c.type === 'image') return toJpeg(await scaledCanvas(c.blob, THUMB_W));
  return toJpeg(paperCanvas(c.title, c.text), 0.85);
}

/**
 * On-the-fly preview (no storing). Returns a cached promise of { type: 'image', url } | null.
 * Used on shared-link pages for files that have no stored thumbnail yet.
 */
export function getPreview(item, { fetchBlob, key } = {}) {
  const k = key || item.storage_path;
  if (!k || !previewKind(item) || (item.file_size || 0) > MAX_BYTES) return Promise.resolve(null);
  if (!cache.has(k)) {
    cache.set(k, limit(async () => {
      try {
        const blob = fetchBlob ? await fetchBlob(item) : await download(item.storage_path);
        const jpg = await renderThumbnail(blob, item);
        return jpg ? { type: 'image', url: URL.createObjectURL(jpg) } : null;
      } catch (e) {
        console.warn('preview failed', item.name, e);
        cache.delete(k); // allow a retry later
        return null;
      }
    }));
  }
  return cache.get(k);
}
