
'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Render Persistent Disk kullanıyorsan:
// Mount Path: /var/data
// Environment Variable: USER_DATA_DIR=/var/data
const DATA_DIR = process.env.USER_DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'user.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(USERS_FILE, 'utf8')
    );

    return parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('user.json okunamadı:', err.message);
    }

    fs.writeFileSync(
      USERS_FILE,
      '{}\n',
      { mode: 0o600 }
    );

    return {};
  }
}

let users = loadUsers();
let saveQueue = Promise.resolve();

function saveUsers() {
  const snapshot = JSON.stringify(users, null, 2) + '\n';

  saveQueue = saveQueue.then(async () => {
    const temp = USERS_FILE + '.tmp';

    await fs.promises.writeFile(
      temp,
      snapshot,
      { mode: 0o600 }
    );

    await fs.promises.rename(temp, USERS_FILE);
  }).catch(err => {
    console.error('Hesaplar kaydedilemedi:', err);
  });

  return saveQueue;
}

const sessions = new Map();
const players = new Map();

const MAX_PLAYERS = 12;
const MATCH_TIME = 300;

const FIELD = {
  x: 40,
  y: 40,
  width: 1120,
  height: 620
};

const GOAL = {
  width: 35,
  height: 210
};

const PLAYER_RADIUS = 17;
const PLAYER_SPEED = 4.7;
const BALL_RADIUS = 14;
const BALL_MAX_SPEED = 15;

let blueScore = 0;
let redScore = 0;
let matchTime = MATCH_TIME;

const ball = {
  x: 600,
  y: 350,
  vx: 3,
  vy: 0
};

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validUsername(value) {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9_]{3,16}$/.test(value.trim());
}

function passwordHash(
  password,
  salt = crypto.randomBytes(16).toString('hex')
) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function verifyPassword(password, record) {
  try {
    const hash = crypto.scryptSync(
      password,
      record.salt,
      64
    );

    const expected = Buffer.from(record.hash, 'hex');

    return expected.length === hash.length &&
      crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

function publicUser(username, user) {
  if (!user || typeof user !== 'object') {
    throw new Error('Kullanıcı verisi bulunamadı.');
  }

  const profile = user.profile &&
    typeof user.profile === 'object'
    ? user.profile
    : {};

  const number = Number(profile.jerseyNumber);

  return {
    username: user.username || username,
    profile: {
      displayName:
        profile.displayName ||
        user.username ||
        username,

      jerseyNumber:
        Number.isInteger(number) && number >= 1 && number <= 99
          ? number
          : 10,

      jerseyColor:
        /^#[0-9a-fA-F]{6}$/.test(profile.jerseyColor || '')
          ? profile.jerseyColor
          : '#299cff'
    }
  };
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';

  return header.startsWith('Bearer ')
    ? header.slice(7)
    : '';
}

function auth(req, res, next) {
  const token = tokenFromRequest(req);
  const username = sessions.get(token);

  if (!username || !users[username]) {
    return res.status(401).json({
      error: 'Oturum süresi doldu. Lütfen tekrar giriş yap.'
    });
  }

  req.username = username;
  req.token = token;
  req.user = users[username];

  next();
}

function issueSession(username) {
  const token = crypto.randomBytes(32).toString('hex');

  sessions.set(token, username);

  return token;
}

// Sunucu kontrolü
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// HESAP OLUŞTURMA
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};

  if (!validUsername(username)) {
    return res.status(400).json({
      error:
        'Kullanıcı adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.'
    });
  }

  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: 'Şifre 8-128 karakter arasında olmalı.'
    });
  }

  const key = normalizeUsername(username);

  if (users[key]) {
    return res.status(409).json({
      error: 'Bu kullanıcı adı zaten kullanılıyor.'
    });
  }

  const hashed = passwordHash(password);

  users[key] = {
    username: username.trim(),
    salt: hashed.salt,
    hash: hashed.hash,

    profile: {
      displayName: username.trim(),
      jerseyNumber: 10,
      jerseyColor: '#299cff'
    },

    createdAt: new Date().toISOString()
  };

  await saveUsers();

  return res.status(201).json({
    token: issueSession(key),
    ...publicUser(key, users[key])
  });
});

