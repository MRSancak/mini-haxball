'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'users.json');

const W = 1000;
const H = 600;
const MATCH_MS = 300000;
const MAX_PLAYERS = 12;
const GOAL_CELEBRATION_MS = 5000;

const ROLE_CAP = { DEF: 2, MID: 3, FWD: 1 };
const ROLE_NAMES = {
  DEF: 'Defans',
  MID: 'Orta saha',
  FWD: 'Forvet'
};

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let users = {};

try {
  users = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch {
  users = {};
}

function saveUsers() {
  const temp = DB_PATH + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(users, null, 2));
  fs.renameSync(temp, DB_PATH);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function passwordMatches(password, user) {
  if (!user || !user.salt || !user.passwordHash) return false;

  const a = Buffer.from(hashPassword(password, user.salt), 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUser(username) {
  const u = users[username];
  if (!u) return null;

  const roleEntries = Object.entries(u.stats.roles || {});
  roleEntries.sort((a, b) => b[1] - a[1]);

  return {
    username,
    displayName: u.displayName,
    number: u.number,
    stats: {
      matches: u.stats.matches || 0,
      goals: u.stats.goals || 0,
      assists: u.stats.assists || 0,
      roles: u.stats.roles || {},
      mostPlayedRole: roleEntries.length
        ? ROLE_NAMES[roleEntries[0][0]]
        : 'Henüz yok'
    }
  };
}

function ensureStats(u) {
  if (!u.stats) {
    u.stats = { matches: 0, goals: 0, assists: 0, roles: {} };
  }

  u.stats.matches ||= 0;
  u.stats.goals ||= 0;
  u.stats.assists ||= 0;
  u.stats.roles ||= {};

  for (const role of Object.keys(ROLE_CAP)) {
    u.stats.roles[role] ||= 0;
  }
}

for (const u of Object.values(users)) ensureStats(u);

try {
  saveUsers();
} catch (e) {
  console.error('Kullanıcı veritabanı kaydedilemedi:', e.message);
}

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  const number = Number(req.body.number);

  if (!/^[a-z0-9_]{3,18}$/.test(username)) {
    return res.status(400).json({
      error: 'Kullanıcı adı 3-18 karakter olmalı; harf, sayı ve _ kullanılabilir.'
    });
  }

  if (displayName.length < 2 || displayName.length > 18) {
    return res.status(400).json({
      error: 'Görünen isim 2-18 karakter olmalı.'
    });
  }

  if (password.length < 6 || password.length > 100) {
    return res.status(400).json({
      error: 'Şifre 6-100 karakter arasında olmalı.'
    });
  }

  if (!Number.isInteger(number) || number < 1 || number > 99) {
    return res.status(400).json({
      error: 'Forma numarası 1-99 arasında olmalı.'
    });
  }

  if (users[username]) {
    return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');

  users[username] = {
    displayName,
    number,
    salt,
    passwordHash: hashPassword(password, salt),
    stats: {
      matches: 0,
      goals: 0,
      assists: 0,
      roles: { DEF: 0, MID: 0, FWD: 0 }
    }
  };

  try {
    saveUsers();
  } catch {
    delete users[username];
    return res.status(500).json({ error: 'Hesap kaydedilemedi.' });
  }

  res.json({ user: publicUser(username) });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!passwordMatches(password, users[username])) {
    return res.status(401).json({
      error: 'Kullanıcı adı veya şifre yanlış.'
    });
  }

  res.json({ user: publicUser(username) });
});

app.get('/api/profile/:username', (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const profile = publicUser(username);

  if (!profile) {
    return res.status(404).json({ error: 'Bu kullanıcı bulunamadı.' });
  }

  res.json({ user: profile });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    players: players.size,
    game: 'Mini Haxball Pixel'
  });
});

const players = new Map();

let ball = {
  x: W / 2,
  y: H / 2,
  vx: 0,
  vy: 0,
  owner: null,
  lastTouch: null,
  assistCandidate: null
};

let score = [0, 0];
let matchStarted = Date.now();
let lastGoal = 0;
let matchId = 1;
let lastTick = Date.now();
let goalEvent = null;
let goalResetAt = 0;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast() {
  const message = JSON.stringify(snapshot());

  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(message);
    }
  }
}

