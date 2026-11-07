'use strict';
/**
 * SoccerOnline v1.1 — oyun sunucusu
 * Tek bağımlılık: ws. Statik dosyalar (gzip'li) + WebSocket oyun odaları.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUB = path.join(__dirname, 'public');

// ---------------------------------------------------------------- ayarlar
const CFG = { W: 1300, H: 640, GW: 190, GD: 46, R: 16, BR: 10, POST: 6, RING: 26 }; // RING: şut çemberi yarıçapı (v1.1)
const ROOM_COUNT = 3;
const MAX_PLAYERS = 16;
const SLOTS = 8;
const MATCH_SECONDS = 300;
const START_COUNTDOWN = 5;
const GOAL_SECONDS = 5;
const RESTART_COUNTDOWN = 1.5;
const END_SECONDS = 10;
const HZ = 60;
const DT = 1 / HZ;
const SNAP_EVERY = 2; // 30 Hz snapshot

// [etiket, x (kendi yarı sahasında 0..1), y (0..1)]
const FORMATIONS = {
  '3-3-1': [['KL', .05, .5], ['SLB', .2, .18], ['STP', .2, .5], ['SĞB', .2, .82], ['SLK', .5, .14], ['OS', .5, .5], ['SĞK', .5, .86], ['FV', .88, .5]],
  '2-3-2': [['KL', .05, .5], ['SLS', .2, .34], ['SĞS', .2, .66], ['SLK', .5, .14], ['OS', .5, .5], ['SĞK', .5, .86], ['SLF', .88, .3], ['SĞF', .88, .7]],
  '3-2-2': [['KL', .05, .5], ['SLB', .2, .18], ['STP', .2, .5], ['SĞB', .2, .82], ['SLO', .52, .3], ['SĞO', .52, .7], ['SLF', .88, .3], ['SĞF', .88, .7]],
  '2-4-1': [['KL', .05, .5], ['SLS', .2, .34], ['SĞS', .2, .66], ['SLK', .5, .1], ['SLO', .5, .37], ['SĞO', .5, .63], ['SĞK', .5, .9], ['FV', .88, .5]],
  '3-1-3': [['KL', .05, .5], ['SLB', .2, .18], ['STP', .2, .5], ['SĞB', .2, .82], ['OS', .45, .5], ['SLK', .82, .16], ['FV', .9, .5], ['SĞK', .82, .84]],
};

// v1.1: damp 0.96 -> 0.92 (durma sonrası kayma %50 azaldı); maksimum hız = accel*damp/(1-damp) olduğundan
// accel/sprint yeniden hesaplandı: yürüme 2.88 -> 3.168 ve koşu 3.96 -> 4.356 (+%10).
// stamDrain 0.0035 / 1.25 (stamina %25 daha uzun dayanır).
const P = { accel: 0.2755, sprint: 0.3788, damp: 0.92, im: 0.5, rest: 0.3, stamDrain: 0.0028, stamRegen: 0.0018 };
const KICK_CHARGE_SECONDS = 0.675; // v1.1: 0.75 sn -> %10 daha hızlı şut dolumu
const B = { damp: 0.989, im: 1, wallRest: 0.65, hitRest: 0.4, max: 14 };

// ---------------------------------------------------------------- yardımcılar
const r1 = (v) => Math.round(v * 10) / 10;
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, a, b, d) => {
  v = parseInt(v, 10);
  return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function slotPos(formation, slot, team) {
  const f = (FORMATIONS[formation] || FORMATIONS['3-3-1'])[slot];
  const px = 30 + f[1] * (CFG.W / 2 - 80);
  const py = f[2] * CFG.H;
  return team === 0 ? { x: px, y: py } : { x: CFG.W - px, y: CFG.H - py };
}

function mkTeam(name, color) {
  return { name, color, formation: '3-3-1', captain: null, ready: false, slots: new Array(SLOTS).fill(null) };
}

// ---------------------------------------------------------------- fizik
function collide(a, b, rest) {
  const dx = b.x - a.x, dy = b.y - a.y, md = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= md * md) return false;
  const tot = a.im + b.im;
  if (tot === 0) return false;
  let d = Math.sqrt(d2), nx = 1, ny = 0;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; } else d = 0;
  const ov = md - d;
  a.x -= nx * ov * a.im / tot; a.y -= ny * ov * a.im / tot;
  b.x += nx * ov * b.im / tot; b.y += ny * ov * b.im / tot;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    const j = -(1 + rest) * vn / tot;
    a.vx -= j * a.im * nx; a.vy -= j * a.im * ny;
    b.vx += j * b.im * nx; b.vy += j * b.im * ny;
  }
  return true;
}

function clampPlayer(e) {
  const { W, H, R } = CFG;
  if (e.x < R) { e.x = R; if (e.vx < 0) e.vx = 0; } else if (e.x > W - R) { e.x = W - R; if (e.vx > 0) e.vx = 0; }
  if (e.y < R) { e.y = R; if (e.vy < 0) e.vy = 0; } else if (e.y > H - R) { e.y = H - R; if (e.vy > 0) e.vy = 0; }
}

function constrainLeft(b) {
  const { GW, GD, BR, H } = CFG;
  const cy = H / 2, hg = GW / 2;
  if (b.x < BR) {
    if (Math.abs(b.y - cy) < hg) {
      if (b.x < 0) {
        const lim = hg - BR;
        if (b.y < cy - lim) { b.y = cy - lim; if (b.vy < 0) b.vy = -b.vy * B.wallRest; }
        else if (b.y > cy + lim) { b.y = cy + lim; if (b.vy > 0) b.vy = -b.vy * B.wallRest; }
      }
      if (b.x < -GD + BR) { b.x = -GD + BR; if (b.vx < 0) b.vx = -b.vx * B.wallRest; }
    } else {
      b.x = BR; if (b.vx < 0) b.vx = -b.vx * B.wallRest;
    }
  }
}

function clampBall(b) {
  const { W, H, BR } = CFG;
  if (b.x >= 0 && b.x <= W) {
    if (b.y < BR) { b.y = BR; if (b.vy < 0) b.vy = -b.vy * B.wallRest; }
    else if (b.y > H - BR) { b.y = H - BR; if (b.vy > 0) b.vy = -b.vy * B.wallRest; }
  }
  constrainLeft(b);
  b.x = W - b.x; b.vx = -b.vx;
  constrainLeft(b);
  b.x = W - b.x; b.vx = -b.vx;
}

// ---------------------------------------------------------------- oda
class Room {
  constructor(id) {
    this.id = id;
    this.name = 'Sunucu ' + (id + 1);
    this.clients = new Map();
    this.frame = 0;
    this.posts = [];
    const cy = CFG.H / 2, hg = CFG.GW / 2;
    for (const x of [0, CFG.W]) for (const y of [cy - hg, cy + hg]) {
      this.posts.push({ x, y, vx: 0, vy: 0, r: CFG.POST, im: 0 });
    }
    this.ball = { x: CFG.W / 2, y: CFG.H / 2, vx: 0, vy: 0, r: CFG.BR, im: B.im };
    this.resetAll();
  }

  resetAll() {
    this.teams = [mkTeam('Takım A', '#e53935'), mkTeam('Takım B', '#1e88e5')];
    for (const c of this.clients.values()) { c.team = -1; c.slot = -1; }
    this.toLobby(true);
  }

  toLobby(silent) {
    this.phase = 'lobby';
    this.score = [0, 0];
    this.goals = [];
    this.touches = [];
    this.resetStats();
    this.matchTime = MATCH_SECONDS;
    this.simTime = 0;
    this.timer = 0;
    for (const t of this.teams) t.ready = false;
    this.ball.x = CFG.W / 2; this.ball.y = CFG.H / 2; this.ball.vx = 0; this.ball.vy = 0;
    if (!silent) this.pushState();
  }

  // ---- iletişim
  send(c, str) { if (c.ws.readyState === 1) c.ws.send(str); }
  broadcast(str, skipSlow) {
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1) continue;
      if (skipSlow && c.ws.bufferedAmount > 262144) continue;
      c.ws.send(str);
    }
  }
  stateMsg() {
    const teams = this.teams.map((t) => ({ n: t.name, c: t.color, f: t.formation, cap: t.captain, rd: t.ready, sl: t.slots }));
    const players = [];
    for (const c of this.clients.values()) players.push({ id: c.id, n: c.name, u: c.num, tm: c.team, sl: c.slot });
    return JSON.stringify({ t: 'state', ph: this.phase, sc: this.score, teams, players, goals: this.goals });
  }
  pushState() { this.broadcast(this.stateMsg()); }
  info() {
    return { id: this.id, name: this.name, count: this.clients.size, max: MAX_PLAYERS, ph: this.phase, sc: this.score, left: Math.ceil(this.matchTime) };
  }

  // ---- oyuncular
  addClient(ws, name, number) {
    const c = {
      id: ++Room.nextId, ws, name, num: number, team: -1, slot: -1, takenAt: 0,
      inp: { dx: 0, dy: 0, s: false, k: false },
      e: { x: 0, y: 0, vx: 0, vy: 0, r: CFG.R, im: P.im, charge: 0, holding: false, pending: null, kickCd: 0, stam: 1, tired: false, sp: 0 },
    };
    this.clients.set(c.id, c);
    this.send(c, JSON.stringify({ t: 'hi', id: c.id, room: this.name, cfg: CFG, forms: FORMATIONS, max: MAX_PLAYERS }));
    this.pushState();
    this.send(c, this.statsMsg());
    return c;
  }

  removeClient(c) {
    if (!this.clients.has(c.id)) return;
    this.freeSlot(c);
    this.clients.delete(c.id);
    if (this.clients.size === 0) this.resetAll();
    else this.pushState();
  }

  freeSlot(c) {
    if (c.team < 0) return;
    const t = this.teams[c.team];
    t.slots[c.slot] = null;
    c.team = -1; c.slot = -1;
    if (t.captain === c.id) { t.captain = null; t.ready = false; this.pickCaptain(t); }
  }

  pickCaptain(t) {
    let best = null;
    for (const id of t.slots) {
      if (id == null) continue;
      const c = this.clients.get(id);
      if (c && (!best || c.takenAt < best.takenAt)) best = c;
    }
    t.captain = best ? best.id : null;
    if (!best) t.ready = false;
  }

  take(c, team, slot) {
    if (this.phase === 'end') return;
    if (team !== 0 && team !== 1) return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return;
    const t = this.teams[team];
    if (t.slots[slot] != null) return;
    if (c.team === team && c.slot === slot) return;
    this.freeSlot(c);
    t.slots[slot] = c.id;
    c.team = team; c.slot = slot; c.takenAt = Date.now() + Math.random();
    if (t.captain == null) { t.captain = c.id; t.ready = false; }
    c.inp = { dx: 0, dy: 0, s: false, k: false };
    this.placeEnt(c);
    this.pushState();
  }

  leave(c) {
    if (c.team < 0) return;
    this.freeSlot(c);
    this.pushState();
  }

  setTeam(c, m) {
    if (c.team < 0) return;
    const t = this.teams[c.team];
    if (t.captain !== c.id) return;
    let changed = false;
    if (typeof m.name === 'string') {
      const n = clean(m.name, 14);
      if (n && n !== t.name) { t.name = n; changed = true; }
    }
    if (typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color) && m.color.toLowerCase() !== t.color) {
      t.color = m.color.toLowerCase(); changed = true;
    }
    if (typeof m.formation === 'string' && FORMATIONS[m.formation] && this.phase === 'lobby' && t.formation !== m.formation) {
      t.formation = m.formation; changed = true;
      for (const id of t.slots) { const cl = id != null ? this.clients.get(id) : null; if (cl) this.placeEnt(cl); }
    }
    if (changed) this.pushState();
  }

  setReady(c, v) {
    if (this.phase !== 'lobby' || c.team < 0) return;
    const t = this.teams[c.team];
    if (t.captain !== c.id) return;
    t.ready = !!v;
    if (this.teams[0].ready && this.teams[1].ready && this.teams[0].captain != null && this.teams[1].captain != null) this.startMatch();
    else this.pushState();
  }

  onMsg(c, m) {
    switch (m.t) {
      case 'in': {
        const i = c.inp;
        i.dx = Math.max(-1, Math.min(1, num(m.dx)));
        i.dy = Math.max(-1, Math.min(1, num(m.dy)));
        i.s = !!m.s; i.k = !!m.k;
        break;
      }
      case 'take': this.take(c, m.team, m.slot); break;
      case 'leave': this.leave(c); break;
      case 'team': this.setTeam(c, m); break;
      case 'ready': this.setReady(c, m.v); break;
      default: break;
    }
  }

  // ---- maç akışı
  placeEnt(c) {
    if (c.team < 0) return;
    const p = slotPos(this.teams[c.team].formation, c.slot, c.team);
    const e = c.e;
    e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0;
    e.charge = 0; e.holding = false; e.pending = null; e.kickCd = 0; e.stam = 1; e.tired = false; e.sp = 0;
  }

  resetPositions() {
    for (const c of this.clients.values()) this.placeEnt(c);
    const b = this.ball;
    b.x = CFG.W / 2; b.y = CFG.H / 2; b.vx = 0; b.vy = 0;
    this.touches = [];
    this.stats.kick = null;
  }

  startMatch() {
    this.phase = 'countdown';
    this.timer = START_COUNTDOWN;
    this.matchTime = MATCH_SECONDS;
    this.score = [0, 0];
    this.goals = [];
    this.simTime = 0;
    this.resetStats();
    this.resetPositions();
    this.pushState();
  }

  endMatch() {
    this.phase = 'end';
    this.timer = END_SECONDS;
    this.pushState();
    this.broadcast(this.statsMsg());
  }

  // ---- istatistikler
  resetStats() {
    const mkS = () => ({ sh: 0, sot: 0, pa: 0, pk: 0, ic: 0 });
    this.stats = { pos: [0, 0], tm: [mkS(), mkS()], pl: new Map(), kick: null };
  }

  pst(id, name, num, team) {
    let s = this.stats.pl.get(id);
    if (!s) { s = { id, n: name, u: num, tm: team, g: 0, a: 0, sh: 0, sot: 0, pa: 0, pk: 0 }; this.stats.pl.set(id, s); }
    s.tm = team;
    return s;
  }

  statsMsg() {
    const s = this.stats, tot = s.pos[0] + s.pos[1];
    const p0 = tot ? Math.round(s.pos[0] / tot * 100) : 50;
    for (const c of this.clients.values()) if (c.slot >= 0) this.pst(c.id, c.name, c.num, c.team);
    const pl = [];
    for (const v of s.pl.values()) pl.push([v.id, v.n, v.u, v.tm, v.g, v.a, v.sh, v.sot, v.pa, v.pk]);
    return JSON.stringify({ t: 'stats', pos: [p0, 100 - p0], tm: s.tm.map((x) => [x.sh, x.sot, x.pa, x.pk, x.ic]), pl });
  }

  // Önceki vuruş (pas) bu dokunuşla sonuçlanır: takım arkadaşı = isabetli pas, rakip = top kapma
  resolveKick(c) {
    const k = this.stats.kick;
    if (!k) return;
    this.stats.kick = null;
    if (k.shot) return;
    const ts = this.stats.tm[k.team], ps = this.pst(k.id, k.n, k.u, k.team);
    ts.pa++; ps.pa++;
    if (c.team === k.team) { ts.pk++; ps.pk++; } else this.stats.tm[c.team].ic++;
  }

  // Vuruşun yönüne bakarak şut mu pas mı olduğuna karar verir
  registerKick(c) {
    const b = this.ball, { W, H, GW } = CFG, cy = H / 2;
    const gx = c.team === 0 ? W : 0, dir = c.team === 0 ? 1 : -1;
    const vx = b.vx * dir, dx = Math.abs(gx - b.x);
    let shot = false, on = false;
    if (vx > 1 && dx < 620 && Math.hypot(b.vx, b.vy) >= 6 && vx * 60 >= dx) {
      const yAt = b.y + (b.vy / b.vx) * (gx - b.x);
      if (Math.abs(yAt - cy) < GW / 2 + 60) { shot = true; on = Math.abs(yAt - cy) < GW / 2 - 4; }
    }
    this.stats.kick = { id: c.id, team: c.team, n: c.name, u: c.num, t: this.simTime, shot, on };
    if (shot) {
      const ts = this.stats.tm[c.team], ps = this.pst(c.id, c.name, c.num, c.team);
      ts.sh++; ps.sh++;
      if (on) { ts.sot++; ps.sot++; }
    }
  }

  touch(c) {
    const t = this.touches, last = t[t.length - 1];
    if (last && last.id === c.id) {
      last.t = this.simTime;
      const k = this.stats.kick;
      if (k && k.id === c.id && this.simTime - k.t > 0.35) this.stats.kick = null; // topu kendisi geri aldı
      return;
    }
    this.resolveKick(c);
    t.push({ id: c.id, team: c.team, name: c.name, num: c.num, t: this.simTime });
    if (t.length > 6) t.shift();
  }

  tryKick(c) {
    const e = c.e, b = this.ball;
    if (e.kickCd > 0) return false;
    const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy);
    if (d > CFG.RING + b.r) return false; // top çembere 1 px bile girse vurulabilir
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    const str = 3 + 8 * e.pending.p;
    b.vx = b.vx * 0.3 + nx * str;
    b.vy = b.vy * 0.3 + ny * str;
    e.kickCd = 10;
    this.touch(c);
    this.registerKick(c);
    return true;
  }

  stepPlay(frozen) {
    const ents = [];
    for (const c of this.clients.values()) if (c.slot >= 0) ents.push(c);

    for (const c of ents) {
      const e = c.e, inp = c.inp;
      let ax = 0, ay = 0;
      if (!frozen) {
        ax = inp.dx; ay = inp.dy;
        const l = Math.hypot(ax, ay);
        if (l > 1) { ax /= l; ay /= l; }
      }
      const moving = ax !== 0 || ay !== 0;
      let acc = P.accel;
      const sprint = !frozen && inp.s && moving && !e.tired && e.stam > 0;
      e.sp = sprint ? 1 : 0;
      if (sprint) {
        acc = P.sprint;
        e.stam -= P.stamDrain;
        if (e.stam <= 0) { e.stam = 0; e.tired = true; }
      } else {
        e.stam = Math.min(1, e.stam + P.stamRegen);
        if (e.tired && e.stam > 0.25) e.tired = false;
      }
      if (inp.k && !frozen) acc *= 0.7;
      e.vx = (e.vx + ax * acc) * P.damp;
      e.vy = (e.vy + ay * acc) * P.damp;

      if (!frozen) {
        if (inp.k) { e.charge = Math.min(1, e.charge + DT / KICK_CHARGE_SECONDS); e.holding = true; }
        else if (e.holding) { e.holding = false; e.pending = { p: 0.3 + 0.7 * e.charge, ttl: 6 }; e.charge = 0; }
      } else { e.charge = 0; e.holding = false; e.pending = null; }
      if (e.kickCd > 0) e.kickCd--;
      e.x += e.vx; e.y += e.vy;
      clampPlayer(e);
    }

    const b = this.ball;
    b.x += b.vx; b.y += b.vy;
    b.vx *= B.damp; b.vy *= B.damp;
    if (Math.abs(b.vx) < 0.005) b.vx = 0;
    if (Math.abs(b.vy) < 0.005) b.vy = 0;

    for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) collide(ents[i].e, ents[j].e, P.rest);
    for (const c of ents) if (collide(c.e, b, B.hitRest)) this.touch(c);
    for (const c of ents) {
      const e = c.e;
      if (e.pending) {
        if (this.tryKick(c)) e.pending = null;
        else if (--e.pending.ttl <= 0) e.pending = null;
      }
    }
    clampBall(b);
    for (const p of this.posts) collide(b, p, 0.8);
    clampBall(b);
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > B.max) { b.vx *= B.max / sp; b.vy *= B.max / sp; }
    for (const c of ents) clampPlayer(c.e);
  }

  goalCheck() {
    const b = this.ball, { W, H, GW, BR } = CFG;
    if (Math.abs(b.y - H / 2) < GW / 2) {
      if (b.x + BR < 0) this.onGoal(1);
      else if (b.x - BR > W) this.onGoal(0);
    }
  }

  onGoal(team) {
    const t = this.touches, last = t[t.length - 1];
    let scorer = null, assist = null, og = false;
    if (last) {
      scorer = last;
      if (last.team === team) {
        const prev = t[t.length - 2];
        if (prev && prev.team === team && prev.id !== last.id && this.simTime - prev.t < 8) assist = prev;
      } else og = true;
    }
    if (scorer && !og) {
      const ts = this.stats.tm[scorer.team], ps = this.pst(scorer.id, scorer.name, scorer.num, scorer.team);
      const k = this.stats.kick;
      if (!(k && k.shot && k.id === scorer.id)) { ts.sh++; ps.sh++; ts.sot++; ps.sot++; }
      else if (!k.on) { ts.sot++; ps.sot++; }
      ps.g++;
      if (assist) this.pst(assist.id, assist.name, assist.num, assist.team).a++;
    }
    this.stats.kick = null;
    this.score[team]++;
    const el =Math.round(MATCH_SECONDS - this.matchTime);
    const g = {
      tm: team, min: Math.floor(el / 60) + ':' + String(el % 60).padStart(2, '0'),
      s: scorer ? scorer.name : null, sn: scorer ? scorer.num : 0,
      a: assist ? assist.name : null, an: assist ? assist.num : 0, og,
    };
    this.goals.push(g);
    this.phase = 'goal';
    this.timer = GOAL_SECONDS;
    this.broadcast(JSON.stringify({ t: 'goal', tm: team, sc: scorer ? { n: scorer.name, u: scorer.num } : null, as: assist ? { n: assist.name, u: assist.num } : null, og }));
    this.pushState();
    this.broadcast(this.statsMsg());
  }

  snap() {
    const p = [];
    for (const c of this.clients.values()) {
      if (c.slot < 0) continue;
      const e = c.e;
      p.push([c.id, r1(e.x), r1(e.y), Math.round(e.charge * 100), Math.round(e.stam * 100), e.sp]);
    }
    return JSON.stringify({ t: 's', r: r1(Math.max(0, this.matchTime)), c: r1(Math.max(0, this.timer)), p, b: [r1(this.ball.x), r1(this.ball.y)] });
  }

  get active() { return this.clients.size > 0 && this.phase !== 'lobby'; }

  tick() {
    switch (this.phase) {
      case 'countdown':
        this.stepPlay(true);
        this.timer -= DT;
        if (this.timer <= 0) { this.phase = 'play'; this.timer = 0; this.pushState(); }
        break;
      case 'play':
        this.simTime += DT;
        this.stepPlay(false);
        this.matchTime -= DT;
        { // topla oynama: topa son dokunan takım (5 sn içinde)
          const lt = this.touches[this.touches.length - 1];
          if (lt && this.simTime - lt.t < 5) this.stats.pos[lt.team]++;
        }
        this.goalCheck();
        if (this.phase === 'play' && this.matchTime <= 0) { this.matchTime = 0; this.endMatch(); }
        break;
      case 'goal':
        this.stepPlay(true);
        this.timer -= DT;
        if (this.timer <= 0) {
          if (this.matchTime <= 0) this.endMatch();
          else { this.resetPositions(); this.phase = 'countdown'; this.timer = RESTART_COUNTDOWN; this.pushState(); }
        }
        break;
      case 'end':
        this.stepPlay(true);
        this.timer -= DT;
        if (this.timer <= 0) this.toLobby(false);
        break;
      default: return;
    }
    if (this.phase === 'lobby') return;
    this.frame++;
    if (this.frame % SNAP_EVERY === 0) this.broadcast(this.snap(), true);
    if (this.frame % 60 === 0) this.broadcast(this.statsMsg(), true);
  }
}
Room.nextId = 0;

const rooms = Array.from({ length: ROOM_COUNT }, (_, i) => new Room(i));

// ---------------------------------------------------------------- statik dosyalar
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
const files = new Map();
function loadStatic() {
  files.clear();
  if (!fs.existsSync(PUB)) return;
  for (const f of fs.readdirSync(PUB)) {
    const full = path.join(PUB, f);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(f).toLowerCase();
    const type = MIME[ext];
    if (!type) continue;
    const buf = fs.readFileSync(full);
    const gz = /\.(html|css|js|svg|json)$/.test(ext) ? zlib.gzipSync(buf, { level: 9 }) : null;
    const etag = '"' + crypto.createHash('md5').update(buf).digest('hex').slice(0, 16) + '"';
    files.set('/' + f, { buf, gz, type, etag });
  }
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
}

function handleHttp(req, res) {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/servers') {
    const body = JSON.stringify(rooms.map((r) => r.info()));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const f = files.get(url);
  if (!f || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bulunamadı');
  }
  const h = { 'Content-Type': f.type, ETag: f.etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, h); return res.end(); }
  const useGz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = useGz ? f.gz : f.buf;
  if (useGz) h['Content-Encoding'] = 'gzip';
  h['Content-Length'] = body.length;
  res.writeHead(200, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- sunucu
function start(port) {
  loadStatic();
  const server = http.createServer(handleHttp);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048, perMessageDeflate: false });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let client = null, room = null;
    const idle = setTimeout(() => { if (!client) ws.close(); }, 15000);
    let n = 0, nt = Date.now();

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - nt > 1000) { nt = now; n = 0; }
      if (++n > 150) return;
      let m;
      try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (!client) {
        if (m.t !== 'join') return;
        const r = rooms[parseInt(m.room, 10)];
        if (!r) { ws.close(); return; }
        if (r.clients.size >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ t: 'err', m: 'Sunucu dolu (16/16)' }));
          ws.close();
          return;
        }
        room = r;
        client = r.addClient(ws, clean(m.name, 14) || 'Oyuncu', clampInt(m.num, 1, 99, 10));
        return;
      }
      room.onMsg(client, m);
    });
    ws.on('close', () => { clearTimeout(idle); if (client) room.removeClient(client); });
    ws.on('error', () => {});
  });

  // oyun döngüsü (sabit adım)
  let last = Date.now(), acc = 0;
  const loop = setInterval(() => {
    const now = Date.now();
    acc += now - last; last = now;
    if (acc > 250) acc = 250;
    const step = 1000 / HZ;
    while (acc >= step) {
      acc -= step;
      for (const r of rooms) if (r.active) r.tick();
    }
  }, 8);

  // bağlantı kontrolü (Render proxy'si boşta kalan soketleri kapatabilir)
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* yoksay */ }
    }
  }, 25000);

  server.listen(port, () => console.log('SoccerOnline v1.1 hazır: http://localhost:' + server.address().port));
  return { server, wss, stop() { clearInterval(loop); clearInterval(hb); wss.close(); server.close(); } };
}

if (require.main === module) start(PORT);

module.exports = { Room, rooms, start, CFG, FORMATIONS, slotPos, MATCH_SECONDS, DT };
