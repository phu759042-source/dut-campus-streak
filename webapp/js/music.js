// Background music for the 3D map: the overview, walking alone and the server.
// Original, generated pieces: each track is a small score (key, mode, tempo, chord progression, accompaniment style)
// that a seeded composer turns into a few minutes of soft piano over warm pads, played through a long reverb, in the
// calm, sparse spirit of ambient game soundtracks: for studying, resting or falling asleep. Nothing is downloaded.
// Tracks play in random order with a short silence in between.
import { readLocal, writeLocal } from './lib.js';

const KEY = 'cs-music';
const NOTE = (m) => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixo: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], minor: [0, 2, 3, 5, 7, 8, 10],
};

// prog / prog2: chord roots as scale degrees (0 = tonic), one per `cb` bars; prog2 is the middle section.
// style: arp (rolling broken chords) · block (struck chords) · waltz (bass, then chord twice) · ambient (pads, a few notes)
// arp: order of chord tones in one bar · div: notes per beat · mel: how often a phrase is played · bell: celesta sparkles
export const TRACKS = [
  { title: 'Sáng sớm Khu A', root: 62, mode: 'lydian', bpm: 72, meter: 4, cb: 1, prog: [0, 4, 5, 3], prog2: [3, 4, 2, 5], style: 'arp', arp: [0, 2, 1, 3, 2, 1, 3, 2], div: 2, len: 236, mel: 0.7, pad: 0.5, bell: 0.08, seed: 11 },
  { title: 'Thư viện yên tĩnh', root: 65, mode: 'major', bpm: 60, meter: 4, cb: 2, prog: [0, 3, 5, 4], prog2: [1, 4, 3, 0], style: 'block', len: 262, mel: 0.55, pad: 0.7, bell: 0, seed: 23 },
  { title: 'Mưa chiều trên mái', root: 57, mode: 'dorian', bpm: 66, meter: 4, cb: 1, prog: [0, 3, 0, 6], prog2: [2, 3, 6, 4], style: 'arp', arp: [0, 1, 2, 3, 4, 3, 2, 1], div: 2, len: 248, mel: 0.6, pad: 0.45, bell: 0.05, seed: 37 },
  { title: 'Đèn ký túc xá', root: 63, mode: 'major', bpm: 54, meter: 4, cb: 2, prog: [0, 5, 3, 4], prog2: [5, 2, 3, 1], style: 'ambient', len: 286, mel: 0.45, pad: 0.85, bell: 0.22, seed: 41 },
  { title: 'Ghế đá sân trường', root: 67, mode: 'major', bpm: 84, meter: 3, cb: 1, prog: [0, 2, 3, 4, 0, 5, 3, 4], prog2: [5, 2, 3, 0, 5, 1, 3, 4], style: 'waltz', len: 224, mel: 0.75, pad: 0.35, bell: 0.04, seed: 53 },
  { title: 'Gió hành lang', root: 60, mode: 'lydian', bpm: 58, meter: 4, cb: 2, prog: [0, 1, 0, 4], prog2: [5, 1, 3, 4], style: 'ambient', len: 300, mel: 0.35, pad: 1, bell: 0.12, seed: 67 },
  { title: 'Trước giờ thi', root: 58, mode: 'major', bpm: 70, meter: 4, cb: 1, prog: [3, 4, 2, 5], prog2: [3, 0, 1, 4], style: 'arp', arp: [0, 2, 3, 1, 2, 3, 1, 2], div: 2, len: 214, mel: 0.7, pad: 0.4, bell: 0.06, seed: 71 },
  { title: 'Sao trên sân vận động', root: 61, mode: 'major', bpm: 50, meter: 4, cb: 2, prog: [0, 3, 0, 4], prog2: [5, 3, 1, 4], style: 'ambient', len: 312, mel: 0.4, pad: 0.95, bell: 0.18, seed: 83 },
  { title: 'Hồ cá Khu A', root: 64, mode: 'dorian', bpm: 64, meter: 4, cb: 1, prog: [0, 6, 3, 4], prog2: [5, 6, 0, 3], style: 'arp', arp: [0, 3, 1, 4, 2, 3, 1, 2], div: 2, len: 240, mel: 0.55, pad: 0.55, bell: 0.16, seed: 97 },
  { title: 'Chiều về Liên Chiểu', root: 56, mode: 'major', bpm: 76, meter: 3, cb: 2, prog: [0, 3, 5, 4], prog2: [3, 2, 1, 4], style: 'waltz', len: 252, mel: 0.65, pad: 0.45, bell: 0.05, seed: 101 },
  { title: 'Bản vẽ dang dở', root: 62, mode: 'mixo', bpm: 68, meter: 4, cb: 1, prog: [0, 6, 3, 0], prog2: [4, 6, 3, 5], style: 'block', len: 230, mel: 0.6, pad: 0.55, bell: 0.07, seed: 113 },
  { title: 'Ngủ ngon nhé', root: 60, mode: 'major', bpm: 48, meter: 3, cb: 2, prog: [0, 5, 3, 4], prog2: [3, 0, 1, 4], style: 'waltz', len: 296, mel: 0.4, pad: 0.8, bell: 0.14, seed: 127 },
  { title: 'Phòng thí nghiệm lúc khuya', root: 59, mode: 'minor', bpm: 62, meter: 4, cb: 2, prog: [0, 5, 2, 6], prog2: [3, 5, 0, 4], style: 'arp', arp: [0, 1, 2, 1, 3, 2, 1, 2], div: 2, len: 258, mel: 0.5, pad: 0.65, bell: 0.1, seed: 131 },
  { title: 'Mùa hoa sữa', root: 66, mode: 'lydian', bpm: 74, meter: 4, cb: 1, prog: [0, 1, 5, 4], prog2: [3, 1, 2, 5], style: 'block', len: 220, mel: 0.7, pad: 0.45, bell: 0.1, seed: 139 },
];

