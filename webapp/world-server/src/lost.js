// "Đồ thất lạc" (lost and found) in the world server: every thing in js/lost-core.js lies on one of its spots.
// The first student close enough who picks it up gets its merit points ("điểm công đức"); a little later the thing
// is lost again on a random spot (Nhà xe khu E, Nhà xe khu B or a Khu H classroom).
// Where things lie is kept in the object's storage (it survives hibernation); the points are kept per account in
// the object's SQLite database (table merit), which also gives the leaderboard.
import { ITEMS, ITEM, SPOTS, SERVER_R, RESPAWN_MS, PICK_GAP_MS, pickSpot } from '../../js/lost-core.js';

const TOP_N = 30;

export class Lost {
  constructor(world) {
    this.w = world;
    this.items = null;    // k -> { s: spot index (-1 while nobody has lost it yet), back: when it is lost again }
    this.cfs = 0;         // confession number of the next post
    this.next = Infinity; // earliest `back` of the things waiting
    this.gap = new Map(); // user id -> last pick-up (ms)
    this.sqlOk = false;
    this.webTop = null; this.webAt = 0;
  }

  db() {
    const sql = this.w.ctx.storage.sql;
    if (!this.sqlOk) {
      sql.exec(`CREATE TABLE IF NOT EXISTS merit (id TEXT PRIMARY KEY, name TEXT NOT NULL, pts INTEGER NOT NULL DEFAULT 0,
        n INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0)`);
      sql.exec('CREATE INDEX IF NOT EXISTS merit_pts ON merit (pts DESC)');
      this.sqlOk = true;
    }
    return sql;
  }

  async load() {
    if (this.items) return;
    const saved = (await this.w.ctx.storage.get('lost')) || {};
    this.cfs = (await this.w.ctx.storage.get('cfs')) || 1200;
    const items = {}, taken = new Set();
    for (const it of ITEMS) {
      const o = saved[it.k];
      // keep where it lay unless the spot list changed under it
      if (o && o.s >= 0 && SPOTS[o.s] && it.on.includes(SPOTS[o.s][3]) && !taken.has(o.s)) { items[it.k] = { s: o.s, back: 0 }; taken.add(o.s); }
      else if (o && o.s < 0 && o.back) items[it.k] = { s: -1, back: o.back };
      else { const s = pickSpot(it.k, taken); items[it.k] = { s, back: 0 }; taken.add(s); }
    }
    this.items = items;
    this.plan();
    await this.save();
  }
  save() { return this.w.ctx.storage.put('lost', this.items); }
  plan() { this.next = Math.min(Infinity, ...Object.values(this.items).filter((o) => o.s < 0).map((o) => o.back)); }
  taken() { return new Set(Object.values(this.items).map((o) => o.s).filter((s) => s >= 0)); }

  /** Everything lying around now: [[k, spot], ...] and the next confession number. */
  state() {
    return { t: 'lf', items: Object.entries(this.items || {}).filter(([, o]) => o.s >= 0).map(([k, o]) => [k, o.s]), cfs: this.cfs };
  }

  /** Things whose time came are lost again, somewhere random. Called on every message (cheap until one is due). */
  async tick(now) {
    if (!this.items || now < this.next) return;
    const taken = this.taken();
    for (const [k, o] of Object.entries(this.items)) {
      if (o.s >= 0 || o.back > now) continue;
      o.s = pickSpot(k, taken); o.back = 0;
      if (o.s < 0) { o.back = now + 30000; continue; }
      taken.add(o.s);
      this.w.broadcast({ t: 'lfnew', k, s: o.s });
    }
    this.plan();
    await this.save();
  }

  /** Your points, number of finds and rank. */
  mine(id) {
    const r = this.db().exec('SELECT pts, n FROM merit WHERE id = ?', id).toArray()[0];
    if (!r) return { t: 'lfme', pts: 0, n: 0, rank: 0 };
    const rank = this.db().exec('SELECT COUNT(*) AS c FROM merit WHERE pts > ?', r.pts).one().c + 1;
    return { t: 'lfme', pts: r.pts, n: r.n, rank };
  }

  top(limit = TOP_N) {
    return this.db().exec('SELECT id, name, pts, n FROM merit ORDER BY pts DESC, at ASC LIMIT ?', limit).toArray();
  }

  /** Student `a` (socket ws) picks up thing msg.k. */
  async pick(ws, a, msg) {
    const now = Date.now();
    const it = ITEM[msg.k], o = it && this.items[msg.k];
    if (!o) return;
    if (o.s < 0) { this.w.send(ws, { t: 'lfmiss', k: msg.k, by: o.byName || '' }); return; }
    if (now - (this.gap.get(a.id) || 0) < PICK_GAP_MS) return;
    const sp = SPOTS[o.s];
    if (!a.p || Math.hypot(a.p[0] - sp[0], a.p[1] - sp[1]) > SERVER_R || Math.abs(a.p[2] - sp[2]) > 2.2) {
      this.w.send(ws, { t: 'lfmiss', k: msg.k, far: true });
      return;
    }
    this.gap.set(a.id, now);
    const s = o.s, cfs = this.cfs++;
    o.s = -1; o.byName = a.name;
    o.back = now + RESPAWN_MS[0] + Math.random() * (RESPAWN_MS[1] - RESPAWN_MS[0]);
    this.plan();
    this.db().exec(`INSERT INTO merit (id, name, pts, n, at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, pts = merit.pts + excluded.pts, n = merit.n + 1, at = excluded.at`, a.id, a.name, it.pts, now);
    this.webTop = null;
    this.w.broadcast({ t: 'lfgot', k: msg.k, s, id: a.id, name: a.name, pts: it.pts, cfs });
    this.w.send(ws, this.mine(a.id));
    await this.w.ctx.storage.put('cfs', this.cfs);
    await this.save();
  }

  /** The leaderboard for the website (GET /merit), cached for 20 s. */
  web() {
    const now = Date.now();
    if (!this.webTop || now - this.webAt > 20000) { this.webTop = this.top(100); this.webAt = now; }
    return this.webTop;
  }
}