function snapshot() {
  return {
    type: 'state',
    world: {
      w: W,
      h: H,
      score,
      remaining: Math.max(0, MATCH_MS - (Date.now() - matchStarted)),
      matchId,
      goalEvent
    },
    ball: { ...ball },
    players: [...players.values()].map(p => ({
      id: p.id,
      username: p.username,
      name: p.name,
      number: p.number,
      team: p.team,
      role: p.role,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      facingX: p.facingX,
      facingY: p.facingY,
      stamina: p.stamina,
      hasBall: ball.owner === p.id
    }))
  };
}

function saveStatsSafely() {
  try {
    saveUsers();
  } catch (e) {
    console.error('İstatistik kaydedilemedi:', e.message);
  }
}

function updateStats(username, field, amount = 1) {
  const u = users[username];
  if (!u) return;

  ensureStats(u);
  u.stats[field] = (u.stats[field] || 0) + amount;
}

function resetBall() {
  ball = {
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    owner: null,
    lastTouch: null,
    assistCandidate: null
  };
}

function resetPositions() {
  for (const p of players.values()) {
    if (p.team === null || !p.role) {
      p.x = W / 2;
      p.y = H / 2;
      p.vx = 0;
      p.vy = 0;
      continue;
    }

    const left = p.team === 0;
    const row = p.slot % 2 === 0 ? 220 : 380;

    if (p.role === 'DEF') {
      p.x = left ? 220 : 780;
      p.y = row;
    } else if (p.role === 'MID') {
      p.x = left ? 365 : 635;
      p.y = 150 + p.slot * 75;
    } else {
      p.x = left ? 445 : 555;
      p.y = 300;
    }

    p.vx = 0;
    p.vy = 0;
    p.facingX = left ? 1 : -1;
    p.facingY = 0;
  }

  resetBall();
}

function roleCounts(team, role, exceptId = null) {
  return [...players.values()].filter(
    p => p.id !== exceptId && p.team === team && p.role === role
  ).length;
}

function assignPlayer(p, team, role) {
  if (![0, 1].includes(team) || !ROLE_CAP[role]) return false;

  if (roleCounts(team, role, p.id) >= ROLE_CAP[role]) return false;

  p.team = team;
  p.role = role;
  p.slot = roleCounts(team, role, p.id);

  ensureStats(users[p.username]);
  users[p.username].stats.roles[role] =
    (users[p.username].stats.roles[role] || 0) + 1;

  saveStatsSafely();
  resetPositions();

  return true;
}

function removePlayer(p) {
  if (!p) return;

  if (ball.owner === p.id) {
    ball.owner = null;
    ball.lastTouch = p.id;
  }

  players.delete(p.id);
  broadcast();
}

function joinGame(ws, username) {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { type: 'error', message: 'Sunucu dolu (12/12).' });
    return null;
  }

  if ([...players.values()].some(p => p.username === username)) {
    send(ws, { type: 'error', message: 'Bu hesap zaten oyunda.' });
    return null;
  }

  const u = users[username];
  if (!u) return null;

  const p = {
    id: crypto.randomUUID(),
    ws,
    username,
    name: u.displayName,
    number: u.number,
    team: null,
    role: null,
    slot: 0,
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    facingX: 1,
    facingY: 0,
    stamina: 100,
    input: { up: false, down: false, left: false, right: false },
    tackleUntil: 0,
    lastKick: 0,
    matchRecorded: false
  };

  players.set(p.id, p);

  send(ws, {
    type: 'joined',
    id: p.id,
    user: publicUser(username)
  });

  broadcast();
  return p;
}

function attemptTackle(p) {
  const now = Date.now();

  if (now < p.tackleUntil || goalEvent) return;

  p.tackleUntil = now + 450;

  if (ball.owner) {
    const target = players.get(ball.owner);

    if (
      target &&
      target.team !== p.team &&
      dist(p, target) < 42
    ) {
      ball.owner = p.id;
      ball.lastTouch = p.id;
      ball.assistCandidate = null;
      ball.vx = 0;
      ball.vy = 0;
    }
  } else if (dist(p, ball) < 37) {
    ball.owner = p.id;
    ball.lastTouch = p.id;
    ball.assistCandidate = null;
    ball.vx = 0;
    ball.vy = 0;
  }
}

