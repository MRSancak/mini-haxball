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

const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '32kb' }));

// HTML, CSS VE GELİŞMİŞ RETRO GRAFİKLER
app.get('/', (_req, res) => {
  res.send(`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mini Haxball Pixel League</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');

:root {
  --bg:#070b10;
  --panel:#111a24;
  --line:#223647;
  --cream:#f4efcf;
  --lime:#c9f06b;
  --cyan:#64dce8;
  --red:#ff6b6b;
  --blue:#3bb2ff;
}

*, *::before, *::after { box-sizing:border-box; }

body {
  margin:0;
  background:var(--bg);
  color:var(--cream);
  font:20px 'VT323',monospace;
}

button, input { font:inherit; }

button {
  cursor:pointer;
  border:0;
  background:var(--lime);
  color:#0d131a;
  padding:12px 18px;
  font:10px 'Press Start 2P';
  box-shadow:4px 4px #658c2c;
  transition: transform 0.08s, background 0.2s;
}
button:hover { background: #d7ff77; }
button:active { transform: translate(2px, 2px); box-shadow:2px 2px #658c2c; }
button:disabled { opacity:.5; cursor:not-allowed; }

.secondary {
  background:#1f303f;
  color:var(--cream);
  box-shadow:4px 4px #070c10;
}
.secondary:hover { background: #273d50; }

.danger {
  background:var(--red);
  color:#0d131a;
  box-shadow:4px 4px #9c3f3f;
}

.hidden { display:none!important; }
.wrap { max-width:1320px; margin:auto; padding:20px; }

.top, .game-head {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
  margin-bottom:20px;
}

.brand {
  font:16px/1.8 'Press Start 2P';
  color:var(--lime);
  text-shadow: 2px 2px #000, 0 0 10px rgba(201,240,107,0.4);
}

.tag, h2, h3 {
  font-family:'Press Start 2P';
  font-size:10px;
  line-height:1.8;
  color:var(--cyan);
}

.panel {
  background:var(--panel);
  border:3px solid var(--line);
  padding:24px;
  box-shadow:8px 8px #040609, inset 0 0 20px rgba(0,0,0,0.5);
  margin-bottom: 20px;
}

input {
  width:100%;
  padding:12px;
  background:#070b10;
  color:white;
  border:2px solid #2a4359;
  margin-bottom: 14px;
  font-size: 20px;
  outline: none;
}
input:focus { border-color: var(--cyan); }

label { display:block; margin:6px 0; font-size: 15px; }

.auth-grid { max-width:480px; margin:50px auto; }

.error { color:var(--red); min-height:24px; font-size: 16px; margin-top: 5px; }
.note { color:#849da8; font-size: 18px; }

.dashboard {
  display:grid;
  grid-template-columns:350px minmax(0,1fr);
  gap:20px;
}

.profile-top { display:flex; gap:14px; align-items:center; margin-bottom: 18px; }

.avatar {
  width:70px;
  height:70px;
  display:grid;
  place-items:center;
  background:var(--lime);
  color:#0d131a;
  font-family:'Press Start 2P';
  font-size: 18px;
  border: 3px solid #223647;
  box-shadow: 4px 4px #000;
}

.stat {
  display:flex;
  justify-content:space-between;
  gap:10px;
  border-top:1px dashed var(--line);
  padding:10px 0;
  font-size: 19px;
}
.stat b { color:var(--lime); font-weight:normal; text-align:right; }

.server {
  background:#090f16;
  border:2px solid var(--line);
  padding:20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:15px;
  margin:12px 0;
}

.score-board {
  background:#05080c;
  border:3px solid var(--line);
  padding:12px 24px;
  font:12px 'Press Start 2P';
  display: flex;
  gap: 15px;
  align-items: center;
  box-shadow: inset 0 0 10px rgba(0,0,0,0.8);
}
.score-board span { color:var(--lime); text-shadow: 0 0 8px rgba(201,240,107,0.5); }

.game-layout {
  display:grid;
  grid-template-columns:minmax(0,1fr) 280px;
  gap:16px;
}

.pitch-wrap { position: relative; }

#pitch {
  width:100%;
  height:auto;
  display:block;
  border:6px solid #1a2a1e;
  image-rendering:pixelated;
  background:#2f693a;
  box-shadow: 0 12px 30px rgba(0,0,0,0.7), inset 0 0 50px rgba(0,0,0,0.3);
}

.goal-overlay {
  position: absolute;
  inset: 0;
  background: rgba(7, 11, 16, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  text-align: center;
  animation: fadeIn 0.2s ease-in-out;
}

.goal-banner {
  font: 32px 'Press Start 2P';
  color: var(--lime);
  text-shadow: 4px 4px #000, 0 0 20px var(--lime);
  margin-bottom: 15px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.sidebox { background:var(--panel); border:3px solid var(--line); padding:16px; margin-bottom:14px; }
.key { display:inline-block; background:#070b10; border:2px solid #2a4359; padding:4px 8px; color:var(--lime); font-size: 15px; font-weight:bold; }

#playersList { max-height:280px; overflow:auto; font-size: 18px; }
.status { min-height:24px; color:#849da8; margin-top:10px; font-size: 18px; }

.footer { text-align:center; color:#4a626e; margin:25px; font-size: 16px; }

@media(max-width:800px) {
  .auth-grid, .dashboard, .game-layout { grid-template-columns:1fr; }
  .wrap { padding:10px; }
}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <div>
    <div class="tag">ONLINE FOOTBALL / SEASON 02</div>
    <div class="brand">MINI HAXBALL<br>PIXEL LEAGUE</div>
  </div>
  <div id="headerRight" class="tag">GİRİŞ YAPILMADI</div>
</header>

<!-- GİRİŞ / KAYIT EKRANI -->
<section id="authView">
  <div class="auth-grid">
    <div class="panel">
      <h2>HESAP GİRİŞİ / KAYIT</h2>
      <p class="note">Kayıt ol veya mevcut hesabınla giriş yap.</p>
      
      <form id="authForm">
        <label>Kullanıcı Adı (3-16 karakter)</label>
        <input id="authUsername" placeholder="Kullanıcı adın" minlength="3" maxlength="16" required autocomplete="username">
        
        <label>Şifre (En az 8 karakter)</label>
        <input id="authPassword" type="password" placeholder="Şifren" minlength="8" required autocomplete="current-password">
        
        <div id="authError" class="error"></div>
        
        <div style="display:flex; gap:10px; margin-top:15px;">
          <button type="submit" style="flex:1;">GİRİŞ YAP</button>
          <button type="button" id="registerBtn" class="secondary" style="flex:1;">KAYIT OL</button>
        </div>
      </form>
      
      <div style="margin-top:20px; border-top:1px dashed var(--line); padding-top:15px; text-align:center;">
        <button type="button" id="guestBtn" class="secondary" style="width:100%;">MİSAFİR OLARAK DEVAM ET</button>
      </div>
    </div>
  </div>
</section>

<!-- OYUNCU DASHBOARD / PROFİL & İSTATİSTİKLER -->
<section id="dashboardView" class="hidden">
  <div class="dashboard">
    <aside class="panel">
      <h2>OYUNCU KARTI</h2>
      <div class="profile-top">
        <div id="avatar" class="avatar">10</div>
        <div>
          <div id="displayProfileName" style="font-family:'Press Start 2P'; font-size:10px; color:var(--lime);"></div>
          <div class="tag">KAYITLI OYUNCU</div>
        </div>
      </div>

      <div class="stat"><span>Kullanıcı Adı</span><b id="profileUsername"></b></div>
      <div class="stat"><span>Oynanan Maç</span><b id="statMatches">0</b></div>
      <div class="stat"><span>Goller</span><b id="statGoals">0</b></div>
      <div class="stat"><span>Asistler</span><b id="statAssists">0</b></div>
      
      <div style="margin-top:15px;">
        <h3>PROFİLİ DÜZENLE</h3>
        <label>Sahadaki İsim</label>
        <input id="editDisplayName" maxlength="16">
        <label>Forma Numarası (1-99)</label>
        <input id="editJerseyNum" type="number" min="1" max="99">
        <label>Forma Rengi</label>
        <input id="editJerseyColor" type="color">
        <button type="button" id="saveProfileBtn" style="width:100%; margin-top:5px;">GÜNCELLE</button>
        <div id="profileError" class="error"></div>
      </div>

      <button class="secondary danger" id="logoutBtn" style="width:100%; margin-top:20px">ÇIKIŞ YAP</button>
    </aside>

    <main class="panel">
      <h2>SUNUCU LİSTESİ</h2>
      <div class="server">
        <div>
          <div class="tag">EU / PUBLIC ARENA</div>
          <h2>PIXEL ARENA #01</h2>
          <div class="note" id="serverPlayerCount">● AÇIK · 0/12 OYUNCU</div>
        </div>
        <button id="joinServerBtn">SUNUCUYA GİR</button>
      </div>
    </main>
  </div>
</section>

<!-- MAÇ OYUN EKRANI -->
<section id="gameView" class="hidden">
  <div class="game-head">
    <div class="score-board">
      <div>MAVİ: <span id="blueScore">0</span></div>
      <div>—</div>
      <div>KIRMIZI: <span id="redScore">0</span></div>
    </div>
    <div class="score-board">SÜRE <span id="timeLeft">05:00</span></div>
    <button class="secondary" id="leaveGameBtn">LOBİYE DÖN</button>
  </div>

  <div class="game-layout">
    <div>
      <div class="pitch-wrap">
        <canvas id="pitch" width="1200" height="700"></canvas>
        <div id="goalOverlay" class="goal-overlay hidden">
          <div class="goal-banner">GOOOOL!</div>
          <div id="goalScorerText" class="note" style="color:var(--cream); font-size:24px;">Golü Atan: -</div>
        </div>
      </div>
      <div id="gameStatus" class="status">WASD: Hareket | Top Sende İken SPACE: Şut | Top Sende Değilken SPACE: Top Kapma</div>
    </div>

    <aside>
      <div class="sidebox">
        <h3>KONTROLLER</h3>
        <p><span class="key">W A S D</span> Hareket et</p>
        <p><span class="key">SPACE</span> Top Sende: <b>Şut Çek</b></p>
        <p><span class="key">SPACE</span> Top Rakipte: <b>Top Kap</b></p>
      </div>
      <div class="sidebox">
        <h3>SAHADAKİLER</h3>
        <div id="playersList"></div>
      </div>
    </aside>
  </div>
</section>

<div class="footer">MINI HAXBALL PIXEL LEAGUE</div>
</div>

<script>
(() => {
'use strict';
const $ = id => document.getElementById(id);
let token = localStorage.getItem('mh_token') || '';
let currentUser = null;
let ws = null;
let myId = null;
let keys = { up:false, down:false, left:false, right:false, space:false };

function show(id) {
  ['authView','dashboardView','gameView'].forEach(v => $(v).classList.toggle('hidden', v !== id));
}

async function api(endpoint, data) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'İşlem başarısız.');
  return json;
}

async function apiPut(endpoint, data) {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Güncelleme başarısız.');
  return json;
}

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const res = await api('/api/login', { username: $('authUsername').value, password: $('authPassword').value });
    loginSuccess(res);
  } catch (err) { $('authError').textContent = err.message; }
});

$('registerBtn').onclick = async () => {
  try {
    const res = await api('/api/register', { username: $('authUsername').value, password: $('authPassword').value });
    loginSuccess(res);
  } catch (err) { $('authError').textContent = err.message; }
};

$('guestBtn').onclick = async () => {
  const randName = 'Misafir_' + Math.floor(Math.random() * 900 + 100);
  const randPass = Math.random().toString(36).slice(-10) + 'A1!';
  try {
    const reg = await api('/api/register', { username: randName, password: randPass });
    loginSuccess(reg);
  } catch (err) { $('authError').textContent = err.message; }
};

function loginSuccess(res) {
  token = res.token;
  localStorage.setItem('mh_token', token);
  currentUser = res;
  updateProfileUI();
  show('dashboardView');
}

async function checkSession() {
  if (!token) return;
  try {
    const res = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error();
    currentUser = await res.json();
    updateProfileUI();
    show('dashboardView');
  } catch {
    localStorage.removeItem('mh_token');
    token = '';
    show('authView');
  }
}

function updateProfileUI() {
  if (!currentUser) return;
  $('headerRight').textContent = 'OYUNCU: ' + currentUser.profile.displayName;
  $('displayProfileName').textContent = currentUser.profile.displayName;
  $('profileUsername').textContent = currentUser.username;
  $('statMatches').textContent = currentUser.stats.matches;
  $('statGoals').textContent = currentUser.stats.goals;
  $('statAssists').textContent = currentUser.stats.assists;
  $('editDisplayName').value = currentUser.profile.displayName;
  $('editJerseyNum').value = currentUser.profile.jerseyNumber;
  $('editJerseyColor').value = currentUser.profile.jerseyColor;
  $('avatar').textContent = currentUser.profile.jerseyNumber;
  $('avatar').style.backgroundColor = currentUser.profile.jerseyColor;
}

$('saveProfileBtn').onclick = async () => {
  try {
    const res = await apiPut('/api/profile', {
      displayName: $('editDisplayName').value,
      jerseyNumber: Number($('editJerseyNum').value),
      jerseyColor: $('editJerseyColor').value
    });
    currentUser.profile = res.profile;
    updateProfileUI();
    $('profileError').textContent = 'Profil güncellendi!';
    setTimeout(() => $('profileError').textContent = '', 2000);
  } catch (err) { $('profileError').textContent = err.message; }
};

$('logoutBtn').onclick = () => {
  localStorage.removeItem('mh_token');
  token = '';
  currentUser = null;
  show('authView');
};

$('joinServerBtn').onclick = () => {
  show('gameView');
  connectWebSocket();
};

$('leaveGameBtn').onclick = () => {
  if (ws) ws.close();
  checkSession();
  show('dashboardView');
};

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);

  ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', token })); };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'welcome') {
      myId = msg.id;
    } else if (msg.type === 'state') {
      renderGame(msg);
    } else if (msg.type === 'goal') {
      showGoalAnimation(msg.scorer);
    } else if (msg.type === 'full' || msg.type === 'auth_error') {
      alert(msg.message);
      checkSession();
      show('dashboardView');
    }
  };
}

function showGoalAnimation(scorerName) {
  $('goalScorerText').textContent = 'Golü Atan: ' + (scorerName || 'Bilinmiyor');
  $('goalOverlay').classList.remove('hidden');
  setTimeout(() => {
    $('goalOverlay').classList.add('hidden');
  }, 2500);
}

// RETRO CANLI GRAFİKLER
const canvas = $('pitch');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function renderGame(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#2f693a';
  ctx.fillRect(40, 40, 1120, 620);

  ctx.fillStyle = '#285d32';
  for (let x = 40; x < 1160; x += 80) {
    ctx.fillRect(x, 40, 40, 620);
  }

  ctx.strokeStyle = '#e2ecd1';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, 1120, 620);

  ctx.beginPath();
  ctx.moveTo(600, 40);
  ctx.lineTo(600, 660);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(600, 350, 85, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeRect(40, 230, 45, 240);
  ctx.strokeRect(1115, 230, 45, 240);

  state.players.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y + 6, 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = p.jerseyColor;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.id === myId ? '#c9f06b' : '#0d131a';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.jerseyNumber, p.x, p.y + 4);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#f4efcf';
    ctx.fillText(p.name, p.x, p.y - 24);

    if (p.slowTimer > 0) {
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '10px monospace';
      ctx.fillText('YAVAŞLA!', p.x, p.y - 38);
    }
  });

  if (state.ball) {
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y + 3, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a2a1e';
    ctx.stroke();
  }

  $('blueScore').textContent = state.score.blue;
  $('redScore').textContent = state.score.red;

  const m = Math.floor(state.matchTime / 60);
  const s = state.matchTime % 60;
  $('timeLeft').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');

  $('playersList').innerHTML = state.players.map(p => 
    '<div style="color:' + (p.team === 'blue' ? '#3bb2ff' : '#ff6b6b') + '">' +
    (p.id === myId ? '▶ ' : '') + '#' + p.jerseyNumber + ' ' + p.name + ' (' + p.team.toUpperCase() + ')' +
    '</div>'
  ).join('');
}

// KONTROLLER
const keyMap = { w:'up', ArrowUp:'up', s:'down', ArrowDown:'down', a:'left', ArrowLeft:'left', d:'right', ArrowRight:'right' };

window.addEventListener('keydown', e => {
  if (e.key === ' ') {
    keys.space = true;
    sendInput();
    e.preventDefault();
  }
  if (keyMap[e.key]) {
    keys[keyMap[e.key]] = true;
    sendInput();
  }
});

window.addEventListener('keyup', e => {
  if (e.key === ' ') {
    keys.space = false;
    sendInput();
  }
  if (keyMap[e.key]) {
    keys[keyMap[e.key]] = false;
    sendInput();
  }
});

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', ...keys }));
  keys.space = false;
}

checkSession();
})();
</script>
</body>
</html>`);
});