// GİRİŞ
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  const key = normalizeUsername(username);
  const user = users[key];

  if (
    !user ||
    typeof password !== 'string' ||
    !verifyPassword(password, user)
  ) {
    return res.status(401).json({
      error: 'Kullanıcı adı veya şifre yanlış.'
    });
  }

  return res.json({
    token: issueSession(key),
    ...publicUser(key, user)
  });
});

// PROFİL BİLGİLERİNİ GETİR
app.get('/api/profile', auth, (req, res) => {
  res.json(publicUser(req.username, req.user));
});

// SAHADAKİ İSİM VE FORMA NUMARASI
app.put('/api/profile', auth, async (req, res) => {
  const {
    displayName,
    jerseyNumber,
    jerseyColor
  } = req.body || {};

  if (
    typeof displayName !== 'string' ||
    displayName.trim().length < 2 ||
    displayName.trim().length > 16
  ) {
    return res.status(400).json({
      error: 'Sahadaki isim 2-16 karakter olmalı.'
    });
  }

  const number = Number(jerseyNumber);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 99
  ) {
    return res.status(400).json({
      error: 'Forma numarası 1-99 arasında olmalı.'
    });
  }

  if (
    typeof jerseyColor !== 'string' ||
    !/^#[0-9a-fA-F]{6}$/.test(jerseyColor)
  ) {
    return res.status(400).json({
      error: 'Forma rengi geçersiz.'
    });
  }

  req.user.profile = {
    displayName: displayName.trim(),
    jerseyNumber: number,
    jerseyColor
  };

  await saveUsers();

  for (const player of players.values()) {
    if (player.username === req.username) {
      player.name = req.user.profile.displayName;
      player.jerseyNumber = number;
      player.jerseyColor = jerseyColor;
    }
  }

  res.json({
    profile: req.user.profile
  });
});

// KULLANICI ADINI DEĞİŞTİR
app.put('/api/account/username', auth, async (req, res) => {
  const { username, password } = req.body || {};

  if (!validUsername(username)) {
    return res.status(400).json({
      error:
        'Yeni kullanıcı adı 3-16 karakter olmalı; harf, rakam ve _ kullanılabilir.'
    });
  }

  if (
    typeof password !== 'string' ||
    !verifyPassword(password, req.user)
  ) {
    return res.status(401).json({
      error: 'Mevcut şifre yanlış.'
    });
  }

  const newKey = normalizeUsername(username);

  if (newKey !== req.username && users[newKey]) {
    return res.status(409).json({
      error: 'Bu kullanıcı adı zaten kullanılıyor.'
    });
  }

  const oldKey = req.username;

  req.user.username = username.trim();
  users[newKey] = req.user;

  if (newKey !== oldKey) {
    delete users[oldKey];
  }

  sessions.delete(req.token);

  const token = issueSession(newKey);

  for (const player of players.values()) {
    if (player.username === oldKey) {
      player.username = newKey;
    }
  }

  await saveUsers();

  res.json({
    token,
    ...publicUser(newKey, req.user)
  });
});

// ŞİFRE DEĞİŞTİR
app.put('/api/account/password', auth, async (req, res) => {
  const {
    currentPassword,
    newPassword
  } = req.body || {};

  if (
    typeof currentPassword !== 'string' ||
    !verifyPassword(currentPassword, req.user)
  ) {
    return res.status(401).json({
      error: 'Mevcut şifre yanlış.'
    });
  }

  if (
    typeof newPassword !== 'string' ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    return res.status(400).json({
      error: 'Yeni şifre 8-128 karakter arasında olmalı.'
    });
  }

  const hashed = passwordHash(newPassword);

  req.user.salt = hashed.salt;
  req.user.hash = hashed.hash;

  await saveUsers();

  res.json({
    ok: true,
    message: 'Şifre başarıyla değiştirildi.'
  });
});

// ÇIKIŞ
app.post('/api/logout', auth, (req, res) => {
  sessions.delete(req.token);

  res.json({ ok: true });
});

