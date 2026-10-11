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
const DB = path.join(__dirname, 'users.json');

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let users = {};
try {
  users = JSON.parse(fs.readFileSync(DB, 'utf8'));
} catch {}

function saveUsers() {
  fs.writeFileSync(DB, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function publicUser(username) {
  const u = users[username];
  return u && {
    username,
    displayName: u.displayName,
    number: u.number
  };
}

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  const number = Number(req.body.number);

  if (!/^[a-z0-9_]{3,18}$/.test(username))
    return res.status(400).json({ error: 'Kullanıcı adı 3-18 karakter olmalı.' });

  if (displayName.length < 2 || displayName.length > 18)
    return res.status(400).json({ error: 'Görünen isim 2-18 karakter olmalı.' });

  if (password.length < 6 || password.length > 100)
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });

  if (!Number.isInteger(number) || number < 1 || number > 99)
    return res.status(400).json({ error: 'Forma numarası 1-99 olmalı.' });

  if (users[username])
    return res.status(409).json({ error: 'Kullanıcı adı alınmış.' });

  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = {
    displayName,
    number,
    salt,
    passwordHash: hashPassword(password, salt)
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
  const u = users[username];

  if (!u || hashPassword(password, u.salt) !== u.passwordHash)
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre yanlış.' });

  res.json({ user: publicUser(username) });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, players: players.size, game: 'Mini Haxball Pixel' });
});

const W = 1000;
const H = 600;
const MAX_PLAYERS = 12;
const MATCH_MS = 300000;

const ROLE_CAP = { GK: 1, DEF: 2, MID: 1, FWD: 2 };
const ROLE_NAME = {
  GK: 'Kaleci',
  DEF: 'Defans',
  MID: 'Orta saha',
  FWD: 'Forvet'
};

const players = new Map();

let ball = { x: 500, y: 300, vx: 0, vy: 0, owner: null };
let score = [0, 0];
let matchStarted = Date.now();
let lastGoal = 0;
let matchId = 1;
let lastTick = Date.now();

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(data));
}