// --------------------------------------------------------------------------------------------------------------------
// Composer: a track's score → a list of timed notes {t (s), k: p piano | pad | b bell, m midi | [midi], v, d (s)}
// --------------------------------------------------------------------------------------------------------------------
const RHY4 = [[2, 1, 1, 4], [1.5, 0.5, 2, 4], [1, 1, 2, -1, 1, 2], [3, 1, 4], [2, 2, 3, 1], [1, 1, 1, 1, 4], [0.5, 0.5, 1, 2, -1, 3], [2, -1, 1, 1, 1, 2], [3, -1, 4]];
const RHY3 = [[2, 1, 3], [1, 1, 1, 3], [3, 2, 1], [1.5, 0.5, 1, 3], [2, 1, 1, 2], [2, -1, 3], [1, 2, 3]];

export function compose(tr) {
  const r = rng(tr.seed);
  const sc = MODES[tr.mode];
  const pitch = (deg) => tr.root - 12 + 12 * Math.floor(deg / 7) + sc[((deg % 7) + 7) % 7]; // degree 0 ≈ the octave below middle
  const beat = 60 / tr.bpm, bar = beat * tr.meter;
  const ev = [];
  const add = (t, k, m, v, d) => ev.push({ t: Math.max(0, t + (r() - 0.5) * 0.018), k, m, v: clamp(v * (0.9 + r() * 0.2), 0.05, 1), d });

  // chord tones (scale degrees) and a close voicing inside one octave around `center`
  const chordDegs = (d) => [d, d + 2, d + 4, d + (r() < 0.5 ? 6 : 8)]; // triad + 7th or 9th: soft, open colours
  const place = (m, center) => { let x = m; while (x < center - 6) x += 12; while (x >= center + 6) x -= 12; return x; };
  const voicing = (degs, center) => [...new Set(degs.map((g) => place(pitch(g), center)))].sort((a, b) => a - b);
  const bassOf = (d) => { let m = pitch(d); while (m >= 48) m -= 12; while (m < 36) m += 12; return m; };

  const L = tr.prog.length * tr.cb; // bars in one pass of the progression
  const cycles = Math.max(4, Math.round(tr.len / (bar * L)));
  // intensity per pass: 0 pads + bass · 1 + accompaniment · 2 + melody · 3 + doubled melody; B = middle progression
  const plan = [];
  for (let c = 0; c < cycles; c++) {
    if (c === 0) plan.push({ lv: tr.style === 'ambient' ? 1 : 0.5, B: false });
    else if (c === cycles - 1) plan.push({ lv: 0.5, B: false, last: true });
    else {
      const mid = c / (cycles - 1);
      const B = mid > 0.4 && mid < 0.7;
      const lv = c === 1 ? 1 : B ? (r() < 0.5 ? 1 : 2) : (c % 3 === 0 ? 3 : 2);
      plan.push({ lv, B });
    }
  }

  let melDeg = 9 + Math.floor(r() * 3);
  const melUp = pitch(7) < 60 ? 12 : 0; // the melody sits from about middle C up an octave and a half, above the accompaniment
  const rhythms = tr.meter === 3 ? RHY3 : RHY4;
  let motif = null;
  const newMotif = () => ({ rhy: rhythms[Math.floor(r() * rhythms.length)], steps: Array.from({ length: 8 }, () => [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(r() * 9)]) });

  let t = 1.5;
  plan.forEach((sec, ci) => {
    const prog = sec.B && tr.prog2 ? tr.prog2 : tr.prog;
    if (ci === 0 || sec.B !== plan[ci - 1].B || r() < 0.3) motif = newMotif();
    const chords = prog.map((d) => ({ d, degs: chordDegs(d) }));
    // the last pass ends on the tonic
    if (sec.last) chords[chords.length - 1] = { d: 0, degs: [0, 2, 4, 8] };
    chords.forEach((ch, k) => {
      const t0 = t + k * tr.cb * bar, len = tr.cb * bar;
      const fin = sec.last && k === chords.length - 1;
      const v = voicing(ch.degs, tr.style === 'ambient' ? 62 : 60);
      const lv = sec.lv;
      // pads: one long, slowly swelling chord, overlapping the next one
      if (tr.pad > 0) add(t0, 'pad', voicing(ch.degs, 55), tr.pad * (lv >= 2 ? 0.8 : 1), len + (fin ? 6 : 1.6));
      // bass: low piano note at the chord change (and the fifth now and then)
      add(t0, 'p', bassOf(ch.d), 0.42, fin ? 8 : len + 0.5);
      if (lv >= 2 && tr.cb === 2 && r() < 0.6) add(t0 + bar, 'p', bassOf(ch.d + 4), 0.3, bar + 0.4);
      if (fin) { add(t0 + 0.05, 'p', v[0] + 12, 0.3, 8); add(t0 + 0.6, 'p', pitch(14), 0.34, 8); return; }

      // accompaniment
      for (let b = 0; b < tr.cb; b++) {
        const tb = t0 + b * bar;
        if (lv < 1 && !(lv >= 0.5 && b === 0)) continue;
        if (tr.style === 'arp') {
          const div = lv < 2 ? 1 : tr.div, steps = tr.meter * div;
          for (let i = 0; i < steps; i++) {
            const idx = tr.arp[(i * (tr.div / div)) % tr.arp.length];
            const m = v[idx % v.length] + 12 * Math.floor(idx / v.length);
            add(tb + i * beat / div, 'p', m, (i === 0 ? 0.36 : 0.27) * (lv < 1 ? 0.8 : 1), bar - i * beat / div + 0.3); // held like a pedal
          }
        } else if (tr.style === 'block') {
          v.forEach((m, i) => add(tb + i * 0.028, 'p', m, 0.3, bar + 0.4)); // a soft roll from the bottom
          if (lv >= 2) v.slice(1).forEach((m, i) => add(tb + beat * 2.5 + i * 0.02, 'p', m, 0.2, beat * 1.5 + 0.3));
        } else if (tr.style === 'waltz') {
          if (b > 0 || lv >= 1) {
            add(tb + beat, 'p', v[1] ?? v[0], 0.22, beat * 0.9 + 0.2); add(tb + beat, 'p', v[2] ?? v[0], 0.2, beat * 0.9 + 0.2);
            add(tb + 2 * beat, 'p', v[1] ?? v[0], 0.18, beat * 0.9 + 0.2); add(tb + 2 * beat, 'p', v[v.length - 1], 0.18, beat * 0.9 + 0.2);
          }
        } else { // ambient: one to three long notes per bar
          const n = 1 + Math.floor(r() * (lv >= 2 ? 3 : 2));
          for (let i = 0; i < n; i++) add(tb + Math.floor(r() * tr.meter * 2) * beat / 2, 'p', v[Math.floor(r() * v.length)] + (r() < 0.4 ? 12 : 0), 0.24, bar * 1.2);
        }
      }
      // celesta sparkles, mostly in the quieter passes
      if (tr.bell > 0) for (let b = 0; b < tr.cb * tr.meter; b++) {
        if (r() < tr.bell * (lv <= 1 ? 1.4 : 0.6)) add(t0 + b * beat + (r() < 0.5 ? beat / 2 : 0), 'b', v[Math.floor(r() * v.length)] + 24, 0.28, 2);
      }
    });

    // melody: two-bar phrases built from the section's motif, answered by silence now and then
    if (sec.lv >= 2) {
      const phraseBars = 2, total = L;
      for (let pb = 0; pb < total; pb += phraseBars) {
        const pos = pb / phraseBars;
        if (r() > tr.mel && pos % 2 === 1) continue; // a breath
        const variant = pos % 4 === 2; // A A' B A
        const rhy = variant ? rhythms[Math.floor(r() * rhythms.length)] : motif.rhy;
        let tb = t + pb * bar;
        let beatPos = 0;
        rhy.forEach((dur, i) => {
          const d = Math.abs(dur);
          if (dur > 0) {
            const chordIdx = Math.min(prog.length - 1, Math.floor((pb + beatPos / tr.meter) / tr.cb));
            const tones = chordDegs(prog[chordIdx]).slice(0, 3).map((g) => ((g % 7) + 7) % 7);
            melDeg += variant ? [-1, 1, 2, -2][Math.floor(r() * 4)] : motif.steps[i % motif.steps.length];
            melDeg = clamp(melDeg, 7, 15);
            const strong = beatPos % (tr.meter === 3 ? 3 : 2) === 0 || i === rhy.length - 1;
            if (strong && !tones.includes(((melDeg % 7) + 7) % 7)) melDeg += tones.includes((melDeg + 1) % 7) ? 1 : -1;
            const m = pitch(melDeg) + melUp;
            const vel = (strong ? 0.5 : 0.42) * (sec.lv >= 3 ? 1.05 : 1);
            add(tb + beatPos * beat + 0.012, 'p', m, vel, d * beat * 1.4 + 0.4);
            if (sec.lv >= 3 && strong) add(tb + beatPos * beat + 0.02, 'p', m - 12, vel * 0.55, d * beat * 1.3 + 0.3);
          }
          beatPos += d;
        });
      }
    }
    t += L * bar;
  });
  ev.sort((a, b) => a.t - b.t);
  return { ev, end: t + 8 };
}