// TAKIM SEÇİMİ
function getTeam() {
  let blue = 0;
  let red = 0;

  for (const p of players.values()) {
    p.team === 'blue' ? blue++ : red++;
  }

  if (blue < red && blue < 6) return 'blue';
  if (red < blue && red < 6) return 'red';

  if (blue < 6) return 'blue';
  if (red < 6) return 'red';

  return null;
}

function spawnPosition(team, index) {
  const x = team === 'blue'
    ? FIELD.x + 180
    : FIELD.x + FIELD.width - 180;

  const direction = team === 'blue' ? 1 : -1;

  return {
    x: x + direction * (index % 2) * 55,
    y: FIELD.y + 120 + Math.floor(index / 2) * 105
  };
}

function resetBall() {
  ball.x = FIELD.x + FIELD.width / 2;
  ball.y = FIELD.y + FIELD.height / 2;
  ball.vx = Math.random() < 0.5 ? 3 : -3;
  ball.vy = (Math.random() - 0.5) * 2;
}

function resetPlayers() {
  let bi = 0;
  let ri = 0;

  for (const p of players.values()) {
    const pos = spawnPosition(
      p.team,
      p.team === 'blue' ? bi++ : ri++
    );

    p.x = pos.x;
    p.y = pos.y;
    p.vx = 0;
    p.vy = 0;
  }

  resetBall();
}

function resetMatch() {
  blueScore = 0;
  redScore = 0;
  matchTime = MATCH_TIME;

  resetPlayers();
}

// OYUNCUYU SUNUCUYA BAĞLA
function addPlayer(ws, token) {
  const username = sessions.get(token);

  if (!username || !users[username]) {
    ws.send(JSON.stringify({
      type: 'auth_error',
      message: 'Oturum geçersiz. Yeniden giriş yap.'
    }));

    ws.close();
    return;
  }

  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({
      type: 'full',
      message: 'Sunucu dolu.'
    }));

    ws.close();
    return;
  }

  const team = getTeam();

  if (!team) {
    ws.send(JSON.stringify({
      type: 'full',
      message: 'Takımlar dolu.'
    }));

    ws.close();
    return;
  }

  for (const p of players.values()) {
    if (p.username === username) {
      ws.send(JSON.stringify({
        type: 'auth_error',
        message: 'Bu hesap zaten oyunda.'
      }));

      ws.close();
      return;
    }
  }

  const user = users[username];
  const profile = user.profile || {};
  const id = crypto.randomBytes(6).toString('hex');

  const player = {
    id,
    username,
    name: profile.displayName || user.username,
    jerseyNumber: profile.jerseyNumber || 10,
    jerseyColor: profile.jerseyColor || '#299cff',
    team,
    ws,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    keys: {
      up: false,
      down: false,
      left: false,
      right: false
    }
  };

  players.set(id, player);
  ws.playerId = id;

  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    team,
    name: player.name,
    jerseyNumber: player.jerseyNumber,
    jerseyColor: player.jerseyColor
  }));

  resetPlayers();

  console.log(
    `${player.name} katıldı - ${team} - ${players.size}/${MAX_PLAYERS}`
  );
}

// WEBSOCKET
wss.on('connection', ws => {
  ws.on('message', raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!ws.playerId) {
      if (data.type === 'join' && typeof data.token === 'string') {
        addPlayer(ws, data.token);
      }

      return;
    }

    const player = players.get(ws.playerId);

    if (!player) return;

    if (data.type === 'input') {
      player.keys.up = data.up === true;
      player.keys.down = data.down === true;
      player.keys.left = data.left === true;
      player.keys.right = data.right === true;
    }
  });

  ws.on('close', () => {
    if (ws.playerId) {
      players.delete(ws.playerId);
      resetPlayers();
    }
  });
});

