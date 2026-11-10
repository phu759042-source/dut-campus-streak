// Document previews for the Documents page.
// PDF: first page rendered with pdf.js. Office (docx/pptx/xlsx): embedded thumbnail if the file has one,
// otherwise the first lines of text. Text files: the first lines. Results are cached for the session.
import { supabase } from './lib.js';

const BUCKET = 'student-documents';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
const MAX_BYTES = 15 * 1024 * 1024;

const cache = new Map(); // storage_path -> Promise<preview|null>
let pdfjsPromise = null;
let zipPromise = null;

// Small queue so a folder of 30 PDFs doesn't download everything at once.
let running = 0;
const waiting = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++;
      fn().then(resolve, reject).finally(() => { running--; waiting.shift()?.(); });
    };
    if (running < 3) run(); else waiting.push(run);
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

function loadPdfjs() {
  pdfjsPromise ??= import(PDFJS).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfjsPromise;
}

async function pdfPreview(blob) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = 420 / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent 'print' renders without requestAnimationFrame, so it also finishes in background tabs.
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return { type: 'image', url: URL.createObjectURL(out), pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

const xmlText = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function officePreview(blob, ext) {
  zipPromise ??= import(JSZIP).then((m) => m.default || m);
  const JSZip = await zipPromise;
  const zip = await JSZip.loadAsync(blob);
  const thumb = zip.file(/^docProps\/thumbnail\.(jpe?g|png)$/i)[0];
  if (thumb) {
    const data = await thumb.async('blob');
    const type = thumb.name.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg';
    return { type: 'image', url: URL.createObjectURL(new Blob([data], { type })) };
  }
  let lines = [];
  if (ext === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string');
    if (xml) {
      lines = xml.split(/<\/w:p>/).map((p) => xmlText(p, 'w:t').join('')).filter((l) => l.trim());
    }
  } else if (ext === 'pptx') {
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (xml) lines = xml.split(/<\/a:p>/).map((p) => xmlText(p, 'a:t').join('')).filter((l) => l.trim());
  } else if (ext === 'xlsx') {
    const xml = await zip.file('xl/sharedStrings.xml')?.async('string');
    if (xml) lines = xmlText(xml, 't');
  }
  if (!lines.length) return null;
  return { type: 'text', title: decode(lines[0]).slice(0, 120), text: lines.slice(1, 14).map(decode).join('\n').slice(0, 700) };
}

async function textPreview(blob) {
  const text = (await blob.slice(0, 4096).text()).replace(/\r/g, '');
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  return { type: 'text', title: lines[0].slice(0, 120), text: lines.slice(1, 16).join('\n').slice(0, 700) };
}

/** Returns a cached promise (optionally with a custom downloader for shared links) of { type: 'image', url } | { type: 'text', title, text } | null. */
export function getPreview(item, { fetchBlob, key } = {}) {
  const path = key || item.storage_path;
  const kind = previewKind(item);
  if (!path || !kind || kind === 'image') return Promise.resolve(null);
  if ((item.file_size || 0) > MAX_BYTES) return Promise.resolve(null);
  if (!cache.has(path)) {
    cache.set(path, limit(async () => {
      try {
        const blob = fetchBlob ? await fetchBlob(item) : await download(item.storage_path);
        if (kind === 'pdf') return await pdfPreview(blob);
        if (kind === 'office') return await officePreview(blob, extOf(item.name));
        if (kind === 'text') return await textPreview(blob);
      } catch (e) {
        console.warn('preview failed', item.name, e);
        cache.delete(path); // allow a retry later (e.g. after a network hiccup)
      }
      return null;
    }));
  }
  return cache.get(path);
}