// --------------------------------------------------------------------------------------------------------------------
// Instruments (Web Audio): a soft felt piano, warm pads and a celesta, all into a long stereo reverb
// --------------------------------------------------------------------------------------------------------------------
let ctx = null, master = null, input = null, pianoWave = null, padWave = null;

function makeImpulse(sec, decay) {
  const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * x); // darker as it fades, like a big quiet hall
      d[i] = lp * (1 - x) ** decay * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}

function initAudio() { initAudioOn(new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' })); }
function initAudioOn(c) {
  ctx = c;
  master = ctx.createGain(); master.gain.value = 0;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 7800;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.5;
  master.connect(tone); tone.connect(comp); comp.connect(ctx.destination);
  input = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.72;
  const send = ctx.createGain(); send.gain.value = 0.55;
  const verb = ctx.createConvolver(); verb.buffer = makeImpulse(4.2, 2.6);
  input.connect(dry); dry.connect(master);
  input.connect(send); send.connect(verb); verb.connect(master);
  // a quiet echo, a dotted beat or so behind
  const dl = ctx.createDelay(1); dl.delayTime.value = 0.46;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2200;
  const dsend = ctx.createGain(); dsend.gain.value = 0.16;
  input.connect(dsend); dsend.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(verb); dlf.connect(master);
  const wave = (amps) => { const re = new Float32Array(amps.length), im = new Float32Array(amps); return ctx.createPeriodicWave(re, im); };
  pianoWave = wave([0, 1, 0.38, 0.17, 0.1, 0.05, 0.032, 0.018, 0.01, 0.006]);
  padWave = wave([0, 1, 0.5, 0.3, 0.18, 0.11, 0.07, 0.04, 0.025, 0.015, 0.01]);
}

function piano(bus, t, m, vel, dur) {
  const f = NOTE(m);
  const o = ctx.createOscillator(); o.setPeriodicWave(pianoWave); o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 5;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.2;
  flt.frequency.setValueAtTime(Math.min(11000, f * (2.5 + 9 * vel)), t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 260), t + 2.2);
  const g = ctx.createGain();
  const peak = vel * 0.2 * (m < 48 ? 1.25 : m > 84 ? 0.7 : 1);
  const ring = clamp(8 - (m - 36) * 0.1, 1.6, 8); // low strings ring longer
  const rel = t + Math.max(0.5, Math.min(dur, ring));
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.setTargetAtTime(peak * 0.4, t + 0.008, 0.22);
  g.gain.setTargetAtTime(0, t + 0.45, ring / 3.5);
  g.gain.setTargetAtTime(0, rel, 0.22); // damper
  const p = ctx.createStereoPanner(); p.pan.value = clamp((m - 62) / 40, -0.45, 0.45);
  o.connect(flt); flt.connect(g); g.connect(p); p.connect(bus);
  o.start(t); o.stop(rel + 1.6);
}

function pad(bus, t, ms, level, dur) {
  const g = ctx.createGain();
  const peak = 0.028 * level;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(2.8, dur / 2));
  g.gain.setValueAtTime(peak, t + Math.max(Math.min(2.8, dur / 2), dur - 1.2));
  g.gain.setTargetAtTime(0, t + dur - 1.2, 0.9);
  g.connect(bus);
  ms.forEach((m, i) => [-6, 6].forEach((det) => {
    const o = ctx.createOscillator(); o.setPeriodicWave(padWave); o.frequency.value = NOTE(m); o.detune.value = det + (i % 2 ? 2 : -2);
    o.connect(g); o.start(t); o.stop(t + dur + 4);
  }));
}

