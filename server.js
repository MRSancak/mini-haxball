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

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let users = {};
try {
  users = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch {}

function saveUsers() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('Kullanıcılar kaydedilemedi:', e.message);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeUser(username) {
  const u = users[username];
  return u ? {
    username,
    displayName: u.displayName,
    number: u.number
  } : null;
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
    return res.status(400).json({ error: 'Forma numarası 1-99 arasında olmalı.' });

  if (users[username])
    return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });

  const salt = crypto.randomBytes(16).toString('hex');

  users[username] = {
    displayName,
    number,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: Date.now()
  };

  saveUsers();
  res.json({ user: safeUser(username) });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const u = users[username];

  if (!u || hashPassword(password, u.salt) !== u.passwordHash)
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre yanlış.' });

  res.json({ user: safeUser(username) });
});

const W = 1000;
const H = 600;
const MATCH_MS = 300000;
const MAX_PLAYERS = 12;

const ROLE_CAP = { GK: 1, DEF: 2, MID: 1, FWD: 2 };
const ROLE_NAME = {
  GK: 'Kaleci',
  DEF: 'Defans',
  MID: 'Orta saha',
  FWD: 'Forvet'
};

const players = new Map();

let ball = {
  x: W / 2, y: H / 2,
  vx: 0, vy: 0, owner: null
};

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

function broadcast() {
  const data = JSON.stringify(snapshot());

  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN)
      p.ws.send(data);
  }
}

function snapshot() {
  const now = Date.now();

  return {
    type: 'state',
    world: {
      w: W,
      h: H,
      score,
      remaining: Math.max(0, MATCH_MS - (now - matchStarted)),
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
      hasBall: ball.owner === p.id,
      dashReady: now >= p.dashUntil,
      tackleReady: now >= p.tackleUntil
    }))
  };
}

function resetBall() {
  ball = {
    x: W / 2, y: H / 2,
    vx: 0, vy: 0, owner: null
  };
}

function roleCounts(team, role) {
  let count = 0;

  for (const p of players.values()) {
    if (p.team === team && p.role === role)
      count++;
  }

  return count;
}

function assignPlayer(p, team, role) {
  if (![0, 1].includes(team)) return false;
  if (!ROLE_CAP[role]) return false;
  if (roleCounts(team, role) >= ROLE_CAP[role]) return false;

  p.team = team;
  p.role = role;
  p.slot = roleCounts(team, role) - 1;

  resetPositions();
  return true;
}

function resetPositions() {
  for (const p of players.values()) {
    const x = p.team === 0 ? 250 : 750;

    const positions = {
      GK: [p.team === 0 ? 55 : 945, 300],
      DEF: [p.team === 0 ? 250 : 750, p.slot === 0 ? 210 : 390],
      MID: [p.team === 0 ? 420 : 580, 300],
      FWD: [p.team === 0 ? 470 : 530, p.slot === 0 ? 220 : 380]
    };

    const pos = positions[p.role] || [x, 300];

    p.x = pos[0];
    p.y = pos[1];
    p.vx = 0;
    p.vy = 0;
  }

  resetBall();
}

function removePlayer(p) {
  if (!p) return;

  if (ball.owner === p.id)
    ball.owner = null;

  players.delete(p.id);
  broadcast();
}