// SUNUCU & KALICI VERİTABANI YÖNETİMİ
const DATA_DIR = process.env.USER_DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'user.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    fs.writeFileSync(USERS_FILE, '{}\n', { mode: 0o600 });
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
const players = new Map();
const MAX_PLAYERS = 12;
const MATCH_TIME = 300;

const FIELD = { x: 40, y: 40, width: 1120, height: 620 };
const GOAL = { width: 45, height: 240 };
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 4.8;
const BALL_RADIUS = 13;

let blueScore = 0;
let redScore = 0;
let matchTime = MATCH_TIME;
let lastTouchPlayer = null;
const ball = { x: 600, y: 350, vx: 0, vy: 0 };

function normalizeUsername(v) { return String(v || '').trim().toLowerCase(); }
function validUsername(v) { return typeof v === 'string' && /^[a-zA-Z0-9_]{3,16}$/.test(v.trim()); }

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, record) {
  try {
    const hash = crypto.scryptSync(password, record.salt, 64);
    const expected = Buffer.from(record.hash, 'hex');
    return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
  } catch { return false; }
}

function publicUser(username, user) {
  const profile = user.profile || {};
  const stats = user.stats || { matches: 0, goals: 0, assists: 0 };
  return {
    username: user.username || username,
    profile: {
      displayName: profile.displayName || user.username || username,
      jerseyNumber: Number.isInteger(profile.jerseyNumber) ? profile.jerseyNumber : 10,
      jerseyColor: profile.jerseyColor || '#3bb2ff'
    },
    stats
  };
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const username = sessions.get(token);
  if (!username || !users[username]) return res.status(401).json({ error: 'Oturum süresi doldu.' });
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

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Geçersiz kullanıcı adı (3-16 karakter).' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  
  const key = normalizeUsername(username);
  if (users[key]) return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });

  const hashed = passwordHash(password);
  users[key] = {
    username: username.trim(),
    salt: hashed.salt,
    hash: hashed.hash,
    profile: { displayName: username.trim(), jerseyNumber: 10, jerseyColor: '#3bb2ff' },
    stats: { matches: 0, goals: 0, assists: 0 }
  };
  await saveUsers();
  res.status(201).json({ token: issueSession(key), ...publicUser(key, users[key]) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = normalizeUsername(username);
  const user = users[key];
  if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre.' });
  res.json({ token: issueSession(key), ...publicUser(key, user) });
});