function bell(bus, t, m, vel) {
  const f = NOTE(m);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.09, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.7);
  const o1 = ctx.createOscillator(); o1.frequency.value = f;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.setTargetAtTime(0, t, 0.12);
  const o2 = ctx.createOscillator(); o2.frequency.value = f * 4.02;
  const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.8;
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(p); p.connect(bus);
  o1.start(t); o2.start(t); o1.stop(t + 4); o2.stop(t + 1.5);
}

// --------------------------------------------------------------------------------------------------------------------
// Player: settings, random order, look-ahead scheduling, fades
// --------------------------------------------------------------------------------------------------------------------
const settings = (() => { try { const s = JSON.parse(readLocal(KEY) || '{}'); return { on: s.on !== false, vol: clamp(Number(s.vol ?? 0.6), 0, 1) }; } catch { return { on: true, vol: 0.6 }; } })();
const subs = new Set();
const state = { on: settings.on, vol: settings.vol, title: '', playing: false, gap: false, waiting: false };
const emit = () => subs.forEach((f) => f({ ...state }));
const save = () => { try { writeLocal(KEY, JSON.stringify({ on: state.on, vol: state.vol })); } catch { /* storage off */ } };

let wanted = false; // the map is in walk / server mode
let cur = null, timer = 0, bag = [], lastIdx = -1, unlock = null;
const LOOK = 2.5;
const level = (v = state.vol) => 3.2 * v ** 1.7; // 50% ≈ -27 dBFS: under the game sounds, clear in headphones

