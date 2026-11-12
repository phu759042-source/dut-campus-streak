// Football matches on the stadium pitch (server mode of the 3D campus map). The world server is the referee:
// it keeps the teams, score and clock, runs the ball and both goalkeepers with the shared physics in
// js/soccer-core.js (the browsers run the same code to predict the ball), and checks every touch, kick and
// slide tackle a player sends.
//
// Match flow: idle (nobody) -> warm (warm-up, free play) -> count (both teams have players: 10 s countdown)
//   -> kick (kick-off, everyone frozen 3 s) -> play (clock runs) -> goal (4.5 s celebration) -> kick ... -> end (result 12 s)
//   -> count again when both teams still have players. "wait" pauses the clock while a team is empty.
import {
  F, HL, HW, GOAL_W, BALL_R, TEAM_SIZE, MATCH_MS, TEAM_NAMES, STEP, STEP_MS, MAX_KICK, MAX_LIFT,
  newSim, resetBall, step, toLocal, toWorld, dirLocal, ballAtFeet, kickoffSpots, keeperHolds,
} from '../../js/soccer-core.js';

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 10000, KICKOFF_MS = 3000, GOAL_MS = 4500, END_MS = 12000, WAIT_MS = 30000;
const NEAR = 230; // players this close to the pitch (or in a team) get the ball updates

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
const num = (x) => (Number.isFinite(+x) ? +x : NaN);

export class Soccer {
  constructor(world) {
    this.w = world;
    this.teams = [[], []];   // user ids
    this.score = [0, 0];
    this.goals = [];         // { id, name, team, own, ms }
    this.st = 'idle';
    this.until = 0;          // end of the current phase (server ms)
    this.endsAt = 0;         // end of the match while the clock runs
    this.rem = MATCH_MS;     // match time left while the clock is stopped
    this.ko = 0;             // team taking the next kick-off
    this.n = 0;              // match number
    this.sim = newSim((Date.now() % 1000003) + 1);
    this.simAt = Date.now();
    this.lt = null;          // last player to touch the ball
    this.ltName = '';
    this.cool = new Map();   // id -> { touch, tackle, stun } until (server ms)
    this.timer = 0; this.acc = 0; this.last = 0; this.ticks = 0; this.resetAt = 0;
  }

  teamOf(id) { return this.teams[0].includes(id) ? 0 : this.teams[1].includes(id) ? 1 : -1; }
  both() { return this.teams[0].length > 0 && this.teams[1].length > 0; }
  count() { return this.teams[0].length + this.teams[1].length; }
  /** Attachment (name, position…) of a connected player. */
  info(id) { for (const [, a] of this.w.sockets()) if (a.id === id) return a; return null; }
  local(a) { return a && Array.isArray(a.p) ? toLocal(a.p[0], a.p[1]) : null; }
  near(a) {
    if (this.teamOf(a.id) >= 0) return true;
    if (!Array.isArray(a.p)) return false;
    const dx = a.p[0] - F.cx, dz = a.p[1] - F.cz;
    return dx * dx + dz * dz < NEAR * NEAR;
  }
  cooling(id, k, now) { return (this.cool.get(id)?.[k] || 0) > now; }
  cooldown(id, k, until) { const c = this.cool.get(id) || {}; c[k] = until; this.cool.set(id, c); }
  canPlay() { return this.st === 'warm' || this.st === 'count' || this.st === 'play' || this.st === 'wait'; }

  // ---------- messages to the browsers ----------
  state() {
    return { t: 'fs', st: this.st, teams: this.teams, score: this.score, goals: this.goals, until: this.until,
      endsAt: this.endsAt, rem: this.rem, ko: this.ko, n: this.n, now: Date.now() };
  }
  ball() { return { t: 'fb', s: this.sim, lt: this.lt, at: this.simAt }; }
  pushState() { this.w.broadcast(this.state()); }
  toNear(o) {
    const s = JSON.stringify(o);
    for (const [ws, a] of this.w.sockets()) if (this.near(a)) this.w.send(ws, s);
  }
  pushBall() { this.toNear(this.ball()); }
  event(o) { this.toNear({ t: 'fe', ...o }); }
  /** Puts a player on a spot of the pitch, facing the goal they attack. */
  place(id, [u, v], team) {
    const [x, z] = toWorld(u, v), [lx, lz] = toWorld(team === 0 ? HL : -HL, 0);
    this.w.toUser(id, { t: 'fpos', x, z, lx, lz });
  }

