// DUT Campus World: the realtime server behind "Server" mode on the 3D campus map (campusstreak.com/map).
// One Durable Object ("dut") holds every connected student. Clients connect over WebSocket, log in with their
// Supabase session token (checked with Supabase Auth, name read from their profile), then exchange:
//   positions, chat (everyone or inside a meeting), emotes, character looks, meetings, and WebRTC signaling
//   for voice chat. Voice itself goes browser-to-browser; this server only passes the setup messages along.
// Uses the WebSocket Hibernation API so an idle world costs nothing.

const LOOK_RANGES = { skin: 5, hair: 5, hc: 6, shirt: 8, pants: 6, bag: 6, glasses: 2 };
const MAX_MEETING = 8;          // voice is a mesh (everyone connects to everyone), so keep meetings small
const CHAT_KEEP = 40;           // last messages of the shared chat sent to newcomers

const json = (o) => JSON.stringify(o);
const clampInt = (v, n) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= 0 && v < n ? v : 0; };
const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function cleanLook(l) {
  const out = {};
  for (const [k, n] of Object.entries(LOOK_RANGES)) out[k] = clampInt(l && l[k], n);
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/turn-check') { // is the TURN relay (voice across networks) set up? says yes/no only
      const ice = await World.prototype.iceServers.call({ env });
      const relays = ice.filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u))).length;
      return new Response(JSON.stringify({ turn: relays > 0 }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname !== '/world') return new Response('DUT Campus World', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
    const preview = /^https:\/\/dut-campus-streak-webapp[a-z0-9-]*\.vercel\.app$/.test(origin);
    if (!allowed.includes(origin) && !preview) return new Response('Forbidden', { status: 403 });
    return env.WORLD.get(env.WORLD.idFromName('dut')).fetch(req);
  },
};