function nextIndex() {
  if (!bag.length) { bag = TRACKS.map((_, i) => i).sort(() => Math.random() - 0.5); if (bag[0] === lastIdx && bag.length > 1) bag.push(bag.shift()); }
  lastIdx = bag.shift();
  return lastIdx;
}

function startTrack(delay) {
  const idx = nextIndex(), tr = TRACKS[idx];
  const { ev, end } = compose(tr);
  const bus = ctx.createGain(); bus.connect(input);
  cur = { idx, ev, end, i: 0, t0: ctx.currentTime + delay, bus };
  state.title = tr.title; state.gap = delay > 3; emit();
}

function fadeOutBus(c, sec = 2) {
  if (!c) return;
  const now = ctx.currentTime;
  c.bus.gain.cancelScheduledValues(now); c.bus.gain.setValueAtTime(c.bus.gain.value, now); c.bus.gain.linearRampToValueAtTime(0, now + sec);
  setTimeout(() => { try { c.bus.disconnect(); } catch { /* gone */ } }, sec * 1000 + 3000);
}

function tick() {
  if (!cur || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (state.gap && now >= cur.t0) { state.gap = false; emit(); }
  while (cur.i < cur.ev.length && cur.t0 + cur.ev[cur.i].t < now + LOOK) {
    const e = cur.ev[cur.i++], at = Math.max(now + 0.03, cur.t0 + e.t);
    if (e.k === 'p') piano(cur.bus, at, e.m, e.v, e.d);
    else if (e.k === 'pad') pad(cur.bus, at, e.m, e.v, e.d);
    else bell(cur.bus, at, e.m, e.v);
  }
  if (now > cur.t0 + cur.end) { const old = cur; startTrack(8 + Math.random() * 14); setTimeout(() => { try { old.bus.disconnect(); } catch { /* gone */ } }, 4000); }
}

function setMaster(v, sec) {
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(v, now + sec);
}

// browsers only start audio after a tap or key press on the page: until then, wait for the first one
function armUnlock() {
  if (unlock) return;
  unlock = () => { if (wanted && state.on && (!ctx || ctx.state !== 'running')) play(); };
  ['pointerdown', 'keydown', 'touchend'].forEach((e) => window.addEventListener(e, unlock, { passive: true }));
}

function play() {
  if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
    armUnlock(); state.waiting = true; emit(); return; // opened straight from a link: no tap yet
  }
  if (!ctx) { try { initAudio(); } catch { return; } }
  if (!cur) startTrack(0.4);
  const go = () => { state.waiting = false; setMaster(level(), 2.5); tick(); emit(); };
  if (ctx.state !== 'running') { state.waiting = true; ctx.resume().then(go, () => {}); armUnlock(); } else go();
  clearInterval(timer); timer = setInterval(tick, 250);
  state.playing = true; emit();
}