// OYUNCU FİZİĞİ
function updatePlayer(p) {
  const dx =
    (p.keys.right ? 1 : 0) -
    (p.keys.left ? 1 : 0);

  const dy =
    (p.keys.down ? 1 : 0) -
    (p.keys.up ? 1 : 0);

  if (dx || dy) {
    const len = Math.hypot(dx, dy);

    p.vx = dx / len * PLAYER_SPEED;
    p.vy = dy / len * PLAYER_SPEED;
  } else {
    p.vx *= 0.72;
    p.vy *= 0.72;
  }

  p.x += p.vx;
  p.y += p.vy;

  const minX = FIELD.x + PLAYER_RADIUS;
  const maxX = FIELD.x + FIELD.width - PLAYER_RADIUS;
  const minY = FIELD.y + PLAYER_RADIUS;
  const maxY = FIELD.y + FIELD.height - PLAYER_RADIUS;

  if (p.x < minX) {
    p.x = minX;
    p.vx = 0;
  }

  if (p.x > maxX) {
    p.x = maxX;
    p.vx = 0;
  }

  if (p.y < minY) {
    p.y = minY;
    p.vy = 0;
  }

  if (p.y > maxY) {
    p.y = maxY;
    p.vy = 0;
  }
}

function collideBall(p) {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;

  const min = PLAYER_RADIUS + BALL_RADIUS;
  const ds = dx * dx + dy * dy;

  if (ds >= min * min) return;

  const d = Math.sqrt(ds) || 1;
  const nx = dx / d;
  const ny = dy / d;

  ball.x = p.x + nx * min;
  ball.y = p.y + ny * min;

  ball.vx += nx * 2.4 + p.vx * 0.65;
  ball.vy += ny * 2.4 + p.vy * 0.65;

  const speed = Math.hypot(ball.vx, ball.vy);

  if (speed > BALL_MAX_SPEED) {
    ball.vx = ball.vx / speed * BALL_MAX_SPEED;
    ball.vy = ball.vy / speed * BALL_MAX_SPEED;
  }
}

function updateBall() {
  ball.x += ball.vx;
  ball.y += ball.vy;

  ball.vx *= 0.992;
  ball.vy *= 0.992;

  if (ball.y - BALL_RADIUS < FIELD.y) {
    ball.y = FIELD.y + BALL_RADIUS;
    ball.vy *= -0.9;
  }

  if (ball.y + BALL_RADIUS > FIELD.y + FIELD.height) {
    ball.y = FIELD.y + FIELD.height - BALL_RADIUS;
    ball.vy *= -0.9;
  }

  const top =
    FIELD.y + FIELD.height / 2 - GOAL.height / 2;

  const bottom =
    FIELD.y + FIELD.height / 2 + GOAL.height / 2;

  if (ball.x - BALL_RADIUS < FIELD.x) {
    if (ball.y > top && ball.y < bottom) {
      redScore++;
      resetPlayers();
      return;
    }

    ball.x = FIELD.x + BALL_RADIUS;
    ball.vx *= -0.9;
  }

  if (ball.x + BALL_RADIUS > FIELD.x + FIELD.width) {
    if (ball.y > top && ball.y < bottom) {
      blueScore++;
      resetPlayers();
      return;
    }

    ball.x = FIELD.x + FIELD.width - BALL_RADIUS;
    ball.vx *= -0.9;
  }
}

function physics() {
  for (const p of players.values()) updatePlayer(p);
  for (const p of players.values()) collideBall(p);

  updateBall();
}

// OYUN DURUMUNU GÖNDER
function sendState() {
  if (!players.size) return;

  const message = JSON.stringify({
    type: 'state',

    players: [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      jerseyNumber: p.jerseyNumber,
      jerseyColor: p.jerseyColor,
      team: p.team,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10
    })),

    ball: {
      x: Math.round(ball.x * 10) / 10,
      y: Math.round(ball.y * 10) / 10
    },

    score: {
      blue: blueScore,
      red: redScore
    },

    matchTime,
    maxPlayers: MAX_PLAYERS,
    field: FIELD,
    goal: GOAL
  });

  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(message);
    }
  }
}

setInterval(physics, 1000 / 60);
setInterval(sendState, 1000 / 20);

setInterval(() => {
  if (!players.size) return;

  matchTime--;

  if (matchTime <= 0) resetMatch();
}, 1000);

server.listen(PORT, () => {
  console.log(
    `Mini HaxBall server çalışıyor. Port: ${PORT}; kullanıcı dosyası: ${USERS_FILE}`
  );
});