function joinGame(ws, username) {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { type: 'error', message: 'Sunucu dolu (12/12).' });
    return null;
  }

  const u = users[username];
  const id = crypto.randomUUID();

  const p = {
    id,
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
    input: {
      up: false, down: false,
      left: false, right: false
    },
    dashUntil: 0,
    tackleUntil: 0,
    lastKick: 0
  };

  players.set(id, p);

  send(ws, {
    type: 'joined',
    id,
    user: safeUser(username),
    maxPlayers: MAX_PLAYERS
  });

  broadcast();
  return p;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    players: players.size,
    game: 'Mini Haxball Pixel'
  });
});

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

      // Bu temel sürümde oturum belirteci istemci tarafında oluşturulur.
      // Herkese açık yayında gerçek sunucu oturumlarıyla değiştirilmelidir.
      if (!users[username] || msg.token !== 'pixel:' + username) {
        send(ws, {
          type: 'error',
          message: 'Oturum doğrulanamadı. Yeniden giriş yap.'
        });
        return;
      }

      if (player) removePlayer(player);
      player = joinGame(ws, username);
      return;
    }

    if (!player) return;

    if (msg.type === 'select') {
      const team = Number(msg.team);
      const role = String(msg.role || '');

      if (!assignPlayer(player, team, role)) {
        send(ws, {
          type: 'error',
          message: 'Bu takımda bu mevki dolu veya seçim geçersiz.'
        });
        return;
      }

      send(ws, {
        type: 'selected',
        team,
        role,
        roleName: ROLE_NAME[role]
      });

      broadcast();
      return;
    }

    if (msg.type !== 'input') return;

    for (const k of ['up', 'down', 'left', 'right'])
      player.input[k] = !!msg[k];

    const now = Date.now();

    if (msg.dash && now >= player.dashUntil) {
      let dx = Number(player.input.right) - Number(player.input.left);
      let dy = Number(player.input.down) - Number(player.input.up);
      const len = Math.hypot(dx, dy) || 1;

      if (!dx && !dy)
        dx = player.team === 0 ? 1 : -1;

      const actualLen = Math.hypot(dx, dy) || 1;

      player.vx += dx / actualLen * 7.4;
      player.vy += dy / actualLen * 7.4;
      player.dashUntil = now + 2000;
    }

    if (msg.action === 'kick' || msg.action === 'pass') {
      if (ball.owner !== player.id || now - player.lastKick < 280)
        return;

      let dx = Number(player.input.right) - Number(player.input.left);
      let dy = Number(player.input.down) - Number(player.input.up);

      if (!dx && !dy) {
        dx = player.team === 0 ? 1 : -1;
        dy = 0;
      }

      const len = Math.hypot(dx, dy) || 1;
      const power = msg.action === 'pass' ? 7.2 : 11.8;

      ball.owner = null;
      ball.x = player.x + dx / len * 22;
      ball.y = player.y + dy / len * 22;
      ball.vx = dx / len * power;
      ball.vy = dy / len * power;

      player.lastKick = now;
    }

    if (msg.action === 'tackle' &&
        ball.owner !== player.id &&
        now >= player.tackleUntil) {

      player.tackleUntil = now + 450;

      if (ball.owner) {
        const target = players.get(ball.owner);

        if (target &&
            target.team !== player.team &&
            dist(player, target) < 42) {
          ball.owner = player.id;
        }
      } else if (dist(player, ball) < 37) {
        ball.owner = player.id;
        ball.vx = 0;
        ball.vy = 0;
      }
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
    }

    const speed = p.role === 'GK' ? 2.7 : 3.15;

    p.vx += dx * speed * 0.22 * dt;
    p.vy += dy * speed * 0.22 * dt;

    const velocity = Math.hypot(p.vx, p.vy);

    if (velocity > 5.6) {
      p.vx = p.vx / velocity * 5.6;
      p.vy = p.vy / velocity * 5.6;
    }

    p.x = clamp(p.x + p.vx * dt, 24, W - 24);
    p.y = clamp(p.y + p.vy * dt, 24, H - 24);

    p.vx *= Math.pow(0.78, dt);
    p.vy *= Math.pow(0.78, dt);
  }

  const list = [...players.values()].filter(p => p.team !== null);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
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
      let dx = Number(p.input.right) - Number(p.input.left);
      let dy = Number(p.input.down) - Number(p.input.up);
      const len = Math.hypot(dx, dy) || 1;

      ball.x = p.x + dx / len * 20;
      ball.y = p.y + dy / len * 20;
      ball.vx = p.vx;
      ball.vy = p.vy;
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

    if (ball.x < 16 || ball.x > W - 16) {
      if (ball.y > 235 && ball.y < 365 && now - lastGoal > 1200) {
        score[ball.x < 16 ? 1 : 0]++;
        lastGoal = now;
        resetPositions();
      } else {
        ball.x = clamp(ball.x, 16, W - 16);
        ball.vx *= -0.78;
      }
    }

    for (const p of list) {
      if (dist(p, ball) < 23) {
        ball.owner = p.id;
        ball.vx = 0;
        ball.vy = 0;
        break;
      }
    }
  }

  broadcast();
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`Mini Haxball Pixel running on port ${PORT}`);
});
