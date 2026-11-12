'use strict';
/**
 * SoccerOnline v1.3 — oyun sunucusu
 * Tek bağımlılık: ws. Statik dosyalar (gzip'li) + WebSocket oyun odaları.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUB = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.local.json');

const localUsers = new Map();
let pool = null;

async function initDb() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, pass TEXT NOT NULL)');
    return;
  }

  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Geçersiz kullanıcı verisi');
    for (const [username, user] of Object.entries(data)) {
      if (user && typeof user.pass === 'string') localUsers.set(username, { username, pass: user.pass });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

async function createUser(username, pass) {
  if (pool) {
    const result = await pool.query(
      'INSERT INTO users (username, pass) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING username',
      [username, pass]
    );
    return result.rowCount > 0;
  }

  if (localUsers.has(username)) return false;
  localUsers.set(username, { username, pass });
  try {
    const temp = USERS_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(localUsers)), { mode: 0o600 });
    fs.renameSync(temp, USERS_FILE);
    return true;
  } catch (e) {
    localUsers.delete(username);
    throw e;
  }
}

async function getUser(username) {
  if (pool) {
    const result = await pool.query('SELECT username, pass FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  }
  return localUsers.get(username) || null;
}

const db = { init: initDb, createUser, getUser };

// ---------------------------------------------------------------- ayarlar
// v1.3: GW 190 -> 209 (kale genişliği +%10) • KRING: kaleci çemberi (çember payı 10 -> 5 px, %50 küçük) • HOLD_T: tutma süresi
const CFG = { W: 1300, H: 640, GW: 209, GD: 46, R: 16, BR: 10, POST: 6, RING: 26, KRING: 21, BOX_W: 170, BOX_H: 360, HOLD_T: 3.5 };
const CFG11 = Object.assign({}, CFG, { W: 1690, H: 832, BOX_W: 221, BOX_H: 468 });   // 11v11: %30 büyük saha
// RING: şut çemberi yarıçapı (v1.1) • BOX_W/BOX_H: kalecinin topu eline alabildiği ceza sahası (v1.2)
const DEFAULT_MAX = 16;      // v1.2: sunucu kapasitesi 16..64 (8v8 oyuncu + taraftar)
const MIN_MAX = 16;
const MAX_MAX = 64;
const MAX_ROOMS = 40;
const HOLD_SECONDS = 3.5;    // v1.3: kaleci topu en fazla 3.5 sn tutabilir (v1.2: 5)
const SHOT_BOOST = 1.05;     // v1.3: şutlar %5 daha hızlı
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

const FORMATIONS11 = {
  '4-4-2': [['KL', .05, .5], ['SLB', .2, .15], ['SLS', .2, .38], ['SĞS', .2, .62], ['SĞB', .2, .85], ['SLK', .5, .13], ['SLO', .5, .38], ['SĞO', .5, .62], ['SĞK', .5, .87], ['SLF', .88, .35], ['SĞF', .88, .65]],
  '4-3-3': [['KL', .05, .5], ['SLB', .2, .15], ['SLS', .2, .38], ['SĞS', .2, .62], ['SĞB', .2, .85], ['SLO', .5, .2], ['OS', .5, .5], ['SĞO', .5, .8], ['SLK', .86, .14], ['FV', .9, .5], ['SĞK', .86, .86]],
  '3-5-2': [['KL', .05, .5], ['SLS', .2, .25], ['STP', .2, .5], ['SĞS', .2, .75], ['SLK', .5, .1], ['SLO', .5, .3], ['OS', .5, .5], ['SĞO', .5, .7], ['SĞK', .5, .9], ['SLF', .88, .35], ['SĞF', .88, .65]],
  '4-2-3-1': [['KL', .05, .5], ['SLB', .2, .15], ['SLS', .2, .38], ['SĞS', .2, .62], ['SĞB', .2, .85], ['SLO', .4, .35], ['SĞO', .4, .65], ['SLK', .62, .15], ['OOS', .62, .5], ['SĞK', .62, .85], ['FV', .9, .5]],
  '5-3-2': [['KL', .05, .5], ['SLB', .2, .1], ['SLS', .2, .3], ['STP', .2, .5], ['SĞS', .2, .7], ['SĞB', .2, .9], ['SLO', .5, .25], ['OS', .5, .5], ['SĞO', .5, .75], ['SLF', .88, .35], ['SĞF', .88, .65]],
};

// v1.1: damp 0.96 -> 0.92 (durma sonrası kayma %50 azaldı); maksimum hız = accel*damp/(1-damp) olduğundan
// accel/sprint yeniden hesaplandı: yürüme 2.88 -> 3.168 ve koşu 3.96 -> 4.356 (+%10).
// stamDrain 0.0035 / 1.25 (stamina %25 daha uzun dayanır).
const P = { accel: 0.2755, sprint: 0.3788, damp: 0.92, im: 0.5, rest: 0.3, stamDrain: 0.0028, stamRegen: 0.0018 };
const KICK_CHARGE_SECONDS = 0.675; // v1.1: 0.75 sn -> %10 daha hızlı şut dolumu
const B = { damp: 0.989, im: 1, wallRest: 0.65, hitRest: 0.4, max: 14 };

// ---------------------------------------------------------------- hesaplar (v1.3)
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('UYARI: SESSION_SECRET yok — her yeniden başlatmada herkesin oturumu kapanır.');
const TOKEN_DAYS = 30;
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
function makeToken(username) { const p = b64(JSON.stringify({ u: username, e: Date.now() + TOKEN_DAYS * 864e5 })); return p + '.' + sign(p); }
function verifyToken(t) {
  if (typeof t !== 'string') return null;
  const i = t.indexOf('.');
  if (i < 1) return null;
  const p = t.slice(0, i), sig = t.slice(i + 1), want = sign(p);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e > Date.now() && typeof o.u === 'string' ? o.u : null; } catch (e) { return null; }
}
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const USER_RE = /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]{3,14}$/;
const authLog = new Map(); // ip -> [zamanlar]
function authLimited(ip) {
  const now = Date.now(), a = (authLog.get(ip) || []).filter((t) => now - t < 60000);
  a.push(now); authLog.set(ip, a);
  if (authLog.size > 5000) authLog.clear();
  return a.length > 10;
}
function readJson(req, cb) {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 2048) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b)); } catch (e) { cb(null); } });
}
function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function clientIp(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim(); }
function handleAuth(req, res, url) {
  if (url === '/api/me') {
    const u = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    return u ? reply(res, 200, { name: u }) : reply(res, 401, { error: 'Oturum yok' });
  }
  if (req.method !== 'POST') return reply(res, 405, { error: 'Yöntem desteklenmiyor' });
  if (authLimited(clientIp(req))) return reply(res, 429, { error: 'Çok fazla deneme, biraz bekle' });
  readJson(req, async (m) => {
    try {
      if (!m || typeof m.name !== 'string' || typeof m.pass !== 'string') return reply(res, 400, { error: 'Eksik bilgi' });
      const name = m.name.trim(), pass = m.pass;
      if (url === '/api/register') {
        if (!USER_RE.test(name)) return reply(res, 400, { error: 'Kullanıcı adı 3-14 karakter; harf, rakam veya _ olmalı' });
        if (pass.length < 6 || pass.length > 64) return reply(res, 400, { error: 'Parola 6-64 karakter olmalı' });
        const ok = await db.createUser(name, hashPw(pass));
        return ok ? reply(res, 200, { name, token: makeToken(name) }) : reply(res, 409, { error: 'Bu kullanıcı adı alınmış' });
      }
      if (url === '/api/login') {
        const u = USER_RE.test(name) ? await db.getUser(name) : null;
        if (!u || !checkPw(pass, u.pass)) return reply(res, 401, { error: 'Kullanıcı adı veya parola yanlış' });
        return reply(res, 200, { name: u.username, token: makeToken(u.username) });
      }
      return reply(res, 404, { error: 'Bulunamadı' });
    } catch (e) { console.error('auth hatası', e.message); return reply(res, 500, { error: 'Sunucu hatası' }); }
  });
}

// ---------------------------------------------------------------- yardımcılar
const r1 = (v) => Math.round(v * 10) / 10;
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, a, b, d) => {
  v = parseInt(v, 10);
  return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d;
};
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function slotPos(forms, formation, slot, team, cfg) {
  const f = (forms[formation] || Object.values(forms)[0])[slot];
  const px = 30 + f[1] * (cfg.W / 2 - 80);
  const py = f[2] * cfg.H;
  return team === 0 ? { x: px, y: py } : { x: cfg.W - px, y: cfg.H - py };
}

function mkTeam(name, color, formation, n) {
  return { name, color, formation, captain: null, ready: false, slots: new Array(n).fill(null) };
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

// v1.3: oyuncular kalenin içine girebilir (ağ içinde direklerin arasında hareket eder)
function clampPlayer(e, cfg) {
  const { W, H, R, GW, GD, POST } = cfg;
  const cy = H / 2, lim = GW / 2 - R - POST;
  if (e.y < R) { e.y = R; if (e.vy < 0) e.vy = 0; } else if (e.y > H - R) { e.y = H - R; if (e.vy > 0) e.vy = 0; }
  const px = e.px === undefined ? e.x : e.px;
  if (e.x < R) {
    if (Math.abs(e.y - cy) > lim && px >= R) { e.x = R; if (e.vx < 0) e.vx = 0; }
    else {
      if (e.y < cy - lim) { e.y = cy - lim; if (e.vy < 0) e.vy = 0; } else if (e.y > cy + lim) { e.y = cy + lim; if (e.vy > 0) e.vy = 0; }
      if (e.x < -GD + R) { e.x = -GD + R; if (e.vx < 0) e.vx = 0; }
    }
  } else if (e.x > W - R) {
    if (Math.abs(e.y - cy) > lim && px <= W - R) { e.x = W - R; if (e.vx > 0) e.vx = 0; }
    else {
      if (e.y < cy - lim) { e.y = cy - lim; if (e.vy < 0) e.vy = 0; } else if (e.y > cy + lim) { e.y = cy + lim; if (e.vy > 0) e.vy = 0; }
      if (e.x > W + GD - R) { e.x = W + GD - R; if (e.vx > 0) e.vx = 0; }
    }
  }
}

function constrainLeft(b, cfg) {
  const { GW, GD, BR, H } = cfg;
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

function clampBall(b, cfg) {
  const { W, H, BR } = cfg;
  if (b.x >= 0 && b.x <= W) {
    if (b.y < BR) { b.y = BR; if (b.vy < 0) b.vy = -b.vy * B.wallRest; }
    else if (b.y > H - BR) { b.y = H - BR; if (b.vy > 0) b.vy = -b.vy * B.wallRest; }
  }
  constrainLeft(b, cfg);
  b.x = W - b.x; b.vx = -b.vx;
  constrainLeft(b, cfg);
  b.x = W - b.x; b.vx = -b.vx;
}

// ---------------------------------------------------------------- oda
class Room {
  constructor(id, opts) {
    opts = opts || {};
    this.id = id;
    this.name = opts.name || 'Sunucu ' + id;
    this.max = clampInt(opts.max, MIN_MAX, MAX_MAX, DEFAULT_MAX);
    this.passHash = null;
    this.setPass(opts.pass);
    this.ownerId = null;
    this.creatorIp = opts.ip || '';
    this.banned = new Map();
    this.holder = null;
    this.dead = false;
    this.n = opts.mode === 11 ? 11 : 8;                         // takım başına oyuncu (v1.3: 11v11)
    this.cfg = this.n === 11 ? CFG11 : CFG;
    this.forms = this.n === 11 ? FORMATIONS11 : FORMATIONS;
    this.defForm = this.n === 11 ? '4-4-2' : '3-3-1';
    this.fixed = !!opts.fixed;                                  // kalıcı sunucu: sahibi yok, boşalınca kapanmaz
    this.clients = new Map();
    this.frame = 0;
    this.posts = [];
    const cy = this.cfg.H / 2, hg = this.cfg.GW / 2;
    for (const x of [0, this.cfg.W]) for (const y of [cy - hg, cy + hg]) {
      this.posts.push({ x, y, vx: 0, vy: 0, r: this.cfg.POST, im: 0 });
    }
    this.ball = { x: this.cfg.W / 2, y: this.cfg.H / 2, vx: 0, vy: 0, r: this.cfg.BR, im: B.im };
    this.resetAll();
  }

  resetAll() {
    this.teams = [mkTeam('Takım A', '#e53935', this.defForm, this.n), mkTeam('Takım B', '#1e88e5', this.defForm, this.n)];
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
    this.ball.x = this.cfg.W / 2; this.ball.y = this.cfg.H / 2; this.ball.vx = 0; this.ball.vy = 0;
    if (!silent) this.pushState();
  }

  // ---- parola (v1.2)
  hashPass(p) { return crypto.createHash('sha256').update('so:' + this.id + ':' + p).digest(); }
  setPass(p) { p = typeof p === 'string' ? p.trim().slice(0, 20) : ''; this.passHash = p ? this.hashPass(p) : null; }
  checkPass(p) {
    if (!this.passHash) return true;
    if (typeof p !== 'string') return false;
    return crypto.timingSafeEqual(this.hashPass(p.trim().slice(0, 20)), this.passHash);
  }
  isBanned(ip) {
    const t = this.banned.get(ip);
    if (!t) return false;
    if (t < Date.now()) { this.banned.delete(ip); return false; }
    return true;
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
    for (const c of this.clients.values()) players.push({ id: c.id, n: c.name, u: c.num, tm: c.team, sl: c.slot, ft: c.fan, v: c.acct ? 1 : 0 });
    return JSON.stringify({ t: 'state', ph: this.phase, sc: this.score, teams, players, goals: this.goals, own: this.ownerId, lock: !!this.passHash, max: this.max });
  }
  pushState() { this.broadcast(this.stateMsg()); }
  info() {
    const o = this.clients.get(this.ownerId);
    return { id: this.id, name: this.name, count: this.clients.size, max: this.max, n: this.n, lock: !!this.passHash, own: o ? o.name : '', ph: this.phase, sc: this.score, left: Math.ceil(this.matchTime || 0) };
  }

  // ---- oyuncular
  addClient(ws, name, number, ip, acct) {
    const c = {
      id: ++Room.nextId, ws, name, num: number, team: -1, slot: -1, takenAt: 0, ip: ip || '', acct: !!acct, fan: -1, lastSay: 0,
      inp: { dx: 0, dy: 0, s: false, k: false, g: false },
      e: { x: 0, y: 0, vx: 0, vy: 0, r: this.cfg.R, im: P.im, charge: 0, holding: false, pending: null, kickCd: 0, stam: 1, tired: false, sp: 0,
        fx: 1, fy: 0, hold: false, holdT: 0, grabCd: 0, px: 0 },
    };
    this.clients.set(c.id, c);
    if (this.ownerId == null && !this.fixed) this.ownerId = c.id;
    this.send(c, JSON.stringify({ t: 'hi', id: c.id, room: this.name, cfg: this.cfg, forms: this.forms, max: this.max }));
    this.pushState();
    this.send(c, this.statsMsg());
    return c;
  }

  removeClient(c) {
    if (!this.clients.has(c.id)) return;
    this.freeSlot(c);
    this.clients.delete(c.id);
    if (this.holder === c) this.holder = null;
    if (this.clients.size === 0) {
      if (this.fixed) { this.resetAll(); return; }
      this.dead = true; rooms.delete(this.id); return;
    }
    if (this.ownerId === c.id) this.ownerId = this.clients.keys().next().value;
    this.pushState();
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
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.n) return;
    const t = this.teams[team];
    if (t.slots[slot] != null) return;
    if (c.team === team && c.slot === slot) return;
    this.freeSlot(c);
    t.slots[slot] = c.id;
    c.team = team; c.slot = slot; c.takenAt = Date.now() + Math.random();
    if (t.captain == null) { t.captain = c.id; t.ready = false; }
    c.inp = { dx: 0, dy: 0, s: false, k: false, g: false };
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
    if (typeof m.formation === 'string' && this.forms[m.formation] && this.phase === 'lobby' && t.formation !== m.formation) {
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
        i.s = !!m.s; i.k = !!m.k; i.g = !!m.g;
        break;
      }
      case 'kick': this.kickPlayer(c, m.id); break;
      case 'setpass': this.ownerPass(c, m.v); break;
      case 'support': {
        const v = m.v === 0 || m.v === 1 ? m.v : -1;
        if (c.fan !== v) { c.fan = v; this.pushState(); }
        break;
      }
      case 'say': this.say(c, m.txt); break;
      case 'take': this.take(c, m.team, m.slot); break;
      case 'leave': this.leave(c); break;
      case 'team': this.setTeam(c, m); break;
      case 'ready': this.setReady(c, m.v); break;
      default: break;
    }
  }

  // ---- sunucu sahibi (v1.2)
  kickPlayer(c, id) {
    if (c.id !== this.ownerId) return;
    const t = this.clients.get(id);
    if (!t || t === c) return;
    if (t.ip) this.banned.set(t.ip, Date.now() + 60000);
    this.send(t, JSON.stringify({ t: 'err', m: 'Sunucu sahibi seni attı' }));
    this.removeClient(t);
    try { t.ws.close(); } catch (e) { /* yoksay */ }
  }

  ownerPass(c, v) {
    if (c.id !== this.ownerId) return;
    this.setPass(v);
    this.pushState();
    this.send(c, JSON.stringify({ t: 'info', m: this.passHash ? 'Parola ayarlandı' : 'Parola kaldırıldı' }));
  }

  // ---- taraftar sohbeti (v1.2): sadece oyuna girmemiş taraftarlar tribünden konuşur
  say(c, txt) {
    if (c.slot >= 0) return;
    const now = Date.now();
    if (now - c.lastSay < 1200) return;
    const t = clean(txt, 60);
    if (!t) return;
    c.lastSay = now;
    this.broadcast(JSON.stringify({ t: 'say', id: c.id, n: c.name, ft: c.fan, txt: t }), true);
  }

  // ---- maç akışı
  placeEnt(c) {
    if (c.team < 0) return;
    const p = slotPos(this.forms, this.teams[c.team].formation, c.slot, c.team, this.cfg);
    const e = c.e;
    e.x = p.x; e.y = p.y; e.px = p.x; e.vx = 0; e.vy = 0;
    e.charge = 0; e.holding = false; e.pending = null; e.kickCd = 0; e.stam = 1; e.tired = false; e.sp = 0;
    e.hold = false; e.holdT = 0; e.grabCd = 0; e.fx = c.team === 0 ? 1 : -1; e.fy = 0;
    if (this.holder === c) this.holder = null;
  }

  resetPositions() {
    for (const c of this.clients.values()) this.placeEnt(c);
    const b = this.ball;
    b.x = this.cfg.W / 2; b.y = this.cfg.H / 2; b.vx = 0; b.vy = 0;
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
    const b = this.ball, { W, H, GW } = this.cfg, cy = H / 2;
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
      if (k && k.id === c.id && this.simTime - k.t > 0.35) this.stats.kick = null;
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
    const ring = c.slot === 0 ? this.cfg.KRING : this.cfg.RING;
    if (d > ring + b.r) return false;
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    const str = (3 + 8 * e.pending.p) * SHOT_BOOST;
    b.vx = b.vx * 0.3 + nx * str;
    b.vy = b.vy * 0.3 + ny * str;
    e.kickCd = 10;
    this.touch(c);
    this.registerKick(c);
    return true;
  }

  // ---- kaleci (v1.2)
  inBox(team, x, y) {
    const { W, H, BOX_W, BOX_H } = this.cfg;
    if (Math.abs(y - H / 2) > BOX_H / 2) return false;
    return team === 0 ? x <= BOX_W : x >= W - BOX_W;
  }

  dropBall(c) {
    const e = c.e;
    e.hold = false; e.holdT = 0; e.grabCd = 60;
    if (this.holder === c) this.holder = null;
    this.ball.vx = 0; this.ball.vy = 0;
  }

  throwBall(c, p, auto) {
    const e = c.e, b = this.ball, str = (3 + 8 * p) * SHOT_BOOST;
    let fx = e.fx, fy = e.fy;
    if (auto) {
      fx = c.team === 0 ? 1 : -1; fy = e.fy * 0.5;
      const l = Math.hypot(fx, fy); fx /= l; fy /= l;
    }
    e.hold = false; e.holdT = 0; e.grabCd = 90; e.kickCd = 10; e.charge = 0;
    if (this.holder === c) this.holder = null;
    b.vx = fx * str; b.vy = fy * str;
    this.touch(c);
    this.registerKick(c);
  }

  keeperStep(c, frozen) {
    const e = c.e, b = this.ball;
    if (e.grabCd > 0) e.grabCd--;
    if (e.hold) {
      if (frozen || !this.inBox(c.team, e.x, e.y)) { this.dropBall(c); return; }
      if (e.pending) { const p = e.pending.p; e.pending = null; this.throwBall(c, p, false); return; }
      if (--e.holdT <= 0) this.throwBall(c, 0.55, true);
      return;
    }
    if (frozen || !c.inp.g || e.grabCd > 0 || this.holder) return;
    if (!this.inBox(c.team, e.x, e.y) || !this.inBox(c.team, b.x, b.y)) return;
    if (Math.hypot(b.x - e.x, b.y - e.y) > this.cfg.KRING + b.r) return;
    e.hold = true; e.holdT = HOLD_SECONDS * HZ; e.pending = null;
    this.holder = c;
    b.vx = 0; b.vy = 0;
    this.touch(c);
  }

  stepPlay(frozen) {
    const ents = [];
    for (const c of this.clients.values()) if (c.slot >= 0) ents.push(c);
    if (this.holder && (!this.holder.e.hold || this.holder.slot !== 0 || !this.clients.has(this.holder.id))) this.holder = null;

    for (const c of ents) {
      const e = c.e, inp = c.inp;
      let ax = 0, ay = 0;
      if (!frozen) {
        ax = inp.dx; ay = inp.dy;
        const l = Math.hypot(ax, ay);
        if (l > 1) { ax /= l; ay /= l; }
      }
      const moving = ax !== 0 || ay !== 0;
      if (moving) { const l = Math.hypot(ax, ay); e.fx = ax / l; e.fy = ay / l; }
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
      if (e.hold) acc *= 0.85;
      e.vx = (e.vx + ax * acc) * P.damp;
      e.vy = (e.vy + ay * acc) * P.damp;

      if (!frozen) {
        if (inp.k) { e.charge = Math.min(1, e.charge + DT / KICK_CHARGE_SECONDS); e.holding = true; }
        else if (e.holding) { e.holding = false; e.pending = { p: 0.3 + 0.7 * e.charge, ttl: 6 }; e.charge = 0; }
      } else { e.charge = 0; e.holding = false; e.pending = null; }
      if (e.kickCd > 0) e.kickCd--;
      e.px = e.x;
      e.x += e.vx; e.y += e.vy;
      clampPlayer(e, this.cfg);
      for (const p of this.posts) collide(p, e, 0.3);
    }

    const b = this.ball;
    if (!this.holder) {
      b.x += b.vx; b.y += b.vy;
      b.vx *= B.damp; b.vy *= B.damp;
      if (Math.abs(b.vx) < 0.005) b.vx = 0;
      if (Math.abs(b.vy) < 0.005) b.vy = 0;
    }

    for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) collide(ents[i].e, ents[j].e, P.rest);
    for (const c of ents) if (c.slot === 0) this.keeperStep(c, frozen);

    if (this.holder) {
      const e = this.holder.e, off = this.cfg.R + this.cfg.BR + 2;
      b.x = clampN(e.x + e.fx * off, this.cfg.BR + 2, this.cfg.W - this.cfg.BR - 2);
      b.y = clampN(e.y + e.fy * off, this.cfg.BR + 2, this.cfg.H - this.cfg.BR - 2);
      b.vx = 0; b.vy = 0;
    } else {
      for (const c of ents) if (collide(c.e, b, B.hitRest)) this.touch(c);
      for (const c of ents) {
        const e = c.e;
        if (e.pending) {
          if (this.tryKick(c)) e.pending = null;
          else if (--e.pending.ttl <= 0) e.pending = null;
        }
      }
      clampBall(b, this.cfg);
      for (const p of this.posts) collide(b, p, 0.8);
      clampBall(b, this.cfg);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > B.max) { b.vx *= B.max / sp; b.vy *= B.max / sp; }
    }
    for (const c of ents) clampPlayer(c.e, this.cfg);
  }

  goalCheck() {
    const b = this.ball, { W, H, GW, BR } = this.cfg;
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
    const el = Math.round(MATCH_SECONDS - this.matchTime);
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
      p.push([c.id, r1(e.x), r1(e.y), Math.round(e.charge * 100), Math.round(e.stam * 100), e.sp, e.hold ? Math.max(1, Math.round(e.holdT / 6)) : 0]);
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
        {
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

// v1.2: sabit sunucular kaldırıldı — sunucuları oyuncular kurar
const rooms = new Map();
let roomSeq = 0;
const BIG_ID = 0;   // v1.3: tek kalıcı 11v11 sunucusu (listede görünmez, menüdeki butonla girilir)
rooms.set(BIG_ID, new Room(BIG_ID, { name: '11v11 Maç', max: 64, mode: 11, fixed: true }));
function createRoom(opts) {
  const r = new Room(++roomSeq, opts);
  rooms.set(r.id, r);
  return r;
}

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
    const body = JSON.stringify([...rooms.values()].filter((r) => !r.fixed).map((r) => r.info()));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (url === '/api/me' || url === '/api/register' || url === '/api/login') return handleAuth(req, res, url);
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

  wss.on('connection', (ws, req) => {
    const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim();
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
        const au = verifyToken(m.token);
        const pname = au || clean(m.t === 'create' ? m.pname : m.name, 14) || 'Oyuncu';
        const pnum = clampInt(m.num, 1, 99, 10);
        const fail = (msg) => { ws.send(JSON.stringify({ t: 'err', m: msg })); ws.close(); };
        if (m.t === 'join') {
          const r = rooms.get(parseInt(m.room, 10));
          if (!r) return fail('Sunucu bulunamadı');
          if (r.clients.size >= r.max) return fail('Sunucu dolu (' + r.max + '/' + r.max + ')');
          if (r.isBanned(ip)) return fail('Bu sunucudan atıldın, biraz bekle');
          if (!r.checkPass(m.pass)) return fail('Parola yanlış');
          room = r;
          client = r.addClient(ws, pname, pnum, ip, !!au);
        } else if (m.t === 'create') {
          if (rooms.size >= MAX_ROOMS) return fail('Sunucu sınırına ulaşıldı, daha sonra dene');
          let mine = 0;
          for (const r of rooms.values()) if (r.creatorIp === ip) mine++;
          if (mine >= 3) return fail('En fazla 3 sunucu kurabilirsin');
          const sname = clean(m.name, 24);
          if (!sname) return fail('Sunucu ismi gerekli');
          room = createRoom({ name: sname, max: m.max, pass: m.pass, ip });
          client = room.addClient(ws, pname, pnum, ip, !!au);
        }
        return;
      }
      room.onMsg(client, m);
    });
    ws.on('close', () => { clearTimeout(idle); if (client) room.removeClient(client); });
    ws.on('error', () => {});
  });

  let last = Date.now(), acc = 0;
  const loop = setInterval(() => {
    const now = Date.now();
    acc += now - last; last = now;
    if (acc > 250) acc = 250;
    const step = 1000 / HZ;
    while (acc >= step) {
      acc -= step;
      for (const r of rooms.values()) if (r.active) r.tick();
    }
  }, 8);

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* yoksay */ }
    }
  }, 25000);

  server.listen(port, () => console.log('SoccerOnline v1.3 hazır: http://localhost:' + server.address().port));
  return { server, wss, stop() { clearInterval(loop); clearInterval(hb); wss.close(); server.close(); } };
}

if (require.main === module) db.init().then(() => start(PORT)).catch((e) => { console.error('Veritabanı başlatılamadı:', e.message); process.exit(1); });

module.exports = { Room, rooms, createRoom, start, CFG, CFG11, FORMATIONS, FORMATIONS11, slotPos, MATCH_SECONDS, DT };
