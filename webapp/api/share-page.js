// Vercel Function behind /s/<token> (see vercel.json).
// Chat apps (Messenger, Zalo, Facebook...) don't run JavaScript, so this returns the normal app page
// with link-preview tags filled in for this share: who shared it, the folder/file name, and its card image.
// Browsers get the same page and the app takes over as usual.
const SUPABASE_URL = 'https://gmwurbvhhzgdikogxiqb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_i7IHac8LyrXoG3aiLDlS7A_1Vua8h8l'; // publishable key only
const SITE = 'https://www.campusstreak.com';
const FALLBACK_IMAGE = `${SITE}/og-image.jpg`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function getMeta(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // allow for an Edge Function cold start
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/shared-documents`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'meta', token }),
      signal: ctrl.signal,
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  const token = String((req.query && req.query.token) || '').toLowerCase();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.campusstreak.com';
  const [pageRes, meta] = await Promise.all([fetch(`https://${host}/index.html`), getMeta(token)]);
  let html = await pageRes.text();

  if (meta) {
    const folder = meta.item_type === 'folder';
    const kind = folder ? 'thư mục' : 'tài liệu';
    const title = `${meta.owner} chia sẻ ${kind} “${meta.name}”`;
    const parts = folder
      ? [meta.files ? `${meta.files} tệp` : '', meta.folders ? `${meta.folders} thư mục con` : ''].filter(Boolean)
      : [meta.name.includes('.') ? `Tệp ${meta.name.split('.').pop().toUpperCase()}` : 'Tệp', fmtBytes(meta.file_size)].filter(Boolean);
    const action = meta.allow_download ? 'Bấm để xem và tải về' : 'Bấm để xem';
    const description = `${parts.length ? parts.join(' · ') + ' · ' : ''}${action} trên DUT Campus Streak, không cần đăng nhập.`;
    const url = `${SITE}/s/${token}`;
    const image = meta.card_url || FALLBACK_IMAGE;

    // Drop the generic tags, then add the share-specific ones.
    html = html
      .replace(/^\s*<meta (property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\s*$/gm, '')
      .replace(/^\s*<link rel="canonical"[^>]*>\s*$/m, '')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} · Campus Streak</title>`)
      .replace('</title>', `</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="DUT Campus Streak" />
  <meta property="og:locale" content="vi_VN" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:secure_url" content="${esc(image)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short CDN cache: revoked links and renamed folders update within a few minutes.
  // Never cache a generic page for a share URL (e.g. Supabase was cold), so the next crawl retries.
  res.setHeader('Cache-Control', meta ? 'public, max-age=0, s-maxage=120, stale-while-revalidate=300' : 'no-store');
  res.statusCode = 200;
  res.end(html);
};
