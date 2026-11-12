// Server mode of the 3D campus map: connection to the world server (Cloudflare Worker, see world-server/),
// position updates, chat, meetings and browser-to-browser voice chat (WebRTC, the server only relays the setup).
import { supabase } from './lib.js';

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const WORLD_URL = LOCAL ? 'ws://127.0.0.1:8787/world' : 'wss://dut-campus-world.dut-campus-world.workers.dev/world';
export const EMOTES = ['👋', '👍', '😂', '❤️', '🔥', '😮'];

/** localhost only: /map?dev=Name joins the local test server as a made-up student (no account needed). */
export function devName() {
  if (!LOCAL) return null;
  try {
    const q = new URLSearchParams(location.search).get('dev');
    if (q) sessionStorage.setItem('cs-dev-name', q);
    return sessionStorage.getItem('cs-dev-name');
  } catch { return null; }
}

/**
 * Connects to the world. `on(msg)` receives every server message plus
 * { t: 'status', status: 'connecting' | 'online' | 'offline' | 'closed', msg? } and { t: 'voice', ... } updates.
 */
export function connectWorld({ look, on, getSelf }) {
  let ws = null, closed = false, tries = 0, retryTimer = 0, posTimer = 0, pingTimer = 0;
  let last = null, lastAt = 0;
  let ice = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  let myLook = look;
  const voice = createVoice({ send: (o) => send(o), emit: (v) => on({ t: 'voice', ...v }), ice: () => ice });

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  async function open() {
    if (closed) return;
    on({ t: 'status', status: 'connecting' });
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || (devName() ? `dev:${devName()}` : null);
    if (!token) { on({ t: 'status', status: 'closed', msg: 'Bạn cần đăng nhập để vào server.' }); return; }
    if (closed) return;
    ws = new WebSocket(WORLD_URL);
    ws.onopen = () => { tries = 0; send({ t: 'hello', token, look: myLook }); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { if (Array.isArray(m.ice) && m.ice.length) ice = m.ice; last = null; on({ t: 'status', status: 'online' }); }
      if (m.t === 'mjoined') voice.start(m.id, m.peers || []);
      if (m.t === 'mgone') voice.drop(m.who);
      if (m.t === 'mleft') voice.stop();
      if (m.t === 'rtc') voice.signal(m.from, m.d);
      on(m);
    };
    ws.onclose = (e) => {
      ws = null;
      voice.stop();
      if (closed) return;
      if (e.code === 4401 || e.code === 4409) { on({ t: 'status', status: 'closed', msg: e.code === 4409 ? 'Bạn đã vào server ở một tab khác.' : 'Phiên đăng nhập hết hạn, hãy đăng nhập lại.' }); return; }
      on({ t: 'status', status: 'offline' });
      tries++;
      retryTimer = setTimeout(open, Math.min(15000, 800 * 2 ** Math.min(tries, 5)));
    };
  }

  // your position, only when it changed (about 8 times a second while moving)
  posTimer = setInterval(() => {
    const p = getSelf();
    if (!p || !ws || ws.readyState !== 1) return;
    const now = performance.now();
    const moved = !last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.04 || Math.abs(p[2] - last[2]) > 0.04
      || Math.abs(p[3] - last[3]) > 0.03 || p[4] !== last[4] || (p[5] < 0.05) !== (last[5] < 0.05);
    if (!moved && now - lastAt < 10000) return; // idle: a keep-alive every 10 s
    last = p.slice(); lastAt = now;
    send({ t: 'p', p });
  }, 125);
  pingTimer = setInterval(() => send({ t: 'ping' }), 25000);
  open();

  return {
    chat: (text, m = null) => send({ t: 'chat', text, m }),
    emote: (e) => send({ t: 'emo', e }),
    setLook: (l) => { myLook = l; send({ t: 'look', look: l }); },
    createMeeting: (name, open, invite = []) => send({ t: 'mnew', name, open, invite }),
    joinMeeting: (id) => send({ t: 'mjoin', id }),
    leaveMeeting: () => send({ t: 'mleave' }),
    invite: (to) => send({ t: 'minv', to }),
    voice,
    close() {
      closed = true;
      clearTimeout(retryTimer); clearInterval(posTimer); clearInterval(pingTimer);
      voice.stop();
      try { ws?.close(1000, 'bye'); } catch { /* closed */ }
    },
  };
}

