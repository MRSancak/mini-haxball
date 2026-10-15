
'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: false });

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 12;
const MATCH_SECONDS = 300;
const TICK_MS = 1000 / 60;

const DATA_DIR = process.env.USER_DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'user.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// ---------- KALICI HESAPLAR ----------

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Hesap dosyası okunamadı:', error.message);
    }
    return {};
  }
}

let users = loadUsers();
let saveQueue = Promise.resolve();

function saveUsers() {
  const snapshot = JSON.stringify(users, null, 2) + '\n';

  saveQueue = saveQueue.then(async () => {
    const temp = USERS_FILE + '.tmp';
    await fs.promises.writeFile(temp, snapshot, { mode: 0o600 });
    await fs.promises.rename(temp, USERS_FILE);
  });

  return saveQueue;
}

const sessions = new Map();

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validUsername(value) {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9_]{3,16}$/.test(value.trim());
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function verifyPassword(password, record) {
  try {
    if (typeof password !== 'string' || !record?.salt || !record?.hash) {
      return false;
    }

    const actual = crypto.scryptSync(password, record.salt, 64);
    const expected = Buffer.from(record.hash, 'hex');

    return actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicUser(username, user) {
  return {
    username: user.username || username,
    profile: {
      displayName: user.profile?.displayName || username,
      jerseyNumber: user.profile?.jerseyNumber || 10,
      jerseyColor: user.profile?.jerseyColor || '#3298ff'
    },
    stats: {
      matches: user.stats?.matches || 0,
      goals: user.stats?.goals || 0,
      assists: user.stats?.assists || 0
    }
  };
}

function issueSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, username);
  return token;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const username = sessions.get(token);

  if (!username || !users[username]) {
    return res.status(401).json({ error: 'Oturum süresi doldu. Tekrar giriş yap.' });
  }

  req.username = username;
  req.user = users[username];
  req.token = token;
  next();
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!validUsername(username)) {
      return res.status(400).json({
        error: 'Kullanıcı adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.'
      });
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Şifre 8-128 karakter olmalı.' });
    }

    const key = normalizeUsername(username);

    if (users[key]) {
      return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    }

    const hashed = hashPassword(password);

    users[key] = {
      username: username.trim(),
      salt: hashed.salt,
      hash: hashed.hash,
      profile: {
        displayName: username.trim(),
        jerseyNumber: 10,
        jerseyColor: '#3298ff'
      },
      stats: { matches: 0, goals: 0, assists: 0 }
    };

    await saveUsers();

    res.status(201).json({
      token: issueSession(key),
      ...publicUser(key, users[key])
    });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Hesap kaydedilemedi.' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = normalizeUsername(username);
  const user = users[key];

  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  res.json({ token: issueSession(key), ...publicUser(key, user) });
});

app.get('/api/profile', auth, (req, res) => {
  res.json(publicUser(req.username, req.user));
});

app.put('/api/profile', auth, async (req, res) => {
  try {
    const { displayName, jerseyNumber, jerseyColor } = req.body || {};
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    const number = Number(jerseyNumber);

    if (name.length < 2 || name.length > 20) {
      return res.status(400).json({ error: 'Görünen isim 2-20 karakter olmalı.' });
    }

    if (!Number.isInteger(number) || number < 1 || number > 99) {
      return res.status(400).json({ error: 'Forma numarası 1-99 arasında olmalı.' });
    }

    const color = /^#[0-9a-fA-F]{6}$/.test(jerseyColor || '')
      ? jerseyColor : '#3298ff';

    req.user.profile = {
      displayName: name,
      jerseyNumber: number,
      jerseyColor: color
    };

    const player = players.get(req.username);
    if (player) {
      player.name = name;
      player.jerseyNumber = number;
      player.jerseyColor = color;
    }

    await saveUsers();
    broadcastState();

    res.json(publicUser(req.username, req.user));
  } catch (error) {
    console.error('Profil hatası:', error);
    res.status(500).json({ error: 'Profil kaydedilemedi.' });
  }
});

app.put('/api/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!verifyPassword(currentPassword, req.user)) {
    return res.status(401).json({ error: 'Mevcut şifre yanlış.' });
  }

  if (typeof newPassword !== 'string' ||
      newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'Yeni şifre 8-128 karakter olmalı.' });
  }

  const hashed = hashPassword(newPassword);
  req.user.salt = hashed.salt;
  req.user.hash = hashed.hash;

  try {
    await saveUsers();
    res.json({ ok: true, message: 'Şifre değiştirildi.' });
  } catch (error) {
    console.error('Şifre kaydetme hatası:', error);
    res.status(500).json({ error: 'Şifre kaydedilemedi.' });
  }
});

