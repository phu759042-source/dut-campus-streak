// Stored thumbnails for Documents.
// Each previewable file gets a small JPEG at student-documents/<uid>/thumbs/<documentId>.jpg:
//   - made from the local file right after upload (no download needed),
//   - or made once, the first time an older file shows up in a list (one download, then never again).
// Lists then load only these ~20-40 KB images instead of whole PDFs/Word files.
// Signed URLs for thumbnails are reused for days (kept in localStorage) so the browser cache hits.
import { supabase, hideStorageUrl, readLocal, writeLocal } from './lib.js';
import { renderThumbnail, previewKind, limit } from './preview.js';

const BUCKET = 'student-documents';
const URL_TTL = 7 * 86400; // seconds
const URL_KEY = 'cs-thumb-urls';
export const thumbPath = (uid, docId) => `${uid}/thumbs/${docId}.jpg`;

// ---------- which thumbnails exist (one listing per owner per session) ----------
const indexes = new Map(); // uid -> Promise<Set<docId>>
export function thumbIndex(uid) {
  if (!indexes.has(uid)) {
    indexes.set(uid, (async () => {
      const set = new Set();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.storage.from(BUCKET).list(`${uid}/thumbs`, { limit: 1000, offset });
        if (error) throw error;
        for (const f of data || []) if (f.name.endsWith('.jpg')) set.add(f.name.slice(0, -4));
        if (!data || data.length < 1000) break;
      }
      return set;
    })().catch((e) => { indexes.delete(uid); console.warn('thumb index', e); return new Set(); }));
  }
  return indexes.get(uid);
}

// ---------- signed URL cache ----------
function readUrlCache() {
  try { return JSON.parse(readLocal(URL_KEY) || '{}'); } catch { return {}; }
}
function writeUrlCache(c) {
  const now = Date.now();
  for (const [k, v] of Object.entries(c)) if (v.e < now) delete c[k];
  try { writeLocal(URL_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

/** { docId: url } for the given documents that have a stored thumbnail. */
export async function thumbUrlsFor(uid, ids) {
  const have = await thumbIndex(uid);
  const want = ids.filter((id) => have.has(id));
  if (!want.length) return {};
  const cache = readUrlCache();
  const now = Date.now();
  const out = {};
  const missing = [];
  for (const id of want) {
    const hit = cache[thumbPath(uid, id)];
    if (hit && hit.e - now > 86400e3) out[id] = hit.u; else missing.push(id);
  }
  for (let k = 0; k < missing.length; k += 100) {
    const chunk = missing.slice(k, k + 100);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(chunk.map((id) => thumbPath(uid, id)), URL_TTL);
    (data || []).forEach((s, i) => {
      if (!s.signedUrl) return;
      const u = hideStorageUrl(s.signedUrl);
      out[chunk[i]] = u;
      cache[thumbPath(uid, chunk[i])] = { u, e: now + URL_TTL * 1000 };
    });
  }
  writeUrlCache(cache);
  return out;
}

async function storeThumb(uid, docId, jpg) {
  const path = thumbPath(uid, docId);
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, jpg, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  (await thumbIndex(uid)).add(docId);
  const cache = readUrlCache();
  delete cache[path];
  writeUrlCache(cache);
}

/** After an upload: build the thumbnail from the local file (no network download). */
export async function createThumbFromFile(uid, docId, item, file) {
  try {
    if (!previewKind(item)) return;
    const jpg = await limit(() => renderThumbnail(file, item));
    if (jpg) await storeThumb(uid, docId, jpg);
  } catch (e) {
    console.warn('thumb after upload', e);
  }
}

/** For an older file without a thumbnail: download once, store, return its URL (or null). */
const pending = new Map();
export function ensureThumb(uid, item) {
  if (!previewKind(item) || !item.storage_path) return Promise.resolve(null);
  if (!pending.has(item.id)) {
    pending.set(item.id, (async () => {
      try {
        const have = await thumbIndex(uid);
        if (!have.has(item.id)) {
          const jpg = await limit(async () => {
            const { data, error } = await supabase.storage.from(BUCKET).download(item.storage_path);
            if (error) throw error;
            return renderThumbnail(data, item);
          });
          if (!jpg) return null;
          await storeThumb(uid, item.id, jpg);
        }
        return (await thumbUrlsFor(uid, [item.id]))[item.id] || null;
      } catch (e) {
        console.warn('ensure thumb', item.name, e);
        pending.delete(item.id); // retry next time
        return null;
      }
    })());
  }
  return pending.get(item.id);
}

/** Forget thumbnails of deleted documents (index + URL cache). */
export async function forgetThumbs(uid, ids) {
  const have = await thumbIndex(uid);
  const cache = readUrlCache();
  for (const id of ids) { have.delete(id); delete cache[thumbPath(uid, id)]; }
  writeUrlCache(cache);
}