export class World {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.meetings = null; // loaded lazily from storage (survives hibernation)
    this.chat = null;
  }

  async load() {
    if (this.meetings) return;
    this.meetings = (await this.ctx.storage.get('meetings')) || {};
    this.chat = (await this.ctx.storage.get('chat')) || [];
    // drop members that are no longer connected (e.g. after a restart)
    const online = new Set(this.players().map((p) => p.id));
    let changed = false;
    for (const [id, m] of Object.entries(this.meetings)) {
      const left = m.members.filter((u) => online.has(u));
      if (left.length !== m.members.length) { m.members = left; changed = true; }
      if (!left.length) { delete this.meetings[id]; changed = true; }
    }
    if (changed) await this.saveMeetings();
  }
  saveMeetings() { return this.ctx.storage.put('meetings', this.meetings); }

  async fetch(req) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ auth: false, at: Date.now() });
    // a socket that never logs in is closed after 15 s
    setTimeout(() => { try { if (!pair[1].deserializeAttachment()?.auth) pair[1].close(4401, 'login required'); } catch { /* closed */ } }, 15000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Logged-in sockets with their attachment. */
  sockets() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.auth) out.push([ws, a]);
    }
    return out;
  }
  players() { return this.sockets().map(([, a]) => a); }
  pub(a) { return { id: a.id, name: a.name, look: a.look, p: a.p || null, m: a.m || null }; }
  send(ws, o) { try { ws.send(typeof o === 'string' ? o : json(o)); } catch { /* closed */ } }
  broadcast(o, except) {
    const s = json(o);
    for (const [ws] of this.sockets()) if (ws !== except) this.send(ws, s);
  }
  toUser(id, o) { for (const [ws, a] of this.sockets()) if (a.id === id) this.send(ws, o); }
  toMeeting(mid, o, except) {
    const m = this.meetings[mid]; if (!m) return;
    const s = json(o);
    for (const [ws, a] of this.sockets()) if (ws !== except && m.members.includes(a.id)) this.send(ws, s);
  }
  meetingList() {
    return Object.values(this.meetings).map((m) => ({ id: m.id, name: m.name, host: m.host, members: m.members, open: m.open, invited: m.invited }));
  }
  pushMeetings() { this.broadcast({ t: 'meetings', list: this.meetingList() }); }

  async login(ws, token, look) {
    const env = this.env;
    const headers = { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` };
    let user, name = '';
    if (env.DEV_FAKE_AUTH === '1' && token.startsWith('dev:')) {
      // local testing only (wrangler dev with .dev.vars): "dev:<name>" logs in as a made-up student
      name = token.slice(4); user = { id: 'dev-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), user_metadata: {} };
    } else {
      const ur = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
      if (!ur.ok) { this.send(ws, { t: 'error', code: 'auth', msg: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại.' }); ws.close(4401, 'bad token'); return; }
      user = await ur.json();
      try {
        const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=display_name`, { headers });
        if (pr.ok) name = (await pr.json())[0]?.display_name || '';
      } catch { /* fall back to the sign-up name */ }
    }
    name = cleanText(name || user.user_metadata?.display_name || 'Sinh viên', 28) || 'Sinh viên';
    const savedLook = user.user_metadata?.campus_look;
    // one connection per account: an older tab is closed
    for (const [old, a] of this.sockets()) if (a.id === user.id && old !== ws) {
      this.send(old, { t: 'error', code: 'elsewhere', msg: 'Bạn vừa vào server ở một tab khác.' });
      await this.dropPlayer(old, a);
      try { old.close(4409, 'opened elsewhere'); } catch { /* closed */ }
    }
    const a = { auth: true, id: user.id, name, look: cleanLook(look || savedLook), p: null, m: null, lastChat: 0, at: Date.now() };
    ws.serializeAttachment(a);
    await this.load();
    this.send(ws, {
      t: 'welcome', me: this.pub(a),
      players: this.players().filter((p) => p.id !== a.id).map((p) => this.pub(p)),
      meetings: this.meetingList(), chat: this.chat, ice: await this.iceServers(),
    });
    this.broadcast({ t: 'join', p: this.pub(a) }, ws);
  }

  async iceServers() {
    const stun = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    const { TURN_KEY_ID, TURN_KEY_API_TOKEN } = this.env;
    if (!TURN_KEY_ID || !TURN_KEY_API_TOKEN) return stun;
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: json({ ttl: 86400 }),
      });
      if (r.ok) {
        const d = await r.json();
        // browsers reject TURN on port 53, so those urls are dropped (Cloudflare's own advice)
        const turn = [].concat(d.iceServers || []).map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
        return [...stun, ...turn];
      }
    } catch { /* STUN only */ }
    return stun;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a || !a.auth) {
      if (msg.t === 'hello' && typeof msg.token === 'string') await this.login(ws, msg.token, msg.look);
      return;
    }
    await this.load();
    switch (msg.t) {
      case 'p': { // position: [x, z, y, heading, mode, speed]
        if (!Array.isArray(msg.p) || msg.p.length !== 6) return;
        const p = msg.p.map((v) => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0));
        p[4] = clampInt(p[4], 3);
        a.p = p; ws.serializeAttachment(a);
        this.broadcast({ t: 'p', id: a.id, p }, ws);
        return;
      }
      case 'look': {
        a.look = cleanLook(msg.look); ws.serializeAttachment(a);
        this.broadcast({ t: 'look', id: a.id, look: a.look }, ws);
        return;
      }
      case 'emo': {
        const e = clampInt(msg.e, 6);
        this.broadcast({ t: 'emo', id: a.id, e }, ws);
        return;
      }
      case 'chat': {
        const text = cleanText(msg.text, 300);
        const now = Date.now();
        if (!text || now - (a.lastChat || 0) < 600) return;
        a.lastChat = now; ws.serializeAttachment(a);
        const m = msg.m && this.meetings[msg.m] && this.meetings[msg.m].members.includes(a.id) ? msg.m : null;
        const out = { t: 'chat', id: a.id, name: a.name, text, m, at: now };
        if (m) { this.toMeeting(m, out); return; }
        this.broadcast(out);
        this.chat.push(out); if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
        await this.ctx.storage.put('chat', this.chat);
        return;
      }
      case 'mnew': {
        if (a.m) await this.leaveMeeting(ws, a);
        const id = crypto.randomUUID().slice(0, 8);
        const invited = Array.isArray(msg.invite) ? msg.invite.filter((x) => typeof x === 'string').slice(0, 20) : [];
        this.meetings[id] = { id, name: cleanText(msg.name, 40) || `Phòng của ${a.name}`, host: a.id, members: [a.id], open: !!msg.open, invited, at: Date.now() };
        a.m = id; ws.serializeAttachment(a);
        await this.saveMeetings();
        this.send(ws, { t: 'mjoined', id, peers: [] });
        for (const u of invited) this.toUser(u, { t: 'minvite', id, name: this.meetings[id].name, from: a.name, fromId: a.id });
        this.pushMeetings();
        return;
      }
      case 'minv': { // a member invites someone else
        const m = a.m && this.meetings[a.m];
        if (!m || typeof msg.to !== 'string') return;
        if (!m.invited.includes(msg.to)) m.invited.push(msg.to);
        await this.saveMeetings();
        this.toUser(msg.to, { t: 'minvite', id: m.id, name: m.name, from: a.name, fromId: a.id });
        this.pushMeetings();
        return;
      }
      case 'mjoin': {
        const m = this.meetings[msg.id];
        if (!m) { this.send(ws, { t: 'error', code: 'meeting', msg: 'Phòng họp không còn nữa.' }); return; }
        if (m.members.includes(a.id)) return;
        if (!m.open && !m.invited.includes(a.id)) { this.send(ws, { t: 'error', code: 'meeting', msg: 'Phòng này riêng tư, cần được mời mới vào được.' }); return; }
        if (m.members.length >= MAX_MEETING) { this.send(ws, { t: 'error', code: 'meeting', msg: `Phòng đã đủ ${MAX_MEETING} người.` }); return; }
        if (a.m) await this.leaveMeeting(ws, a);
        const peers = [...m.members];
        m.members.push(a.id);
        a.m = m.id; ws.serializeAttachment(a);
        await this.saveMeetings();
        this.send(ws, { t: 'mjoined', id: m.id, peers }); // the newcomer calls everyone already inside
        this.toMeeting(m.id, { t: 'mpeer', id: m.id, who: a.id, name: a.name }, ws);
        this.pushMeetings();
        return;
      }
      case 'mleave': await this.leaveMeeting(ws, a); return;
      case 'rtc': { // voice chat setup, only between members of the same meeting
        const m = a.m && this.meetings[a.m];
        if (!m || typeof msg.to !== 'string' || !m.members.includes(msg.to)) return;
        this.toUser(msg.to, { t: 'rtc', from: a.id, d: msg.d });
        return;
      }
      case 'ping': this.send(ws, { t: 'pong' }); return;
      default:
    }
  }

  async leaveMeeting(ws, a) {
    const m = a.m && this.meetings[a.m];
    a.m = null; ws.serializeAttachment(a);
    if (!m) return;
    m.members = m.members.filter((u) => u !== a.id);
    if (!m.members.length) delete this.meetings[m.id];
    else {
      if (m.host === a.id) m.host = m.members[0];
      this.toMeeting(m.id, { t: 'mgone', id: m.id, who: a.id });
    }
    await this.saveMeetings();
    this.send(ws, { t: 'mleft', id: m.id });
    this.pushMeetings();
  }

  async dropPlayer(ws, a) {
    await this.load();
    if (a.m) await this.leaveMeeting(ws, a);
    a.auth = false;
    try { ws.serializeAttachment(a); } catch { /* closed */ }
    this.broadcast({ t: 'leave', id: a.id }, ws);
  }

  async webSocketClose(ws, code) {
    const a = ws.deserializeAttachment();
    if (a && a.auth) await this.dropPlayer(ws, a);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}