// ---------- OYUN DÜNYASI ----------

const FIELD = { x: 40, y: 40, width: 1320, height: 720 };
const PLAYER_RADIUS = 18;
const BALL_RADIUS = 10;
const GOAL_WIDTH = 60;
const GOAL_HEIGHT = 250;
const PLAYER_SPEED = 4.5;
const BALL_FRICTION = 0.991;

const players = new Map();

const ball = {
  x: 700, y: 400,
  vx: 0, vy: 0,
  owner: null,
  pickupLock: 0
};

let blueScore = 0;
let redScore = 0;
let matchTime = MATCH_SECONDS;
let lastTouch = null;
let goalPause = 0;
let matchOver = false;
let lastClockSecond = MATCH_SECONDS;

const roleCaps = { DEF: 2, MID: 3, FWD: 1 };

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function teamCount(team) {
  return [...players.values()].filter(p => p.team === team).length;
}

function roleCount(team, role) {
  return [...players.values()].filter(p => p.team === team && p.role === role).length;
}

function playerById(id) {
  return players.get(id);
}

function setOwner(player) {
  for (const p of players.values()) p.hasBall = false;

  ball.owner = player ? player.id : null;

  if (player) {
    player.hasBall = true;
    lastTouch = player;
    ball.x = player.x + player.facingX * (PLAYER_RADIUS + BALL_RADIUS + 2);
    ball.y = player.y + player.facingY * (PLAYER_RADIUS + BALL_RADIUS + 2);
    ball.vx = 0;
    ball.vy = 0;
  }
}

function resetBall() {
  ball.x = FIELD.x + FIELD.width / 2;
  ball.y = FIELD.y + FIELD.height / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.owner = null;
  ball.pickupLock = 25;

  for (const p of players.values()) p.hasBall = false;
}

function resetPlayers() {
  const blue = [...players.values()].filter(p => p.team === 'blue');
  const red = [...players.values()].filter(p => p.team === 'red');

  blue.forEach((p, i) => {
    p.x = FIELD.x + 230 + (i % 3) * 65;
    p.y = FIELD.y + 190 + Math.floor(i / 3) * 240;
    p.vx = p.vy = 0;
    p.hasBall = false;
  });

  red.forEach((p, i) => {
    p.x = FIELD.x + FIELD.width - 230 - (i % 3) * 65;
    p.y = FIELD.y + 190 + Math.floor(i / 3) * 240;
    p.vx = p.vy = 0;
    p.hasBall = false;
  });

  resetBall();
}

function resetMatch() {
  blueScore = 0;
  redScore = 0;
  matchTime = MATCH_SECONDS;
  matchOver = false;
  goalPause = 0;
  lastClockSecond = MATCH_SECONDS;
  resetPlayers();
  broadcast({ type: 'matchStart' });
}

function endGoal(scoringTeam) {
  if (goalPause > 0 || matchOver) return;

  if (scoringTeam === 'blue') blueScore++;
  else redScore++;

  const scorer = lastTouch && players.has(lastTouch.id) ? lastTouch : null;
  const scorerName = scorer ? scorer.name : 'Bilinmiyor';

  if (scorer) {
    const key = normalizeUsername(scorer.username);
    if (users[key]) {
      users[key].stats.goals = (users[key].stats.goals || 0) + 1;
      saveUsers().catch(err => console.error('Gol kaydı:', err));
    }
  }

  broadcast({
    type: 'goal',
    scorer: scorerName,
    team: scoringTeam,
    score: { blue: blueScore, red: redScore }
  });

  goalPause = 300;
  resetBall();
}

function publicPlayer(p) {
  return {
    id: p.id,
    username: p.username,
    name: p.name,
    jerseyNumber: p.jerseyNumber,
    jerseyColor: p.jerseyColor,
    team: p.team,
    role: p.role,
    x: p.x,
    y: p.y,
    slowTimer: p.slowTimer,
    hasBall: p.hasBall,
    facingX: p.facingX,
    facingY: p.facingY
  };
}

function broadcastState() {
  const state = {
    type: 'state',
    players: [...players.values()].map(publicPlayer),
    ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
    score: { blue: blueScore, red: redScore },
    matchTime,
    matchOver,
    goalPause,
    playerCount: players.size
  };

  broadcast(state);
}