function pause() {
  clearInterval(timer); timer = 0;
  state.playing = false; state.waiting = false; emit();
  if (!ctx || ctx.state !== 'running') return;
  setMaster(0, 0.8);
  setTimeout(() => { if (!state.playing && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 900);
}

// public API -----------------------------------------------------------------------------------------------------------
export function musicStart() { wanted = true; if (state.on) play(); }
export function musicStop() { wanted = false; pause(); }
export function setMusicOn(on) {
  state.on = !!on; save();
  if (state.on && wanted) play(); else if (!state.on) pause(); else emit();
}
export function setMusicVolume(v) {
  state.vol = clamp(v, 0, 1); save();
  if (ctx && state.playing) setMaster(level(), 0.15);
  emit();
}
export function skipTrack() {
  if (!ctx || !state.playing) return;
  fadeOutBus(cur, 1.5);
  startTrack(1.6);
  tick();
}
export function musicState() { return { ...state, audio: ctx?.state || 'none' }; }
export function subscribeMusic(f) { subs.add(f); return () => subs.delete(f); }

// Renders the start of a track offline (checking levels while developing, or a sample to listen to): a Float32 stereo pair.
export async function renderPreview(idx, sec = 60) {
  const saved = [ctx, master, input, pianoWave, padWave];
  const off = new OfflineAudioContext(2, Math.floor(44100 * sec), 44100);
  ctx = off;
  try {
    initAudioOn(off);
    master.gain.value = level(0.6);
    const { ev } = compose(TRACKS[idx]);
    const bus = off.createGain(); bus.connect(input);
    for (const e of ev) {
      if (e.t > sec) break;
      if (e.k === 'p') piano(bus, e.t, e.m, e.v, e.d); else if (e.k === 'pad') pad(bus, e.t, e.m, e.v, e.d); else bell(bus, e.t, e.m, e.v);
    }
    const buf = await off.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  } finally { [ctx, master, input, pianoWave, padWave] = saved; }
}