/** Voice chat inside a meeting: everyone connects to everyone (fine for small groups). */
function createVoice({ send, emit, ice }) {
  let meeting = null, mic = null, muted = false, ctx = null, meter = 0, starting = null;
  const peers = new Map(); // id -> { pc, audio, queue, analyser, state }
  const levels = new Map();
  let micAnalyser = null;

  function state() {
    emit({
      meeting, mic: !!mic, muted,
      peers: [...peers.entries()].map(([id, p]) => ({ id, state: p.state })),
      speaking: [...levels.entries()].filter(([, v]) => v > 0.04).map(([id]) => id),
    });
  }
  function analyse(stream) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const a = ctx.createAnalyser(); a.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(a);
      return a;
    } catch { return null; }
  }
  const buf = new Float32Array(512);
  function level(a) { if (!a) return 0; a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); }

  async function start(id, peerIds) {
    stop(true);
    meeting = id;
    starting = (async () => {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (meeting !== id) { mic.getTracks().forEach((t) => t.stop()); mic = null; return; }
        for (const t of mic.getAudioTracks()) t.enabled = !muted;
        micAnalyser = analyse(mic);
      } catch { mic = null; emit({ warn: 'Không mở được micro: bạn vẫn nghe được mọi người. Hãy cho phép micro trong trình duyệt nếu muốn nói.' }); }
    })();
    await starting;
    if (meeting !== id) return;
    clearInterval(meter);
    meter = setInterval(() => {
      let changed = false;
      const set = (k, v) => { const o = levels.get(k) || 0; const n = o * 0.5 + v * 0.5; levels.set(k, n); if ((o > 0.04) !== (n > 0.04)) changed = true; };
      set('me', mic && !muted ? level(micAnalyser) : 0);
      for (const [pid, p] of peers) set(pid, level(p.analyser));
      if (changed) state();
    }, 150);
    for (const pid of peerIds) call(pid);
    state();
  }

  function peer(id) {
    let p = peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ice() });
    p = { pc, audio: null, queue: [], analyser: null, state: 'connecting' };
    peers.set(id, p);
    if (mic) for (const t of mic.getTracks()) pc.addTrack(t, mic);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: id, d: { ice: e.candidate } }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.playsInline = true; p.audio.style.display = 'none'; document.body.appendChild(p.audio); }
      p.audio.srcObject = stream;
      p.audio.play().catch(() => emit({ warn: 'Trình duyệt chặn tự phát âm thanh: chạm vào màn hình một lần để nghe.' }));
      p.analyser = analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      p.state = s === 'connected' ? 'ok' : s === 'failed' ? 'failed' : s === 'disconnected' ? 'connecting' : p.state;
      state();
    };
    return p;
  }
  async function call(id) {
    const p = peer(id);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    send({ t: 'rtc', to: id, d: { sdp: p.pc.localDescription } });
  }
  async function signal(from, d) {
    if (!meeting || !d) return;
    if (starting) await starting;
    const p = peer(from);
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp);
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') {
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          send({ t: 'rtc', to: from, d: { sdp: p.pc.localDescription } });
        }
      } else if (d.ice) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice).catch(() => {});
        else p.queue.push(d.ice);
      }
    } catch (e) { console.warn('voice', e); }
  }
  function drop(id) {
    const p = peers.get(id); if (!p) return;
    try { p.pc.close(); } catch { /* closed */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    peers.delete(id); levels.delete(id);
    state();
  }
  function stop(quiet) {
    for (const id of [...peers.keys()]) drop(id);
    if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
    clearInterval(meter); meter = 0;
    levels.clear(); micAnalyser = null; starting = null;
    const was = meeting; meeting = null;
    if (!quiet && was) state();
  }
  function setMuted(m) {
    muted = m;
    if (mic) for (const t of mic.getAudioTracks()) t.enabled = !m;
    state();
  }
  return { start, signal, drop, stop, setMuted, get muted() { return muted; } };
}
