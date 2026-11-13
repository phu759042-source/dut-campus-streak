// "Đánh giá ứng dụng": 1–5 stars and optional feedback, one per account (it can be changed later, like a store
// review). Asked on the home page and in the 3D map's server mode, and always reachable from the profile page.
// Stored through the submit_rating / my_rating RPCs; the owner reads them on /admin.
import { html, useState, useEffect } from 'preact';
import { supabase, appStore, errMsg, readLocal, writeLocal } from './lib.js';
import { openSheet, toast } from './ui.js';

export const STAR_LABELS = ['', 'Rất tệ', 'Chưa tốt', 'Tạm được', 'Tốt', 'Tuyệt vời'];
const SNOOZE_DAYS = 4;

const uid = () => appStore.get().session?.user?.id || null;
const ratedKey = () => 'cs-rated-' + uid();
let mine; // undefined: not loaded, null: not rated yet, { stars, comment }

/** Your rating (null when you have not rated). Cached for the tab. */
export async function loadMyRating() {
  if (mine !== undefined) return mine;
  const { data, error } = await supabase.rpc('my_rating');
  if (error) throw error;
  mine = data || null;
  if (mine) writeLocal(ratedKey(), String(mine.stars));
  return mine;
}

/** Whether to ask now: signed in, not rated, not snoozed. `minAgeH`: account age in hours before asking. */
export async function shouldAskRating(minAgeH = 0) {
  const s = appStore.get().session;
  if (!s) return false;
  if (readLocal(ratedKey())) return false;
  const later = +readLocal('cs-rate-later') || 0;
  if (Date.now() - later < SNOOZE_DAYS * 864e5) return false;
  const age = (Date.now() - new Date(s.user.created_at).getTime()) / 36e5;
  if (age < minAgeH) return false;
  try { return !(await loadMyRating()); } catch { return false; }
}
export function snoozeRating() { writeLocal('cs-rate-later', String(Date.now())); }

/** Five stars; read-only when onPick is missing. */
export function Stars({ value = 0, size = 30, onPick, hover: h0 }) {
  const [hover, setHover] = useState(0);
  const shown = hover || h0 || value;
  return html`<span class=${'stars' + (onPick ? ' pick' : '')} style=${`--s:${size}px`} onMouseLeave=${() => setHover(0)} role=${onPick ? 'radiogroup' : 'img'}
    aria-label=${onPick ? 'Chọn số sao' : `${value} trên 5 sao`}>
    ${[1, 2, 3, 4, 5].map((i) => onPick
      ? html`<button type="button" class=${'star' + (i <= shown ? ' on' : '')} role="radio" aria-checked=${i === value} aria-label=${`${i} sao: ${STAR_LABELS[i]}`}
          onMouseEnter=${() => setHover(i)} onClick=${() => onPick(i)}>★</button>`
      : html`<span class=${'star' + (i <= Math.round(shown) ? ' on' : '')}>★</span>`)}
  </span>`;
}

function RatingSheet({ close, initial, source, edit }) {
  const [stars, setStars] = useState(initial?.stars || 0);
  const [text, setText] = useState(initial?.comment || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { // fill in your earlier rating when the sheet opened before it was loaded
    if (initial) return;
    loadMyRating().then((r) => { if (r) { setStars((s) => s || r.stars); setText((t) => t || r.comment || ''); } }, () => {});
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (!stars) return;
    setBusy(true);
    const { error } = await supabase.rpc('submit_rating', { p_stars: stars, p_comment: text.trim() || null, p_source: source });
    setBusy(false);
    if (error) { toast(errMsg(error), 'error'); return; }
    mine = { stars, comment: text.trim() || null };
    writeLocal(ratedKey(), String(stars));
    toast(stars >= 4 ? 'Cảm ơn bạn đã đánh giá! 💙' : 'Cảm ơn bạn! Mình sẽ cố gắng cải thiện.', 'success', 3200);
    close(mine);
  }
  return html`<form class="rate-sheet" onSubmit=${submit}>
    <p class="muted">Bạn thấy DUT Campus Streak thế nào? Mỗi đánh giá đều được tác giả đọc.</p>
    <div class="rate-stars"><${Stars} value=${stars} size=${40} onPick=${setStars} /></div>
    <div class="rate-label">${stars ? STAR_LABELS[stars] : 'Chạm vào sao để chọn'}</div>
    <textarea class="input rate-text" rows="4" maxLength="1000" value=${text} onInput=${(e) => setText(e.target.value)}
      placeholder=${stars && stars <= 3 ? 'Điều gì làm bạn chưa hài lòng? Gặp lỗi ở đâu? (không bắt buộc)' : 'Bạn thích gì, muốn có thêm tính năng gì? (không bắt buộc)'}></textarea>
    <div class="muted small rate-count">${text.length}/1000</div>
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" onClick=${() => close(null)}>Để sau</button>
      <button class="btn btn-primary" disabled=${!stars || busy}>${busy ? 'Đang gửi…' : edit ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}</button>
    </div>
  </form>`;
}

/** Opens the rating sheet (optionally with stars already picked). Resolves with the saved rating, or null. */
export async function openRating(source = 'app', stars = 0) {
  let initial = null;
  try { initial = await loadMyRating(); } catch { /* fill in later */ }
  const edit = !!initial;
  if (stars) initial = { ...(initial || {}), stars };
  const r = await openSheet(({ close }) => html`<${RatingSheet} close=${close} initial=${initial} source=${source} edit=${edit} />`, { title: 'Đánh giá ứng dụng' });
  if (!r) snoozeRating();
  return r;
}

/** Card on the home page asking for a rating (from the day after signing up). */
export function RatePrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => { let on = true; shouldAskRating(20).then((v) => on && setShow(v)); return () => { on = false; }; }, []);
  if (!show) return null;
  return html`<section class="rate-card pop-in">
    <div class="grow">
      <b>Bạn thấy DUT Campus Streak thế nào?</b>
      <div class="small">Chạm vào số sao, góp ý thêm nếu muốn. Mất chưa tới 10 giây!</div>
      <div class="rate-card-stars"><${Stars} size=${32} onPick=${async (s) => { setShow(false); await openRating('app', s); }} /></div>
    </div>
    <button class="icon-btn rate-x" aria-label="Để sau" onClick=${() => { snoozeRating(); setShow(false); }}>✕</button>
  </section>`;
}