app.get('/api/profile', auth, (req, res) => {
  res.json(publicUser(req.username, req.user));
});

app.put('/api/profile', auth, async (req, res) => {
  const { displayName, jerseyNumber, jerseyColor } = req.body || {};
  if (typeof displayName !== 'string' || displayName.trim().length < 2) return res.status(400).json({ error: 'Geçersiz isim.' });
  
  req.user.profile = {
    displayName: displayName.trim(),
    jerseyNumber: Math.max(1, Math.min(99, Number(jerseyNumber) || 10)),
    jerseyColor: /^#[0-9a-fA-F]{6}$/.test(jerseyColor) ? jerseyColor : '#3bb2ff'
  };
  await saveUsers();
  res.json({ profile: req.user.profile });
});

function getTeam() {
  let blue = 0, red = 0;
  for (const p of players.values()) p.team === 'blue' ? blue++ : red++;
  return blue <= red ? 'blue' : 'red';
}

function resetBall() {
  ball.x = FIELD.x + FIELD.width / 2;
  ball.y = FIELD.y + FIELD.height / 2;
  ball.vx = 0;
  ball.vy = 0;
  lastTouchPlayer = null;
}

function resetPlayers() {
  let bi = 0, ri = 0;
  for (const p of players.values()) {
    const isBlue = p.team === 'blue';
    p.x = isBlue ? FIELD.x + 200 + (bi * 45) : FIELD.x + FIELD.width - 200 - (ri * 45);
    p.y = FIELD.y + 200 + (isBlue ? bi++ : ri++) * 80;
    p.vx = 0; p.vy = 0;
    p.hasBall = false;
    p.slowTimer = 0;
  }
  resetBall();
}

