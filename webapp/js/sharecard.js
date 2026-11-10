// Draws the link-preview card (1200x630) for a share link in the owner's browser and uploads it to
// profile-banners/<uid>/share-cards/<token>.jpg (public). The /s/<token> page points og:image at it.
import { supabase, currentUser, loadImage, canvasToBlob, fmtBytes } from './lib.js';

const W = 1200, H = 630;
const EXT_COLORS = {
  PDF: '#e5372b', DOC: '#2b6cf0', DOCX: '#2b6cf0', XLS: '#0f9d58', XLSX: '#0f9d58', CSV: '#0f9d58',
  PPT: '#e8710a', PPTX: '#e8710a', PNG: '#7c4dff', JPG: '#7c4dff', JPEG: '#7c4dff', ZIP: '#667085',
};
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Split text into at most `maxLines` lines that fit `width`, adding … when cut. */
function wrap(ctx, text, width, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= width) { line = test; continue; }
    if (line) lines.push(line);
    line = words[i];
    while (ctx.measureText(line).width > width) { // a single very long word
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(' ').replace(/\s+/g, ' ').length;
  if (used < text.replace(/\s+/g, ' ').length) {
    let last = lines[maxLines - 1] || lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[lines.length - 1] = last.trimEnd() + '…';
  }
  return lines.slice(0, maxLines);
}

function drawFolder(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffc44d';
  roundRect(ctx, x + 8, y, 110, 50, 18); ctx.fill();
  const g = ctx.createLinearGradient(x, y + 34, x + 240, y + 230);
  g.addColorStop(0, '#ffd66b'); g.addColorStop(1, '#f59f00');
  ctx.fillStyle = g;
  roundRect(ctx, x, y + 34, 250, 196, 26); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, x + 22, y + 60, 206, 10, 5); ctx.fill();
}

function drawFile(ctx, x, y, ext) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, 200, 250, 24); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#d9deea';
  [1, 0.8, 0.9, 0.6].forEach((w, i) => { roundRect(ctx, x + 36, y + 40 + i * 26, 128 * w, 11, 5); ctx.fill(); });
  const label = (ext || 'FILE').slice(0, 4);
  ctx.font = `800 36px ${FONT}`;
  const lw = ctx.measureText(label).width + 40;
  ctx.fillStyle = EXT_COLORS[label] || '#667085';
  roundRect(ctx, x + 100 - lw / 2, y + 168, lw, 54, 14); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 100, y + 196);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/** item: documents row; owner: display name. Returns a JPEG Blob. */
export async function drawShareCard(item, owner) {
  await Promise.all([document.fonts.load(`800 72px ${FONT}`), document.fonts.load(`600 32px ${FONT}`)]).catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b2a8f'); bg.addColorStop(0.55, '#3a24c4'); bg.addColorStop(1, '#7a1fd0');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // soft glows + grid, matching the site banner
  const glow = (x, y, r, c) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  glow(1080, 40, 380, 'rgba(255,140,30,0.35)');
  glow(80, 640, 420, 'rgba(60,130,255,0.35)');
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // header
  try { ctx.drawImage(await loadImage('/icon-96.png'), 70, 52, 58, 58); } catch { /* optional */ }
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText('Campus Streak · Chia sẻ tài liệu', 146, 92);

  // icon
  const folder = item.item_type === 'folder';
  const ext = folder ? '' : (item.name.includes('.') ? item.name.split('.').pop().toUpperCase() : '');
  if (folder) drawFolder(ctx, 80, 196); else drawFile(ctx, 105, 186, ext);

  // text
  const tx = 410, tw = W - tx - 70;
  ctx.fillStyle = '#ffd166';
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText(wrap(ctx, `${owner} đã chia sẻ với bạn`, tw, 1)[0], tx, 232);
  const title = folder ? item.name : item.name.replace(/\.[^.]+$/, '');
  let size = 70;
  ctx.font = `800 ${size}px ${FONT}`;
  let lines = wrap(ctx, title, tw, 2);
  if (lines.length > 1) { size = 58; ctx.font = `800 ${size}px ${FONT}`; lines = wrap(ctx, title, tw, 2); }
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, tx, 232 + 24 + size * 1.12 * (i + 1) - 10));
  const metaY = 232 + 24 + size * 1.12 * lines.length + 46;
  ctx.font = `600 32px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(folder ? 'Thư mục tài liệu' : [ext ? `Tệp ${ext}` : 'Tệp', fmtBytes(item.file_size)].filter(Boolean).join(' · '), tx, metaY);

  // footer
  const cta = 'Bấm để xem tài liệu  →';
  ctx.font = `600 28px ${FONT}`;
  const cw = ctx.measureText(cta).width + 56;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, 70, 520, cw, 62, 31); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillText(cta, 98, 561);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'right';
  ctx.fillText('campusstreak.com', W - 70, 561);
  ctx.textAlign = 'left';

  return canvasToBlob(canvas, 0.88);
}

/** Render and upload the card for a share. Never throws (the link still works without a card). */
export async function publishShareCard(share, item, owner) {
  try {
    const blob = await drawShareCard(item, owner);
    const path = `${currentUser().id}/share-cards/${share.token}.jpg`;
    const { error } = await supabase.storage.from('profile-banners')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '300' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('share card', e);
    return false;
  }
}