function shoot(player) {
  if (ball.owner !== player.id || goalPause > 0 || matchOver) return;

  let dx = player.facingX;
  let dy = player.facingY;

  // Oyuncu hiç hareket etmediyse rakip kaleye doğru şut çek.
  if (!dx && !dy) dx = player.team === 'blue' ? 1 : -1;

  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;

  ball.x = player.x + dx * (PLAYER_RADIUS + BALL_RADIUS + 5);
  ball.y = player.y + dy * (PLAYER_RADIUS + BALL_RADIUS + 5);
  ball.vx = dx * 15.5;
  ball.vy = dy * 15.5;
  ball.owner = null;
  ball.pickupLock = 24;
  player.hasBall = false;
  player.kickCooldown = 12;
  lastTouch = player;
}

function stealBall(player) {
  if (player.slowTimer > 0 || goalPause > 0 || matchOver) return;

  const owner = playerById(ball.owner);
  if (!owner || owner.team === player.team) return;

  const distance = Math.hypot(owner.x - player.x, owner.y - player.y);

  if (distance <= PLAYER_RADIUS * 2 + 9) {
    owner.hasBall = false;
    setOwner(player);
    player.stealCooldown = 20;
  }
}

function movePlayer(p) {
  if (p.slowTimer > 0) p.slowTimer--;
  if (p.kickCooldown > 0) p.kickCooldown--;
  if (p.stealCooldown > 0) p.stealCooldown--;

  let dx = (p.keys.right ? 1 : 0) - (p.keys.left ? 1 : 0);
  let dy = (p.keys.down ? 1 : 0) - (p.keys.up ? 1 : 0);

  if (dx || dy) {
    const length = Math.hypot(dx, dy);
    dx /= length;
    dy /= length;

    p.facingX = dx;
    p.facingY = dy;

    const speed = p.slowTimer > 0 ? PLAYER_SPEED * 0.75 : PLAYER_SPEED;
    p.vx = dx * speed;
    p.vy = dy * speed;
  } else {
    p.vx *= 0.72;
    p.vy *= 0.72;
  }

  p.x = Math.max(
    FIELD.x + PLAYER_RADIUS,
    Math.min(FIELD.x + FIELD.width - PLAYER_RADIUS, p.x + p.vx)
  );

  p.y = Math.max(
    FIELD.y + PLAYER_RADIUS,
    Math.min(FIELD.y + FIELD.height - PLAYER_RADIUS, p.y + p.vy)
  );
}

function updateBall() {
  if (ball.pickupLock > 0) ball.pickupLock--;

  const owner = playerById(ball.owner);

  if (owner) {
    ball.x = owner.x + owner.facingX * (PLAYER_RADIUS + BALL_RADIUS + 2);
    ball.y = owner.y + owner.facingY * (PLAYER_RADIUS + BALL_RADIUS + 2);
    ball.vx = owner.vx;
    ball.vy = owner.vy;
    return;
  }

  ball.x += ball.vx;
  ball.y += ball.vy;
  ball.vx *= BALL_FRICTION;
  ball.vy *= BALL_FRICTION;

  if (Math.abs(ball.vx) < 0.04) ball.vx = 0;
  if (Math.abs(ball.vy) < 0.04) ball.vy = 0;

  const top = FIELD.y + FIELD.height / 2 - GOAL_HEIGHT / 2;
  const bottom = FIELD.y + FIELD.height / 2 + GOAL_HEIGHT / 2;

  if (ball.y - BALL_RADIUS < FIELD.y) {
    ball.y = FIELD.y + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * 0.82;
  }

  if (ball.y + BALL_RADIUS > FIELD.y + FIELD.height) {
    ball.y = FIELD.y + FIELD.height - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * 0.82;
  }

  if (ball.x - BALL_RADIUS <= FIELD.x) {
    if (ball.y >= top && ball.y <= bottom) {
      endGoal('red');
      return;
    }
    ball.x = FIELD.x + BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * 0.82;
  }

  if (ball.x + BALL_RADIUS >= FIELD.x + FIELD.width) {
    if (ball.y >= top && ball.y <= bottom) {
      endGoal('blue');
      return;
    }
    ball.x = FIELD.x + FIELD.width - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * 0.82;
  }

  if (ball.pickupLock > 0 || Math.hypot(ball.vx, ball.vy) > 12) return;

  for (const p of players.values()) {
    if (p.kickCooldown > 0) continue;

    const distance = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (distance <= PLAYER_RADIUS + BALL_RADIUS + 2) {
      setOwner(p);
      break;
    }
  }
}