function attemptKick(p, action) {
  if (goalEvent || ball.owner !== p.id || Date.now() - p.lastKick < 250) {
    return;
  }

  let dx = Number(p.input.right) - Number(p.input.left);
  let dy = Number(p.input.down) - Number(p.input.up);

  if (!dx && !dy) {
    dx = p.facingX;
    dy = p.facingY;
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const previousTouch = ball.lastTouch
    ? players.get(ball.lastTouch)
    : null;

  if (action === 'pass') {
    ball.assistCandidate =
      previousTouch &&
      previousTouch.id !== p.id &&
      previousTouch.team === p.team
        ? previousTouch.id
        : null;
  } else {
    // Şut atan oyuncu, golün sahibi olarak kaydedilir.
    ball.assistCandidate =
      ball.assistCandidate &&
      ball.assistCandidate !== p.id
        ? ball.assistCandidate
        : null;
  }

  ball.owner = null;
  ball.lastTouch = p.id;
  ball.x = p.x + dx * 22;
  ball.y = p.y + dy * 22;
  ball.vx = dx * (action === 'pass' ? 7.2 : 11.8);
  ball.vy = dy * (action === 'pass' ? 7.2 : 11.8);
  p.lastKick = Date.now();
}

function scoreGoal(teamScored) {
  if (goalEvent) return;

  const scorer = ball.lastTouch ? players.get(ball.lastTouch) : null;
  let assist = ball.assistCandidate ? players.get(ball.assistCandidate) : null;

  if (
    !assist ||
    !scorer ||
    assist.id === scorer.id ||
    assist.team !== scorer.team
  ) {
    assist = null;
  }

  score[teamScored]++;

  if (scorer && scorer.team === teamScored) {
    updateStats(scorer.username, 'goals');
  }

  if (assist && scorer && assist.team === scorer.team) {
    updateStats(assist.username, 'assists');
  }

  saveStatsSafely();

  goalEvent = {
    team: teamScored,
    scorer: scorer
      ? { username: scorer.username, name: scorer.name, number: scorer.number }
      : null,
    assist: assist
      ? { username: assist.username, name: assist.name, number: assist.number }
      : null,
    expiresAt: Date.now() + GOAL_CELEBRATION_MS
  };

  goalResetAt = goalEvent.expiresAt;
  lastGoal = Date.now();

  for (const p of players.values()) {
    p.input = { up: false, down: false, left: false, right: false };
    p.vx = 0;
    p.vy = 0;
  }

  broadcast();
}

function recordMatch() {
  for (const p of players.values()) {
    if (p.matchRecorded || p.team === null || !p.role) continue;

    updateStats(p.username, 'matches');
    p.matchRecorded = true;
  }

  saveStatsSafely();
}

wss.on('connection', ws => {
  let player = null;

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth') {
      const username = String(msg.username || '').trim().toLowerCase();

      // Bu basit token, prototip içindir; gerçek yayın öncesinde
      // güvenli sunucu oturumlarıyla değiştirilmelidir.
      if (!users[username] || msg.token !== 'pixel:' + username) {
        send(ws, { type: 'error', message: 'Oturum doğrulanamadı. Yeniden giriş yap.' });
        return;
      }

      if (player) removePlayer(player);
      player = joinGame(ws, username);
      return;
    }

    if (!player) return;

    if (msg.type === 'select') {
      const ok = assignPlayer(
        player,
        Number(msg.team),
        String(msg.role || '')
      );

      if (!ok) {
        send(ws, { type: 'error', message: 'Bu mevki dolu veya seçim geçersiz.' });
        return;
      }

      send(ws, {
        type: 'selected',
        team: player.team,
        role: player.role,
        roleName: ROLE_NAMES[player.role]
      });

      broadcast();
      return;
    }

    if (msg.type !== 'input') return;

    for (const key of ['up', 'down', 'left', 'right']) {
      player.input[key] = !!msg[key];
    }

    let dx = Number(player.input.right) - Number(player.input.left);
    let dy = Number(player.input.down) - Number(player.input.up);

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }

    if (goalEvent) return;

    if (msg.action === 'kick') {
      if (ball.owner === player.id) attemptKick(player, 'shot');
      else attemptTackle(player);
    } else if (msg.action === 'pass') {
      attemptKick(player, 'pass');
    } else if (msg.action === 'tackle') {
      attemptTackle(player);
    }
  });

  ws.on('close', () => removePlayer(player));
  ws.on('error', () => removePlayer(player));
});

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 16.6667, 2);
  lastTick = now;

  if (goalEvent) {
    if (now >= goalResetAt) {
      goalEvent = null;
      resetPositions();
      broadcast();
    }
    return;
  }

  if (now - matchStarted >= MATCH_MS) {
    recordMatch();
    score = [0, 0];
    matchStarted = now;
    matchId++;
    for (const p of players.values()) p.matchRecorded = false;
    resetPositions();
    broadcast();
  }

  for (const p of players.values()) {
    if (p.team === null || !p.role) continue;

    let dx = Number(p.input.right) - Number(p.input.left);
    let dy = Number(p.input.down) - Number(p.input.up);
    const len = Math.hypot(dx, dy) || 1;

    if (dx || dy) {
      dx /= len;
      dy /= len;
      p.facingX = dx;
      p.facingY = dy;

      // Tam hareket halinde yaklaşık 10 saniyede tükenir.
      p.stamina = Math.max(0, p.stamina - (100 * dt / (10 * 60)));
    } else {
      p.stamina = Math.min(100, p.stamina + (18 * dt / 60));
    }

    const baseSpeed = 3.15 * 1.10;
    const speed = baseSpeed * (p.stamina <= 0 ? 0.25 : 1);

    p.vx += dx * speed * 0.22 * dt;
    p.vy += dy * speed * 0.22 * dt;

    const velocity = Math.hypot(p.vx, p.vy);
    const maxVelocity = speed * 1.8;

    if (velocity > maxVelocity) {
      p.vx = p.vx / velocity * maxVelocity;
      p.vy = p.vy / velocity * maxVelocity;
    }

    p.x = clamp(p.x + p.vx * dt, 24, W - 24);
    p.y = clamp(p.y + p.vy * dt, 24, H - 24);

    p.vx *= Math.pow(0.78, dt);
    p.vy *= Math.pow(0.78, dt);
  }

  const active = [...players.values()].filter(p => p.team !== null);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);

      if (d > 0 && d < 25) {
        const push = (25 - d) * 0.22;
        a.x -= dx / d * push;
        a.y -= dy / d * push;
        b.x += dx / d * push;
        b.y += dy / d * push;
      }
    }
  }

  if (ball.owner) {
    const p = players.get(ball.owner);

    if (!p) {
      ball.owner = null;
    } else {
      ball.x = p.x + p.facingX * 20;
      ball.y = p.y + p.facingY * 20;
      ball.vx = 0;
      ball.vy = 0;
    }
  } else {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= Math.pow(0.985, dt);
    ball.vy *= Math.pow(0.985, dt);

    if (ball.y < 18 || ball.y > H - 18) {
      ball.y = clamp(ball.y, 18, H - 18);
      ball.vy *= -0.78;
    }

    const inGoalMouth = ball.y > 263 && ball.y < 337;

    if (ball.x <= 18) {
      if (inGoalMouth && now - lastGoal > 1200) {
        scoreGoal(1);
      } else {
        ball.x = 18;
        ball.vx = Math.abs(ball.vx) * 0.78;
      }
    } else if (ball.x >= W - 18) {
      if (inGoalMouth && now - lastGoal > 1200) {
        scoreGoal(0);
      } else {
        ball.x = W - 18;
        ball.vx = -Math.abs(ball.vx) * 0.78;
      }
    }

    if (!goalEvent && !ball.owner) {
      for (const p of active) {
        if (dist(p, ball) < 23) {
          ball.owner = p.id;
          ball.lastTouch = p.id;
          ball.vx = 0;
          ball.vy = 0;
          break;
        }
      }
    }
  }

  broadcast();
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`Mini Haxball Pixel çalışıyor: ${PORT}`);
});
