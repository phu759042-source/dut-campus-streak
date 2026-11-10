// Daily mini games for the Home page. Scores are kept in this browser only.
import { html, useState, useEffect, useRef } from 'preact';
import { vnNow, readLocal, writeLocal } from './lib.js';
import { Icon, openSheet, confetti } from './ui.js';

// ------------------------------------------------------------------
// Scores
// ------------------------------------------------------------------
const today = () => vnNow().iso;
function getScore(id) {
  return {
    today: Number(readLocal(`cs-game-${id}-${today()}`)) || null,
    best: Number(readLocal(`cs-game-${id}-best`)) || null,
  };
}
/** Save a score; `lowerIsBetter` for time/moves based games. Returns true on a new daily record. */
function saveScore(id, value, lowerIsBetter = false) {
  const better = (a, b) => (b == null ? true : lowerIsBetter ? a < b : a > b);
  const s = getScore(id);
  let record = false;
  if (better(value, s.today)) { writeLocal(`cs-game-${id}-${today()}`, String(value)); record = true; }
  if (better(value, s.best)) writeLocal(`cs-game-${id}-best`, String(value));
  return record;
}

// Seeded random so the daily memory board is the same for everyone on a given day.
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function Result({ title, lines, onAgain, close, record }) {
  return html`<div class="game-result pop-in">
    <div class="game-result-emoji">${record ? '🏆' : '🎯'}</div>
    <div class="game-result-title">${title}</div>
    ${record && html`<div class="chip chip-success">Kỷ lục mới hôm nay!</div>`}
    ${lines.map((l) => html`<div class="muted">${l}</div>`)}
    <div class="dialog-actions">
      <button class="btn btn-ghost" onClick=${() => close()}>Đóng</button>
      <button class="btn btn-primary" onClick=${onAgain}>Chơi lại</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------
// 1. Lật thẻ (memory)
// ------------------------------------------------------------------
const EMOJI = ['📚', '🔥', '🎓', '🧪', '💻', '📐', '🧮', '🏀', '☕', '🎧', '🚲', '📝', '🔬', '🎨', '⚡', '🍜'];

function MemoryGame({ close }) {
  const [round, setRound] = useState(0);
  const [cards, setCards] = useState([]);
  const [open, setOpen] = useState([]);
  const [moves, setMoves] = useState(0);
  const [start, setStart] = useState(null);
  const [done, setDone] = useState(null);
  const lock = useRef(false);

  useEffect(() => {
    const rnd = seeded(`memory-${today()}-${round}`);
    const pick = [...EMOJI].sort(() => rnd() - 0.5).slice(0, 6);
    const deck = [...pick, ...pick].map((e, i) => ({ id: i, e, matched: false })).sort(() => rnd() - 0.5);
    setCards(deck); setOpen([]); setMoves(0); setStart(null); setDone(null);
  }, [round]);

  function flip(i) {
    if (lock.current || done || open.includes(i) || cards[i].matched) return;
    if (!start) setStart(Date.now());
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      lock.current = true;
      const [a, b] = next;
      const ok = cards[a].e === cards[b].e;
      setTimeout(() => {
        const updated = ok ? cards.map((c, k) => (k === a || k === b ? { ...c, matched: true } : c)) : cards;
        setCards(updated); setOpen([]); lock.current = false;
        if (ok && updated.every((c) => c.matched)) {
          const secs = Math.round((Date.now() - (start || Date.now())) / 1000);
          const score = moves + 1;
          const record = saveScore('memory', score, true);
          if (record) confetti(80);
          setDone({ score, secs, record });
        }
      }, ok ? 300 : 750);
    }
  }

  if (done) return html`<${Result} title=${`Xong trong ${done.score} lượt`} record=${done.record}
    lines=${[`Thời gian: ${done.secs} giây`, `Kỷ lục hôm nay: ${getScore('memory').today} lượt`]} onAgain=${() => setRound(round + 1)} close=${close} />`;
  return html`<div class="game">
    <div class="game-bar"><span>Lượt: <b>${moves}</b></span><span class="muted small">Ghép 6 cặp thẻ giống nhau</span></div>
    <div class="memory-grid">
      ${cards.map((c, i) => html`<button key=${c.id + '-' + round} class=${'mcard' + (open.includes(i) || c.matched ? ' up' : '') + (c.matched ? ' ok' : '')} onClick=${() => flip(i)}>
        <span class="mcard-inner"><span class="mcard-front">?</span><span class="mcard-back">${c.e}</span></span>
      </button>`)}
    </div>
  </div>`;
}

// ------------------------------------------------------------------
// 2. Toán nhanh (30 seconds)
// ------------------------------------------------------------------
function makeProblem() {
  const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const op = ['+', '−', '×'][r(0, 2)];
  let a, b, ans;
  if (op === '+') { a = r(5, 60); b = r(5, 60); ans = a + b; }
  else if (op === '−') { a = r(10, 90); b = r(1, a); ans = a - b; }
  else { a = r(2, 12); b = r(2, 12); ans = a * b; }
  const opts = new Set([ans]);
  while (opts.size < 4) opts.add(Math.max(0, ans + r(-10, 10)));
  return { text: `${a} ${op} ${b}`, ans, opts: [...opts].sort(() => Math.random() - 0.5) };
}

function MathGame({ close }) {
  const TOTAL = 30;
  const [state, setState] = useState('ready');
  const [left, setLeft] = useState(TOTAL);
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [p, setP] = useState(makeProblem);
  const [flash, setFlash] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (state !== 'play') return;
    const t = setInterval(() => setLeft((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    if (state === 'play' && left <= 0) {
      const record = saveScore('math', score);
      if (record && score > 0) confetti(80);
      setResult({ record }); setState('done');
    }
  }, [left]);

  function answer(v) {
    const ok = v === p.ans;
    if (ok) setScore((s) => s + 1); else setWrong((w) => w + 1);
    setFlash(ok ? 'ok' : 'bad');
    setTimeout(() => setFlash(null), 250);
    setP(makeProblem());
  }
  function restart() { setScore(0); setWrong(0); setLeft(TOTAL); setP(makeProblem()); setState('play'); }

  if (state === 'done') return html`<${Result} title=${`${score} câu đúng`} record=${result.record}
    lines=${[`Sai: ${wrong} câu`, `Kỷ lục hôm nay: ${getScore('math').today ?? 0} câu`]} onAgain=${restart} close=${close} />`;
  if (state === 'ready') return html`<div class="game center-col">
    <div class="game-hero">🧮</div><div class="muted">Trả lời càng nhiều phép tính càng tốt trong ${TOTAL} giây.</div>
    <button class="btn btn-primary btn-lg" onClick=${restart}>Bắt đầu</button></div>`;
  return html`<div class="game">
    <div class="game-bar"><span>Điểm: <b>${score}</b></span><span class=${'timer' + (left <= 5 ? ' hot' : '')}><${Icon} name="clock" size=${15} /> ${left}s</span></div>
    <div class="game-timebar"><span style=${`width:${(left / TOTAL) * 100}%`}></span></div>
    <div class=${'math-q' + (flash ? ' ' + flash : '')}>${p.text} = ?</div>
    <div class="math-opts">${p.opts.map((o) => html`<button class="btn btn-ghost btn-lg" onClick=${() => answer(o)}>${o}</button>`)}</div>
  </div>`;
}

// ------------------------------------------------------------------
// 3. Bắt lửa (tap the flames, avoid the water)
// ------------------------------------------------------------------
function FlameGame({ close }) {
  const TOTAL = 20;
  const [state, setState] = useState('ready');
  const [left, setLeft] = useState(TOTAL);
  const [score, setScore] = useState(0);
  const [cells, setCells] = useState(Array(9).fill(null));
  const [result, setResult] = useState(null);
  const scoreRef = useRef(0);

  useEffect(() => {
    if (state !== 'play') return;
    const tick = setInterval(() => setLeft((x) => x - 1), 1000);
    let spawner;
    const spawn = () => {
      setCells((prev) => {
        const next = [...prev];
        const free = next.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)];
          const kind = Math.random() < 0.18 ? 'water' : Math.random() < 0.12 ? 'gold' : 'fire';
          const id = Math.random();
          next[i] = { kind, id };
          setTimeout(() => setCells((c) => (c[i]?.id === id ? c.map((v, k) => (k === i ? null : v)) : c)), kind === 'gold' ? 650 : 950);
        }
        return next;
      });
      const elapsed = TOTAL - leftRef.current;
      spawner = setTimeout(spawn, Math.max(320, 700 - elapsed * 18));
    };
    spawn();
    return () => { clearInterval(tick); clearTimeout(spawner); };
  }, [state]);
  const leftRef = useRef(TOTAL);
  leftRef.current = left;

  useEffect(() => {
    if (state === 'play' && left <= 0) {
      const record = saveScore('flame', scoreRef.current);
      if (record && scoreRef.current > 0) confetti(80);
      setResult({ record }); setState('done'); setCells(Array(9).fill(null));
    }
  }, [left]);

  function hit(i) {
    const c = cells[i];
    if (!c) return;
    const delta = c.kind === 'water' ? -3 : c.kind === 'gold' ? 3 : 1;
    scoreRef.current = Math.max(0, scoreRef.current + delta);
    setScore(scoreRef.current);
    navigator.vibrate?.(c.kind === 'water' ? 60 : 15);
    setCells(cells.map((v, k) => (k === i ? { ...v, hit: true } : v)));
    setTimeout(() => setCells((cs) => cs.map((v, k) => (k === i && v?.id === c.id ? null : v))), 120);
  }
  function restart() { scoreRef.current = 0; setScore(0); setLeft(TOTAL); setCells(Array(9).fill(null)); setState('play'); }

  if (state === 'done') return html`<${Result} title=${`${score} điểm`} record=${result.record}
    lines=${[`Kỷ lục hôm nay: ${getScore('flame').today ?? 0} điểm`]} onAgain=${restart} close=${close} />`;
  if (state === 'ready') return html`<div class="game center-col">
    <div class="game-hero">🔥</div>
    <div class="muted">Chạm thật nhanh vào ngọn lửa trong ${TOTAL} giây.<br />🔥 +1 · ⭐ +3 · 💧 −3</div>
    <button class="btn btn-primary btn-lg" onClick=${restart}>Bắt đầu</button></div>`;
  return html`<div class="game">
    <div class="game-bar"><span>Điểm: <b>${score}</b></span><span class=${'timer' + (left <= 5 ? ' hot' : '')}><${Icon} name="clock" size=${15} /> ${left}s</span></div>
    <div class="game-timebar"><span style=${`width:${(left / TOTAL) * 100}%`}></span></div>
    <div class="flame-grid">${cells.map((c, i) => html`<button class=${'fcell' + (c ? ' on ' + c.kind : '') + (c?.hit ? ' hit' : '')} onPointerDown=${() => hit(i)}>
      ${c && html`<span class="fitem">${c.kind === 'water' ? '💧' : c.kind === 'gold' ? '⭐' : '🔥'}</span>`}</button>`)}</div>
  </div>`;
}

// ------------------------------------------------------------------
// Home section
// ------------------------------------------------------------------
const GAMES = [
  { id: 'memory', title: 'Lật thẻ', desc: 'Bàn mới mỗi ngày', emoji: '🃏', tone: 'violet', C: MemoryGame, fmt: (v) => `${v} lượt`, lower: true },
  { id: 'math', title: 'Toán nhanh', desc: '30 giây', emoji: '🧮', tone: 'cyan', C: MathGame, fmt: (v) => `${v} câu` },
  { id: 'flame', title: 'Bắt lửa', desc: '20 giây', emoji: '🔥', tone: 'rose', C: FlameGame, fmt: (v) => `${v} điểm` },
];

export function GamesSection() {
  const [, refresh] = useState(0);
  async function play(g) {
    await openSheet(g.C, { title: `${g.emoji} ${g.title}` });
    refresh((x) => x + 1);
  }
  return html`<div class="games-row">
    ${GAMES.map((g, i) => {
      const s = getScore(g.id);
      return html`<button key=${g.id} class=${'game-card slide-up tone-' + g.tone} style=${`--d:${i * 60}ms`} onClick=${() => play(g)}>
        <span class="game-emoji">${g.emoji}</span>
        <span class="game-title">${g.title}</span>
        <span class="game-sub">${s.today != null ? `Hôm nay: ${g.fmt(s.today)}` : g.desc}</span>
      </button>`;
    })}
  </div>`;
}