function snapshot() {
  return {
    type: 'state',
    world: {
      w: W,
      h: H,
      score,
      remaining: Math.max(0, MATCH_MS - (Date.now() - matchStarted)),
      matchId
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

function broadcast() {
  const data = JSON.stringify(snapshot());
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(data);
  }
}

function resetBall() {
  ball = { x: 500, y: 300, vx: 0, vy: 0, owner: null };
}

function resetPositions() {
  for (const p of players.values()) {
    const positions = {
      GK: [p.team === 0 ? 65 : 935, 300],
      DEF: [p.team === 0 ? 245 : 755, p.slot === 0 ? 215 : 385],
      MID: [p.team === 0 ? 420 : 580, 300],
      FWD: [p.team === 0 ? 460 : 540, p.slot === 0 ? 220 : 380]
    };

    const pos = positions[p.role] || [500, 300];
    p.x = pos[0];
    p.y = pos[1];
    p.vx = 0;
    p.vy = 0;
  }

  resetBall();
}

function roleCounts(team, role) {
  return [...players.values()].filter(
    p => p.team === team && p.role === role
  ).length;
}

function assignPlayer(p, team, role) {
  if (![0, 1].includes(team) || !ROLE_CAP[role]) return false;

  // Kendi seçimini tekrar yapmasına izin ver.
  const previousTeam = p.team;
  const previousRole = p.role;

  p.team = null;
  p.role = null;

  if (roleCounts(team, role) >= ROLE_CAP[role]) {
    p.team = previousTeam;
    p.role = previousRole;
    return false;
  }

  p.team = team;
  p.role = role;
  p.slot = roleCounts(team, role) - 1;
  resetPositions();
  return true;
}

function removePlayer(p) {
  if (!p) return;
  if (ball.owner === p.id) ball.owner = null;
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
  const p = {
    id: crypto.randomUUID(),
    ws,
    username,
    name: u.displayName,
    number: u.number,
    team: null,
    role: null,
    slot: 0,
    x: 500,
    y: 300,
    vx: 0,
    vy: 0,
    facingX: 1,
    facingY: 0,
    stamina: 100,
    input: { up: false, down: false, left: false, right: false },
    tackleUntil: 0,
    lastKick: 0
  };

  players.set(p.id, p);
  send(ws, { type: 'joined', id: p.id, user: publicUser(username) });
  broadcast();
  return p;
}

function attemptKick(p, action) {
  const now = Date.now();
  if (ball.owner !== p.id || now - p.lastKick < 250) return;

  let dx = Number(p.input.right) - Number(p.input.left);
  let dy = Number(p.input.down) - Number(p.input.up);

  // Dururken son baktığı yöne pas/şut at.
  if (!dx && !dy) {
    dx = p.facingX;
    dy = p.facingY;
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const power = action === 'pass' ? 7.2 : 11.8;

  ball.owner = null;
  ball.x = p.x + dx * 22;
  ball.y = p.y + dy * 22;
  ball.vx = dx * power;
  ball.vy = dy * power;
  p.lastKick = now;
}

function attemptTackle(p) {
  const now = Date.now();
  if (now < p.tackleUntil) return;
  p.tackleUntil = now + 450;

  if (ball.owner) {
    const target = players.get(ball.owner);
    if (target && target.team !== p.team && dist(p, target) < 42)
      ball.owner = p.id;
  } else if (dist(p, ball) < 37) {
    ball.owner = p.id;
    ball.vx = 0;
    ball.vy = 0;
  }
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
      if (!assignPlayer(player, Number(msg.team), String(msg.role || ''))) {
        send(ws, { type: 'error', message: 'Mevki dolu veya seçim geçersiz.' });
        return;
      }

      send(ws, {
        type: 'selected',
        team: player.team,
        role: player.role,
        roleName: ROLE_NAME[player.role]
      });

      broadcast();
      return;
    }

    if (msg.type !== 'input') return;

    for (const k of ['up', 'down', 'left', 'right'])
      player.input[k] = !!msg[k];

    let dx = Number(player.input.right) - Number(player.input.left);
    let dy = Number(player.input.down) - Number(player.input.up);

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }

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

  if (now - matchStarted >= MATCH_MS) {
    if (now - matchStarted >= MATCH_MS + 3500) {
      score = [0, 0];
      matchStarted = now;
      matchId++;
      resetPositions();
      broadcast();
    }
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
      p.stamina = Math.max(0, p.stamina - (10 * dt / 60));
    } else {
      p.stamina = Math.min(100, p.stamina + (18 * dt / 60));
    }

    const baseSpeed = (p.role === 'GK' ? 2.7 : 3.15) * 1.10;
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

  const list = [...players.values()].filter(p => p.team !== null);

  // Oyuncuların birbirinin içine girmesini azalt.
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
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

    // Üst ve alt saha çizgileri.
    if (ball.y < 18 || ball.y > H - 18) {
      ball.y = clamp(ball.y, 18, H - 18);
      ball.vy *= -0.78;
    }

    // Kale açıklığı: direklerin iç tarafı ve üst çıtanın altı.
    const inGoalMouth = ball.y > 263 && ball.y < 337;

    if (ball.x <= 18) {
      if (inGoalMouth && now - lastGoal > 1200) {
        score[1]++;
        lastGoal = now;
        resetPositions();
      } else {
        ball.x = 18;
        ball.vx = Math.abs(ball.vx) * 0.78;
      }
    } else if (ball.x >= W - 18) {
      if (inGoalMouth && now - lastGoal > 1200) {
        score[0]++;
        lastGoal = now;
        resetPositions();
      } else {
        ball.x = W - 18;
        ball.vx = -Math.abs(ball.vx) * 0.78;
      }
    }

    // Topa yakın oyuncu topu kontrol edebilir.
    if (!ball.owner) {
      for (const p of list) {
        if (dist(p, ball) < 23) {
          ball.owner = p.id;
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