// ---------- WEBSOCKET ----------

wss.on('connection', ws => {
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    if (raw.length > 4096) return;

    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!ws.playerId) {
      if (data.type !== 'join' || typeof data.token !== 'string') return;

      const username = sessions.get(data.token);

      if (!username || !users[username]) {
        send(ws, { type: 'auth_error', message: 'Oturum geçersiz. Tekrar giriş yap.' });
        ws.close();
        return;
      }

      if (players.size >= MAX_PLAYERS) {
        send(ws, { type: 'full', message: 'Sunucu dolu (12/12).' });
        ws.close();
        return;
      }

      const user = users[username];
      const id = crypto.randomBytes(8).toString('hex');

      const player = {
        id,
        username,
        name: user.profile.displayName,
        jerseyNumber: user.profile.jerseyNumber,
        jerseyColor: user.profile.jerseyColor,
        team: teamCount('blue') <= teamCount('red') ? 'blue' : 'red',
        role: 'MID',
        x: 0, y: 0, vx: 0, vy: 0,
        facingX: username ? 1 : 0,
        facingY: 0,
        keys: { up: false, down: false, left: false, right: false },
        hasBall: false,
        slowTimer: 0,
        kickCooldown: 0,
        stealCooldown: 0,
        ws
      };

      players.set(id, player);
      ws.playerId = id;

      user.stats.matches = (user.stats.matches || 0) + 1;
      saveUsers().catch(err => console.error('Maç kaydı:', err));

      send(ws, { type: 'welcome', id });
      resetPlayers();
      broadcastState();
      return;
    }

    const player = players.get(ws.playerId);
    if (!player) return;

    if (data.type === 'select') {
      if (!['blue', 'red'].includes(data.team)) return;
      if (!Object.hasOwn(roleCaps, data.role)) return;

      const currentTeam = player.team;
      const currentRole = player.role;

      const teamFull = data.team !== currentTeam && teamCount(data.team) >= 6;
      const roleFull = roleCount(data.team, data.role) >= roleCaps[data.role] &&
        !(currentTeam === data.team && currentRole === data.role);

      if (teamFull || roleFull) {
        send(ws, { type: 'notice', message: 'Takım veya mevki dolu.' });
        return;
      }

      player.team = data.team;
      player.role = data.role;
      resetPlayers();
      broadcastState();
    }

    if (data.type === 'input') {
      player.keys.up = !!data.up;
      player.keys.down = !!data.down;
      player.keys.left = !!data.left;
      player.keys.right = !!data.right;

      // İstemciden basılı tuş yerine tek seferlik şut eylemi gelir.
      if (data.action === 'shoot' || data.space === true) {
        if (ball.owner === player.id) shoot(player);
        else stealBall(player);
      }
    }

    if (data.type === 'leave') ws.close();
  });

  ws.on('close', () => {
    if (ws.playerId) {
      const player = players.get(ws.playerId);

      if (player && ball.owner === player.id) resetBall();

      players.delete(ws.playerId);
      resetPlayers();
      broadcastState();
    }
  });

  ws.on('error', err => console.error('WebSocket:', err.message));
});

// ---------- MAÇ DÖNGÜSÜ ----------

setInterval(() => {
  if (goalPause > 0) {
    goalPause--;

    if (goalPause === 0) {
      if (matchTime <= 0) {
        matchOver = true;
        broadcast({ type: 'matchEnd', score: { blue: blueScore, red: redScore } });
      } else {
        resetPlayers();
      }
    }

    return;
  }

  if (matchOver || players.size === 0) return;

  for (const player of players.values()) movePlayer(player);
  updateBall();

  if (matchOver || goalPause > 0) return;

  const second = Math.ceil(matchTime);
  if (second > 0 && second < lastClockSecond) {
    matchTime = second;
    lastClockSecond = second;
  }

  matchTime = Math.max(0, matchTime - TICK_MS / 1000);

  if (matchTime <= 0) {
    matchTime = 0;
    matchOver = true;
    broadcast({ type: 'matchEnd', score: { blue: blueScore, red: redScore } });
  }
}, TICK_MS);

setInterval(() => {
  if (players.size) broadcastState();
}, 1000 / 30);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

// ---------- WEB ----------

app.get('/health', (_req, res) => {
  res.json({ ok: true, players: players.size, maxPlayers: MAX_PLAYERS });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API adresi bulunamadı.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mini HaxBall çalışıyor: port ${PORT}`);
  console.log(`Hesap dosyası: ${USERS_FILE}`);
});