function handleGoal(scoringTeam) {
  let scorerName = 'Bilinmiyor';
  if (lastTouchPlayer && players.has(lastTouchPlayer.id)) {
    scorerName = lastTouchPlayer.name;
    const userKey = normalizeUsername(lastTouchPlayer.username);
    if (users[userKey]) {
      users[userKey].stats.goals = (users[userKey].stats.goals || 0) + 1;
      saveUsers();
    }
  }

  const goalMsg = JSON.stringify({ type: 'goal', scorer: scorerName });
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(goalMsg);
  }

  if (scoringTeam === 'blue') blueScore++;
  else redScore++;

  resetPlayers();
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (!ws.playerId) {
      if (data.type === 'join' && typeof data.token === 'string') {
        const username = sessions.get(data.token);
        if (!username || !users[username] || players.size >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ type: 'full', message: 'Sunucu dolu veya oturum geçersiz.' }));
          return ws.close();
        }
        const user = users[username];
        user.stats.matches = (user.stats.matches || 0) + 1;
        saveUsers();

        const id = crypto.randomBytes(6).toString('hex');
        const team = getTeam();

        const player = {
          id, username,
          name: user.profile.displayName,
          jerseyNumber: user.profile.jerseyNumber,
          jerseyColor: user.profile.jerseyColor,
          team, ws, x: 0, y: 0, vx: 0, vy: 0,
          keys: { up: false, down: false, left: false, right: false },
          hasBall: false,
          slowTimer: 0
        };

        players.set(id, player);
        ws.playerId = id;
        ws.send(JSON.stringify({ type: 'welcome', id, team }));
        resetPlayers();
      }
      return;
    }

    const player = players.get(ws.playerId);
    if (player && data.type === 'input') {
      player.keys.up = !!data.up;
      player.keys.down = !!data.down;
      player.keys.left = !!data.left;
      player.keys.right = !!data.right;

      if (data.space) {
        if (player.hasBall) {
          ball.vx = (player.team === 'blue' ? 1 : -1) * 15;
          ball.vy = (Math.random() - 0.5) * 4;
          player.hasBall = false;
          lastTouchPlayer = player;
        } else if (player.slowTimer <= 0) {
          let success = false;
          for (const other of players.values()) {
            if (other.id !== player.id && Math.hypot(other.x - player.x, other.y - player.y) < 65) {
              if (other.hasBall) {
                other.hasBall = false;
                player.hasBall = true;
                lastTouchPlayer = player;
                success = true;
                break;
              }
            }
          }
          if (!success) {
            player.slowTimer = 60;
          }
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws.playerId) {
      players.delete(ws.playerId);
      resetPlayers();
    }
  });
});