  // ---------- the clock ----------
  ensureTimer() {
    const on = this.count() > 0;
    if (on && !this.timer) {
      this.last = Date.now(); this.acc = 0;
      this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('soccer tick', e); } }, TICK_MS);
    } else if (!on && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  tick() {
    const now = Date.now();
    this.acc = Math.min(this.acc + now - this.last, 250);
    this.last = now;
    const ev = [];
    // a player dribbling: the ball is at their feet (looked up once per tick)
    const b = this.sim.b;
    let feet = null;
    if (b.h != null && !keeperHolds(this.sim)) {
      const a = this.info(b.h), L = this.local(a);
      if (!a || !L || this.teamOf(b.h) < 0) b.h = null;
      else {
        const [fu, fv] = dirLocal(Math.sin(a.p[3]), Math.cos(a.p[3]));
        feet = ballAtFeet(L[0], L[1], fu, fv);
      }
    }
    if (feet) {
      const [bu, bv] = feet;
      Object.assign(b, { u: bu, v: bv, y: BALL_R, vu: 0, vv: 0, vy: 0 });
      if (this.st === 'play' && Math.abs(bu) > HL && Math.abs(bv) < GOAL_W - BALL_R) {
        // walked into the goal with the ball: a goal too
        b.h = null; b.vu = bu > 0 ? 2 : -2;
        ev.push({ e: 'goal', team: bu > 0 ? 0 : 1 });
      } else if (Math.abs(bu) > HL + 0.4 || Math.abs(bv) > HW + 0.4) {
        // ran off the pitch with it: the ball stays in
        this.cooldown(b.h, 'touch', now + 900);
        Object.assign(b, { h: null, u: clamp(bu, -HL + 0.6, HL - 0.6), v: clamp(bv, -HW + 0.6, HW - 0.6) });
        ev.push({ e: 'out' });
      }
    }
    const frozen = this.st === 'kick';
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      if (!frozen) step(this.sim, STEP, ev);
    }
    this.simAt = now - this.acc;
    let urgent = false;
    for (const e of ev) if (e.e !== 'bounce') { urgent = true; this.onEvent(e, now); }
    if (this.resetAt && now >= this.resetAt) { this.resetAt = 0; resetBall(this.sim); this.lt = null; urgent = true; }
    this.phase(now);
    this.ticks++;
    const moving = b.h != null || b.vu !== 0 || b.vv !== 0 || b.vy !== 0;
    if (urgent || (moving && this.ticks % 3 === 0) || this.ticks % 30 === 0) this.pushBall();
  }

  onEvent(e, now) {
    if (e.e === 'goal') {
      if (this.st === 'play') {
        const team = e.team, by = this.lt, t = by ? this.teamOf(by) : -1;
        this.score[team]++;
        this.goals.push({ id: by, name: this.ltName || 'Ai đó', team, own: t >= 0 && t !== team, ms: Math.max(0, MATCH_MS - (this.endsAt - now)) });
        this.rem = Math.max(0, this.endsAt - now);
        this.st = 'goal'; this.until = now + GOAL_MS; this.ko = 1 - team;
        this.pushState();
        this.event({ e: 'goal', team, id: by, name: this.ltName, own: t >= 0 && t !== team, score: this.score });
        return;
      }
      if (this.st !== 'goal') this.resetAt = now + 2500; // warm-up goal: the ball goes back to the middle
      this.event({ e: 'goal', team: e.team, id: this.lt, name: this.ltName, practice: true });
      return;
    }
    this.event(e);
  }

  phase(now) {
    const both = this.both();
    switch (this.st) {
      case 'idle':
      case 'warm':
        if (both) this.set('count', now + COUNTDOWN_MS);
        else if (this.st === 'idle' && this.count()) this.set('warm', 0);
        break;
      case 'count':
        if (!both) this.set('warm', 0);
        else if (now >= this.until) this.startMatch(now);
        break;
      case 'kick':
        if (now >= this.until) { this.st = 'play'; this.endsAt = now + this.rem; this.pushState(); this.event({ e: 'whistle' }); }
        break;
      case 'play':
        if (!both) { this.rem = Math.max(0, this.endsAt - now); this.set('wait', now + WAIT_MS); }
        else if (now >= this.endsAt) this.endMatch(now);
        break;
      case 'goal':
        if (now >= this.until) {
          if (this.rem <= 0) this.endMatch(now);
          else if (both) this.kickoff(now, this.ko);
          else this.set('wait', now + WAIT_MS);
        }
        break;
      case 'wait':
        if (both) this.kickoff(now, this.ko);
        else if (now >= this.until) this.set(this.count() ? 'warm' : 'idle', 0);
        break;
      case 'end':
        if (now >= this.until) {
          if (both) this.set('count', now + COUNTDOWN_MS);
          else this.set(this.count() ? 'warm' : 'idle', 0);
        }
        break;
      default:
    }
  }
  set(st, until) { this.st = st; this.until = until; this.pushState(); }

  startMatch(now) {
    this.score = [0, 0]; this.goals = []; this.rem = MATCH_MS; this.n++;
    this.kickoff(now, Math.random() < 0.5 ? 0 : 1);
  }
  kickoff(now, team) {
    this.st = 'kick'; this.until = now + KICKOFF_MS; this.ko = team;
    resetBall(this.sim); this.lt = null; this.ltName = ''; this.resetAt = 0;
    for (const t of [0, 1]) {
      const spots = kickoffSpots(t, this.teams[t].length, team);
      this.teams[t].forEach((id, i) => this.place(id, spots[i], t));
    }
    this.pushState(); this.pushBall();
  }
  endMatch(now) {
    this.st = 'end'; this.until = now + END_MS; this.rem = 0;
    this.pushState();
    this.event({ e: 'final', score: this.score });
  }

  // ---------- what players send ----------
  message(a, msg) {
    const now = Date.now();
    switch (msg.t) {
      case 'fjoin': this.join(a, msg.team, now); return;
      case 'fleave': this.leave(a.id); return;
      case 'ft': this.touch(a, msg, now); return;
      case 'fk': this.kick(a, msg, now); return;
      case 'fx': this.tackle(a, msg, now); return;
      default:
    }
  }

  join(a, want, now) {
    const t = want === 0 || want === 1 ? want
      : this.teams[0].length !== this.teams[1].length ? (this.teams[0].length < this.teams[1].length ? 0 : 1) : (Math.random() < 0.5 ? 0 : 1);
    const cur = this.teamOf(a.id);
    if (cur === t) return;
    if (this.teams[t].length >= TEAM_SIZE) {
      this.w.toUser(a.id, { t: 'error', code: 'soccer', msg: `Đội ${TEAM_NAMES[t]} đã đủ ${TEAM_SIZE} người, thử đội kia nhé.` });
      return;
    }
    if (cur >= 0) this.remove(a.id);
    this.teams[t].push(a.id);
    if (this.st === 'idle') this.st = 'warm';
    // onto the pitch, in their own half
    const own = t === 0 ? -1 : 1;
    if (this.st === 'kick') this.place(a.id, kickoffSpots(t, this.teams[t].length, this.ko)[this.teams[t].length - 1], t);
    else this.place(a.id, [own * (8 + Math.random() * 20), (Math.random() * 2 - 1) * 18], t);
    this.ensureTimer();
    this.pushState(); this.pushBall();
    if (this.st === 'wait' && this.both()) this.kickoff(now, this.ko);
  }

  leave(id) {
    if (this.teamOf(id) < 0) return;
    this.remove(id);
    if (!this.count()) { this.st = 'idle'; this.until = 0; resetBall(this.sim); this.lt = null; this.goals = []; this.score = [0, 0]; }
    this.ensureTimer();
    this.pushState(); this.pushBall();
  }
  remove(id) {
    for (const l of this.teams) { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); }
    if (this.sim.b.h === id) this.sim.b.h = null;
    this.cool.delete(id);
  }

  /** "I touched the ball": first valid claim gets it (checked against where the server last saw both). */
  touch(a, msg, now) {
    const b = this.sim.b;
    if (this.teamOf(a.id) < 0 || !this.canPlay() || b.h != null) return;
    if (this.cooling(a.id, 'touch', now) || this.cooling(a.id, 'stun', now)) return;
    const me = this.local(a), p = Array.isArray(msg.p) ? toLocal(num(msg.p[0]), num(msg.p[1])) : null;
    if (!me || !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (dist(p, me) > 4 || dist(p, [b.u, b.v]) > 2.4 || b.y > 1.6) return;
    b.h = a.id; this.lt = a.id; this.ltName = a.name;
    this.pushBall();
  }

  /** Shot or pass: the player sends where the ball starts and its velocity (the server caps the power). */
  kick(a, msg, now) {
    const b = this.sim.b;
    if (b.h !== a.id || !this.canPlay() || !Array.isArray(msg.p) || !Array.isArray(msg.d)) return;
    let u = num(msg.p[0]), v = num(msg.p[1]), vu = num(msg.d[0]), vv = num(msg.d[1]), vy = num(msg.d[2]);
    if (![u, v, vu, vv, vy].every(Number.isFinite)) return;
    const me = this.local(a);
    if (!me || dist([u, v], me) > 4) return;
    const sp = Math.sqrt(vu * vu + vv * vv);
    if (sp > MAX_KICK) { vu *= MAX_KICK / sp; vv *= MAX_KICK / sp; }
    u = clamp(u, -HL + 0.2, HL - 0.2); v = clamp(v, -HW + 0.2, HW - 0.2);
    Object.assign(b, { u, v, y: BALL_R, vu, vv, vy: clamp(vy, 0, MAX_LIFT), h: null });
    this.lt = a.id; this.ltName = a.name;
    this.cooldown(a.id, 'touch', now + 350);
    this.pushBall();
    this.event({ e: msg.k === 'p' ? 'pass' : 'kick', id: a.id });
  }

  /** Slide tackle: wins the ball from an opponent close enough to the tackler. */
  tackle(a, msg, now) {
    const t = this.teamOf(a.id), b = this.sim.b;
    if (t < 0 || !this.canPlay() || this.cooling(a.id, 'tackle', now)) return;
    this.cooldown(a.id, 'tackle', now + 1000);
    this.event({ e: 'slide', id: a.id });
    const h = b.h;
    if (h == null || keeperHolds(this.sim) || this.teamOf(h) === t || this.teamOf(h) < 0) return;
    const me = this.local(a), p = Array.isArray(msg.p) ? toLocal(num(msg.p[0]), num(msg.p[1])) : null;
    if (!me || !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || dist(p, me) > 4 || dist(p, [b.u, b.v]) > 2.8) return;
    let du = 0, dv = 0;
    if (Array.isArray(msg.d)) [du, dv] = dirLocal(num(msg.d[0]) || 0, num(msg.d[1]) || 0);
    const L = Math.sqrt(du * du + dv * dv) || 1;
    Object.assign(b, { h: null, vu: (du / L) * 4.5, vv: (dv / L) * 4.5, vy: 1.2 });
    this.cooldown(h, 'stun', now + 900);
    this.lt = a.id; this.ltName = a.name;
    this.pushBall();
    this.event({ e: 'steal', id: a.id, from: h });
  }
}