// FİZİK DÖNGÜSÜ
setInterval(() => {
  for (const p of players.values()) {
    if (p.slowTimer > 0) p.slowTimer--;

    const currentSpeed = p.slowTimer > 0 ? PLAYER_SPEED * 0.45 : PLAYER_SPEED;
    const dx = (p.keys.right ? 1 : 0) - (p.keys.left ? 1 : 0);
    const dy = (p.keys.down ? 1 : 0) - (p.keys.up ? 1 : 0);

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      p.vx = (dx / len) * currentSpeed;
      p.vy = (dy / len) * currentSpeed;
    } else {
      p.vx *= 0.75; p.vy *= 0.75;
    }

    p.x = Math.max(FIELD.x + PLAYER_RADIUS, Math.min(FIELD.x + FIELD.width - PLAYER_RADIUS, p.x + p.vx));
    p.y = Math.max(FIELD.y + PLAYER_RADIUS, Math.min(FIELD.y + FIELD.height - PLAYER_RADIUS, p.y + p.vy));

    if (p.hasBall) {
      ball.x = p.x + (p.team === 'blue' ? 20 : -20);
      ball.y = p.y;
      ball.vx = p.vx;
      ball.vy = p.vy;
    }
  }

  for (const p of players.values()) {
    const dist = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (dist < PLAYER_RADIUS + BALL_RADIUS) {
      for (const other of players.values()) other.hasBall = false;
      p.hasBall = true;
      lastTouchPlayer = p;
      ball.vx = p.vx * 1.2;
      ball.vy = p.vy * 1.2;
    }
  }

  if (![...players.values()].some(p => p.hasBall)) {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= 0.985;
    ball.vy *= 0.985;
  }

  if (ball.y - BALL_RADIUS < FIELD.y) { ball.y = FIELD.y + BALL_RADIUS; ball.vy *= -0.85; }
  if (ball.y + BALL_RADIUS > FIELD.y + FIELD.height) { ball.y = FIELD.y + FIELD.height - BALL_RADIUS; ball.vy *= -0.85; }

  const goalTop = FIELD.y + FIELD.height / 2 - GOAL.height / 2;
  const goalBot = FIELD.y + FIELD.height / 2 + GOAL.height / 2;

  if (ball.x - BALL_RADIUS < FIELD.x) {
    if (ball.y > goalTop && ball.y < goalBot) {
      handleGoal('red');
      return;
    }
    ball.x = FIELD.x + BALL_RADIUS; ball.vx *= -0.85;
  }
  if (ball.x + BALL_RADIUS > FIELD.x + FIELD.width) {
    if (ball.y > goalTop && ball.y < goalBot) {
      handleGoal('blue');
      return;
    }
    ball.x = FIELD.x + FIELD.width - BALL_RADIUS; ball.vx *= -0.85;
  }
}, 1000 / 60);

// CANLI OYUN DURUMU SİNYALİ
setInterval(() => {
  if (!players.size) return;
  const state = JSON.stringify({
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, jerseyNumber: p.jerseyNumber, jerseyColor: p.jerseyColor, team: p.team,
      x: Math.round(p.x), y: Math.round(p.y), slowTimer: p.slowTimer
    })),
    ball: { x: Math.round(ball.x), y: Math.round(ball.y) },
    score: { blue: blueScore, red: redScore },
    matchTime
  });
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(state);
  }
}, 1000 / 20);

setInterval(() => {
  if (players.size > 0) {
    matchTime--;
    if (matchTime <= 0) { blueScore = 0; redScore = 0; matchTime = MATCH_TIME; resetPlayers(); }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Mini Haxball Pixel League aktif! Port: ${PORT}`);
});
