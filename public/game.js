(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PRESETS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#111111', '#8e24aa', '#fb8c00'];

// ------------------------------------------------------------------ profil
const profile = { num: 10, name: '' };
try { Object.assign(profile, JSON.parse(localStorage.getItem('mf_profile') || '{}')); } catch (e) { /* yoksay */ }
const inNum = $('#inNum'), inName = $('#inName');
inNum.value = profile.num; inName.value = profile.name;

// ------------------------------------------------------------------ durum
const scr = { menu: $('#menu'), servers: $('#servers'), create: $('#create'), lobby: $('#lobby'), game: $('#game') };
let ws = null, joined = false, lobbyOpen = false;
let st = null, cfg = null, forms = null;
const me = { id: 0, team: -1, slot: -1 };
const pinfo = new Map();      // id -> {color,num,name,team}
let snapCur = null, snapPrev = null, curMap = new Map(), prevMap = new Map(), snapT = 0, snapInt = 33;
let prevPhase = '';
let lastStats = null;
let bannerTimer = 0, toastTimer = 0, errAt = 0;
let standH = 24;
const fanSeats = new Map();   // id -> tribün koltuğu (v1.2)
const bubbles = new Map();    // id -> {txt, until}
let celeb = { team: -1, until: 0 };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function show(name) {
  for (const k in scr) scr[k].classList.toggle('hidden', k !== name);
  $('#acct').classList.toggle('hidden', !['menu', 'servers', 'create'].includes(name));
  if (name === 'servers') loadServers();
}

// ------------------------------------------------------------------ hesap (v1.3)
let acct = null, token = '';
try { token = localStorage.getItem('so_token') || ''; } catch (e) { /* yoksay */ }
let acctMode = 'login';
function setAcct(a, tok) {
  acct = a; token = a ? tok : '';
  try { if (a) localStorage.setItem('so_token', tok); else localStorage.removeItem('so_token'); } catch (e) { /* yoksay */ }
  $('#acctName').classList.toggle('hidden', !a);
  $('#acctName').textContent = a ? '\u2713 ' + a.name : '';
  $('#btnAcct').textContent = a ? 'Çıkış yap' : 'Giriş yap / Kayıt ol';
  inName.disabled = !!a;
  if (a) inName.value = a.name; else if (inName.value === '') inName.value = profile.name;
}
function setMode(m) {
  acctMode = m;
  $('#tabLogin').classList.toggle('on', m === 'login'); $('#tabReg').classList.toggle('on', m === 'reg');
  $('#aSubmit').textContent = m === 'login' ? 'GİRİŞ' : 'HESAP OLUŞTUR';
  $('#aPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#aNote').classList.toggle('hidden', m === 'login');
  $('#aErr').textContent = '';
}
$('#btnAcct').addEventListener('click', () => {
  if (acct) { setAcct(null); toast('Çıkış yapıldı'); return; }
  setMode('login'); $('#acctModal').classList.remove('hidden'); setTimeout(() => $('#aName').focus(), 30);
});
$('#tabLogin').addEventListener('click', () => setMode('login'));
$('#tabReg').addEventListener('click', () => setMode('reg'));
$('#aCancel').addEventListener('click', () => $('#acctModal').classList.add('hidden'));
$('#acctForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#aErr').textContent = '';
  try {
    const r = await fetch(acctMode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('#aName').value, pass: $('#aPass').value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('#aErr').textContent = j.error || 'Hata'; return; }
    setAcct({ name: j.name }, j.token);
    $('#aPass').value = ''; $('#acctModal').classList.add('hidden');
    toast('Hoş geldin, ' + j.name);
  } catch (err) { $('#aErr').textContent = 'Sunucuya ulaşılamadı'; }
});
if (token) {
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => setAcct({ name: j.name }, token)).catch(() => setAcct(null));
}

// ------------------------------------------------------------------ menü
function readProfile() {
  profile.num = clamp(parseInt(inNum.value, 10) || 10, 1, 99);
  profile.name = acct ? acct.name : (inName.value || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 14) || 'Oyuncu';
  inNum.value = profile.num; inName.value = profile.name;
  try { localStorage.setItem('mf_profile', JSON.stringify(profile)); } catch (err) { /* yoksay */ }
}
$('#menuForm').addEventListener('submit', (e) => { e.preventDefault(); readProfile(); show('servers'); });
// v1.3: tek kalıcı 11v11 sunucusuna doğrudan giriş
$('#btn11').addEventListener('click', () => { readProfile(); join(0, ''); });
$('#btnBack').addEventListener('click', () => show('menu'));

// ------------------------------------------------------------------ sunucu listesi
function phaseText(r) {
  if (r.ph === 'lobby') return 'Lobi • mevki seçimi';
  if (r.ph === 'end') return 'Maç bitti';
  const l = Math.max(0, r.left), m = Math.floor(l / 60), s = String(l % 60).padStart(2, '0');
  return 'Maçta • ' + r.sc[0] + '-' + r.sc[1] + ' • ' + m + ':' + s;
}
function renderServers(list) {
  const box = $('#serverList');
  box.textContent = '';
  if (!list.length) { box.append(mk('div', 'empty', 'Henüz açık sunucu yok. “Sunucu kur” ile ilk sunucuyu sen aç!')); return; }
  list.sort((x, y) => y.count - x.count);
  for (const r of list) {
    const c = mk('div', 'srv');
    const left = mk('div');
    const h = mk('h3', '', r.name);
    if (r.lock) h.append(mk('span', 'lock', '\uD83D\uDD12'));
    left.append(h, mk('div', 'st', phaseText(r)));
    if (r.own) left.append(mk('div', 'own', 'Kurucu: ' + r.own));
    c.append(left, mk('div', 'cnt', r.count + '/' + r.max));
    const bar = mk('div', 'bar'); const fill = mk('i'); fill.style.width = (r.count / r.max * 100) + '%'; bar.append(fill);
    const b = mk('button', 'btn primary', r.count >= r.max ? 'DOLU' : 'KATIL');
    b.type = 'button'; b.disabled = r.count >= r.max;
    b.addEventListener('click', () => (r.lock ? askPass(r) : join(r.id, '')));
    c.append(bar, b);
    box.append(c);
  }
}
function loadServers() {
  if (scr.servers.classList.contains('hidden')) return;
  fetch('/api/servers', { cache: 'no-store' }).then((r) => r.json()).then(renderServers).catch(() => {});
}
setInterval(loadServers, 2000);

// sunucu kur (v1.2)
const cMax = $('#cMax');
function cMaxUpdate() {
  const v = parseInt(cMax.value, 10) || 16;
  $('#cMaxTxt').textContent = v;
  $('#cNote').textContent = '8v8 maç (16 oyuncu) + ' + (v - 16) + ' taraftar';
}
cMax.addEventListener('input', cMaxUpdate);
$('#btnCreate').addEventListener('click', () => show('create'));
$('#btnCreateBack').addEventListener('click', () => show('servers'));
$('#createForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#cName').value.trim();
  if (!name) { toast('Sunucu ismi gerekli'); return; }
  connect({ t: 'create', name, max: parseInt(cMax.value, 10) || 16, pass: $('#cPass').value, pname: profile.name, num: profile.num });
});

// parola penceresi
let pwRoom = null;
function askPass(r) {
  pwRoom = r;
  $('#pwTitle').textContent = r.name + ' — parola gerekli';
  $('#pwInput').value = '';
  $('#pwModal').classList.remove('hidden');
  setTimeout(() => $('#pwInput').focus(), 30);
}
$('#pwCancel').addEventListener('click', () => $('#pwModal').classList.add('hidden'));
$('#pwForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pwRoom) return;
  $('#pwModal').classList.add('hidden');
  join(pwRoom.id, $('#pwInput').value);
});

// ------------------------------------------------------------------ bağlantı
function join(room, pass) { connect({ t: 'join', room, name: profile.name, num: profile.num, pass: pass || '' }); }
function connect(first) {
  closeWs();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(proto + '://' + location.host + '/ws');
  ws = sock;
  if (acct && token) first.token = token;
  sock.onopen = () => sock.send(JSON.stringify(first));
  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    onMsg(m);
  };
  sock.onclose = () => {
    if (sock !== ws) return;
    const was = joined;
    ws = null; joined = false; st = null; snapCur = snapPrev = null; lobbyOpen = false;
    keys.clear(); pushInput(); resetFans();
    if (was && Date.now() - errAt > 1500) toast('Bağlantı koptu');
    show('servers');
  };
}
function closeWs() {
  if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* yoksay */ } }
  joined = false; st = null; snapCur = snapPrev = null; lobbyOpen = false;
  resetFans();
}
function leaveRoom() { closeWs(); keys.clear(); lastKey = ''; show('servers'); }
$('#btnLeave').addEventListener('click', leaveRoom);
$('#btnExit').addEventListener('click', leaveRoom);
$('#btnLobby').addEventListener('click', () => { lobbyOpen = true; keys.clear(); pushInput(); updateView(); });
$('#btnCloseLobby').addEventListener('click', () => { lobbyOpen = false; updateView(); });

function onMsg(m) {
  switch (m.t) {
    case 'hi':
      me.id = m.id; cfg = m.cfg; forms = m.forms; joined = true; lastStats = null; setPanel(false);
      $('#lobbyTitle').textContent = m.room;
      for (const c of ctrl) c.fillForms();
      resize();
      break;
    case 'err': errAt = Date.now(); toast(m.m || 'Hata'); break;
    case 'info': toast(m.m || ''); break;
    case 'say': onSay(m); break;
    case 'state': onState(m); break;
    case 's': onSnap(m); break;
    case 'stats':
      lastStats = m; updatePos();
      if (statsVisible()) renderStats($('#statsBody'));
      if (!$('#end').classList.contains('hidden')) renderStats($('#endStats'));
      break;
    case 'goal': celeb = { team: m.tm, until: performance.now() + 5000 }; onGoal(m); break;
    default: break;
  }
}

// ------------------------------------------------------------------ lobi arayüzü
const lpitch = $('#lpitch');
const ctrl = [0, 1].map(buildCtrl);

function buildCtrl(t) {
  const root = $('#ctrl' + t);
  const head = mk('div', 'chead'), chip = mk('i', 'chip'), title = mk('h3');
  head.append(chip, title);
  const cap = mk('p', 'capline');
  const set = mk('div', 'cset hidden');

  const lName = mk('label'); lName.append(mk('span', '', 'Takım adı'));
  const iName = mk('input'); iName.type = 'text'; iName.maxLength = 14; lName.append(iName);
  let nTimer = 0;
  iName.addEventListener('input', () => { clearTimeout(nTimer); nTimer = setTimeout(() => send({ t: 'team', name: iName.value }), 350); });

  const lCol = mk('label'); lCol.append(mk('span', '', 'Takım rengi'));
  const row = mk('div', 'row');
  const iCol = mk('input'); iCol.type = 'color';
  let cTimer = 0;
  iCol.addEventListener('input', () => { clearTimeout(cTimer); cTimer = setTimeout(() => send({ t: 'team', color: iCol.value }), 120); });
  const sw = mk('div', 'swatches');
  for (const c of PRESETS) {
    const b = mk('button', 'sw'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', c);
    b.addEventListener('click', () => send({ t: 'team', color: c }));
    sw.append(b);
  }
  row.append(iCol, sw); lCol.append(row);

  const lForm = mk('label'); lForm.append(mk('span', '', 'Diziliş'));
  const sel = mk('select'); lForm.append(sel);
  sel.addEventListener('change', () => send({ t: 'team', formation: sel.value }));

  set.append(lName, lCol, lForm);
  const ready = mk('button', 'btn primary hidden', 'HAZIR OL'); ready.type = 'button';
  ready.addEventListener('click', () => { if (st) send({ t: 'ready', v: !st.teams[t].rd }); });
  root.append(head, cap, set, ready);

  return {
    chip, title, cap, set, iName, iCol, sel, ready,
    fillForms() {
      sel.textContent = '';
      for (const k of Object.keys(forms)) { const o = mk('option', '', k); o.value = k; sel.append(o); }
    },
  };
}

const textOnCache = new Map();
function textOn(hex) {
  let v = textOnCache.get(hex);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  v = l > 150 ? '#111' : '#fff';
  textOnCache.set(hex, v);
  return v;
}

function renderLobby() {
  if (!st || !cfg || !forms) return;
  lpitch.querySelectorAll('.slot').forEach((n) => n.remove());
  const byId = new Map(st.players.map((p) => [p.id, p]));
  for (let t = 0; t < 2; t++) {
    const tm = st.teams[t], list = forms[tm.f];
    for (let i = 0; i < list.length; i++) {
      const [label, fx, fy] = list[i];
      const px = (30 + fx * (cfg.W / 2 - 80)) / cfg.W * 100, py = fy * 100;
      const occId = tm.sl[i], occ = occId == null ? null : byId.get(occId);
      const b = mk('button', 'slot ' + (occ ? 'taken' : 'free'));
      b.type = 'button';
      b.style.left = (t === 0 ? px : 100 - px) + '%';
      b.style.top = (t === 0 ? py : 100 - py) + '%';
      b.style.setProperty('--tc', tm.c);
      b.style.setProperty('--tx', textOn(tm.c));
      if (occ && occ.id === me.id) b.classList.add('mine');
      if (occ && tm.cap === occ.id) b.classList.add('cap');
      b.append(mk('span', 'dot', occ ? String(occ.u) : label), mk('span', 'lab', occ ? occ.n : label));
      b.addEventListener('click', () => {
        if (occ && occ.id === me.id) send({ t: 'leave' });
        else if (!occ) send({ t: 'take', team: t, slot: i });
      });
      lpitch.append(b);
    }
  }

  const inLobby = st.ph === 'lobby';
  for (let t = 0; t < 2; t++) {
    const tm = st.teams[t], c = ctrl[t];
    const capP = tm.cap == null ? null : byId.get(tm.cap);
    const isCap = tm.cap === me.id;
    c.chip.style.background = tm.c;
    c.title.textContent = tm.n;
    c.cap.textContent = '';
    if (capP) {
      const b = mk('b', '', capP.n);
      c.cap.append('Kaptan: ', b);
      const bd = mk('span', 'badge' + (tm.rd ? ' ok' : ''), tm.rd ? 'HAZIR' : 'bekliyor');
      if (inLobby) c.cap.append(bd);
    } else c.cap.textContent = 'Kaptan yok — ilk mevkiyi seçen kaptan olur';
    c.set.classList.toggle('hidden', !(isCap && inLobby));
    if (document.activeElement !== c.iName) c.iName.value = tm.n;
    c.iCol.value = tm.c;
    c.sel.value = tm.f;
    c.sel.disabled = !inLobby;
    c.ready.classList.toggle('hidden', !(isCap && inLobby));
    c.ready.textContent = tm.rd ? 'HAZIR ✓ (iptal et)' : 'HAZIR OL';
  }

  $('#lobbyInfo').textContent = st.players.length + '/' + st.max + ' kişi' + (st.lock ? ' • parolalı' : '');
  let hint;
  if (!inLobby) hint = 'Maç sürüyor — boş bir mevki seçerek oyuna katılabilirsin.';
  else if (me.slot < 0) hint = 'Bir mevki seç (ilk oturan kaptan olur) ya da taraftar olarak tribünden destek ver.';
  else if (st.teams[me.team].cap === me.id) hint = 'Kaptansın: takımını ayarla ve HAZIR OL\'a bas. İki kaptan hazır olunca maç başlar.';
  else hint = 'Kaptanın hazır olmasını bekle. Mevkine tekrar tıklarsan taraftar olursun.';
  $('#lobbyHint').textContent = hint;
  const sp = st.players.filter((p) => p.tm < 0).map((p) => p.n);
  $('#specs').textContent = sp.length ? 'Taraftarlar (' + sp.length + '): ' + sp.join(', ') : '';
  renderOwner();
}

function renderOwner() {
  const own = st && st.own === me.id;
  $('#owner').classList.toggle('hidden', !own);
  if (!own) return;
  const list = $('#ownList');
  list.textContent = '';
  for (const p of st.players) {
    if (p.id === me.id) continue;
    const row = mk('div', 'orow2');
    row.append(mk('span', '', (p.tm >= 0 ? '#' + p.u + ' ' : '') + p.n + (p.tm < 0 ? ' (taraftar)' : '')));
    const b = mk('button', '', 'AT'); b.type = 'button';
    b.addEventListener('click', () => send({ t: 'kick', id: p.id }));
    row.append(b);
    list.append(row);
  }
  if (!list.children.length) list.append(mk('p', 'note', 'Sunucuda başka kimse yok.'));
}
$('#btnSetPass').addEventListener('click', () => { const v = $('#ownPass').value.trim(); if (!v) { toast('Bir parola yaz'); return; } send({ t: 'setpass', v }); });
$('#btnDelPass').addEventListener('click', () => { $('#ownPass').value = ''; send({ t: 'setpass', v: '' }); });

// ------------------------------------------------------------------ durum mesajı
const el = {
  nameA: $('#nameA'), nameB: $('#nameB'), scoreA: $('#scoreA'), scoreB: $('#scoreB'),
  chipA: $('#chipA'), chipB: $('#chipB'), clock: $('#clock'), banner: $('#banner'),
  cd: $('#cd'), end: $('#end'), stam: $('#stam'), specBar: $('#specBar'),
};

function onState(m) {
  st = m;
  const mine = m.players.find((p) => p.id === me.id);
  me.team = mine ? mine.tm : -1;
  me.slot = mine ? mine.sl : -1;
  pinfo.clear();
  for (const p of m.players) if (p.tm >= 0) pinfo.set(p.id, { color: m.teams[p.tm].c, num: p.u, name: p.n, team: p.tm });

  el.nameA.textContent = m.teams[0].n; el.nameB.textContent = m.teams[1].n;
  el.chipA.style.background = m.teams[0].c; el.chipB.style.background = m.teams[1].c;
  el.scoreA.textContent = m.sc[0]; el.scoreB.textContent = m.sc[1];
  el.specBar.classList.toggle('hidden', me.slot >= 0 || m.ph === 'lobby');
  layoutFans(); updateFanBar(); updateTouchUi();
  updatePos();

  if (m.ph !== prevPhase) {
    if (m.ph === 'countdown' || m.ph === 'play') { el.banner.classList.add('hidden'); clearTimeout(bannerTimer); }
    if (m.ph === 'play' && prevPhase === 'countdown') flashGo();
    if (m.ph !== 'countdown') { el.cd.classList.add('hidden'); }
    if (m.ph === 'lobby') { lobbyOpen = false; snapCur = snapPrev = null; lastStats = null; setPanel(false); }
    if (m.ph === 'end') showEnd(); else el.end.classList.add('hidden');
    if (m.ph === 'countdown' && prevPhase === 'lobby') { lobbyOpen = false; }
    prevPhase = m.ph;
  }
  updateView();
  if (!scr.lobby.classList.contains('hidden')) renderLobby();
}

function updateView() {
  if (!joined || !st) return;
  const ph = st.ph;
  const showLobby = ph === 'lobby' || (lobbyOpen && ph !== 'end');
  scr.menu.classList.add('hidden'); scr.servers.classList.add('hidden'); scr.create.classList.add('hidden'); $('#acct').classList.add('hidden');
  $('#pwModal').classList.add('hidden');
  scr.lobby.classList.toggle('hidden', !showLobby);
  scr.game.classList.toggle('hidden', ph === 'lobby');
  $('#btnCloseLobby').classList.toggle('hidden', ph === 'lobby');
  if (showLobby) renderLobby();
  updateFanBar();
  if (!scr.game.classList.contains('hidden')) resize();
}

function flashGo() {
  el.cd.textContent = 'BAŞLA!';
  el.cd.className = 'cd go';
  setTimeout(() => { if (el.cd.classList.contains('go')) el.cd.classList.add('hidden'); }, 800);
}

function onGoal(m) {
  const who = $('#bWho'), ast = $('#bAst');
  const tn = st ? st.teams[m.tm].n : '';
  if (m.sc) who.textContent = (m.og ? 'Kendi kalesine: ' : '') + '#' + m.sc.u + ' ' + m.sc.n;
  else who.textContent = tn;
  ast.textContent = m.as ? 'Asist: #' + m.as.u + ' ' + m.as.n : (m.og ? tn + ' lehine' : '');
  el.banner.classList.remove('hidden');
  el.banner.style.borderColor = st ? st.teams[m.tm].c : '';
  el.banner.style.animation = 'none'; void el.banner.offsetWidth; el.banner.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.banner.classList.add('hidden'), 5000);
}

function showEnd() {
  const a = st.sc[0], b = st.sc[1];
  $('#endScore').textContent = st.teams[0].n + '  ' + a + ' - ' + b + '  ' + st.teams[1].n;
  $('#endWin').textContent = a === b ? 'Berabere!' : (a > b ? st.teams[0].n : st.teams[1].n) + ' kazandı!';
  const ul = $('#endGoals'); ul.textContent = '';
  for (const g of st.goals) {
    const li = mk('li');
    const chip = mk('i', 'chip'); chip.style.background = st.teams[g.tm].c;
    let txt = g.s ? '#' + g.sn + ' ' + g.s + (g.og ? ' (K.K.)' : '') : st.teams[g.tm].n;
    if (g.a) txt += '  •  asist: ' + g.a;
    li.append(mk('span', 'm', g.min), chip, mk('span', '', txt));
    ul.append(li);
  }
  el.end.classList.remove('hidden');
  setPanel(false);
  renderStats($('#endStats'));
}

// ------------------------------------------------------------------ istatistik
const panel = $('#statsPanel');
function statsVisible() { return !panel.classList.contains('hidden'); }
function setPanel(on) { panel.classList.toggle('hidden', !on); if (on) renderStats($('#statsBody')); }
panel.addEventListener('click', () => setPanel(false));
$('#btnStats').addEventListener('click', () => setPanel(!statsVisible()));

function updatePos() {
  if (!st) return;
  const p = lastStats ? lastStats.pos : [50, 50];
  $('#posA').textContent = p[0] + '%'; $('#posB').textContent = p[1] + '%';
  const f = $('#posFill');
  f.style.width = p[0] + '%'; f.style.background = st.teams[0].c;
  $('#pbar').style.background = st.teams[1].c;
}

function srow(label, a, b, ta, tb, ca, cb) {
  const r = mk('div', 'srow'), v = mk('div', 'v');
  v.append(mk('b', '', ta), mk('span', 'l', label), mk('b', '', tb));
  const bars = mk('div', 'bars'), L = mk('div'), R = mk('div'), li = mk('i'), ri = mk('i');
  const mx = Math.max(a, b, 1);
  li.style.width = (a / mx * 100) + '%'; li.style.background = ca;
  ri.style.width = (b / mx * 100) + '%'; ri.style.background = cb;
  L.append(li); R.append(ri); bars.append(L, R);
  r.append(v, bars);
  return r;
}

function renderStats(box) {
  box.textContent = '';
  if (!st || !lastStats) return;
  const S = lastStats, T = st.teams, ca = T[0].c, cb = T[1].c;
  const wrap = mk('div', 'sbox');
  const side = (i) => {
    const d = mk('div', 't'), c = mk('i', 'chip'), n = mk('span', '', T[i].n);
    c.style.background = T[i].c;
    if (i === 0) d.append(c, n); else d.append(n, c);
    return d;
  };
  const head = mk('div', 'sh'); head.append(side(0), mk('em', '', 'İSTATİSTİK'), side(1));
  wrap.append(head);

  const A = S.tm[0], B = S.tm[1];
  const acc = (t) => (t[2] ? Math.round(t[3] / t[2] * 100) : null);
  const pa = acc(A), pb = acc(B);
  wrap.append(
    srow('Gol', st.sc[0], st.sc[1], st.sc[0], st.sc[1], ca, cb),
    srow('Topla oynama', S.pos[0], S.pos[1], S.pos[0] + '%', S.pos[1] + '%', ca, cb),
    srow('Şut', A[0], B[0], A[0], B[0], ca, cb),
    srow('İsabetli şut', A[1], B[1], A[1], B[1], ca, cb),
    srow('Pas', A[3], B[3], A[3] + '/' + A[2], B[3] + '/' + B[2], ca, cb),
    srow('Pas isabeti', pa || 0, pb || 0, pa == null ? '–' : pa + '%', pb == null ? '–' : pb + '%', ca, cb),
    srow('Top kapma', A[4], B[4], A[4], B[4], ca, cb)
  );

  if (S.pl.length) {
    const tb2 = mk('table', 'ptab'), th = mk('tr');
    for (const h of ['Oyuncu', 'G', 'A', 'Şut', 'İsb.', 'Pas', 'Pas%']) th.append(mk('th', '', h));
    tb2.append(th);
    const rows = S.pl.slice().sort((x, y) => y[4] - x[4] || y[5] - x[5] || y[6] - x[6] || y[9] - x[9]);
    for (const p of rows) {
      const tr = mk('tr', p[0] === me.id ? 'me' : ''), td = mk('td'), chip = mk('i', 'chip');
      chip.style.background = T[p[3]] ? T[p[3]].c : '#888';
      td.append(chip, mk('span', '', '#' + p[2] + ' ' + p[1]));
      tr.append(td, mk('td', '', p[4]), mk('td', '', p[5]), mk('td', '', p[6]), mk('td', '', p[7]),
        mk('td', '', p[9] + '/' + p[8]), mk('td', '', p[8] ? Math.round(p[9] / p[8] * 100) + '%' : '–'));
      tb2.append(tr);
    }
    wrap.append(tb2);
  }
  box.append(wrap);
}

// ------------------------------------------------------------------ snapshot
let lastStam = -1, lastTired = false;
function onSnap(m) {
  const now = performance.now();
  if (snapCur) snapInt = clamp(snapInt * 0.8 + (now - snapT) * 0.2, 20, 120);
  snapPrev = snapCur || m; prevMap = snapCur ? curMap : null;
  snapCur = m; curMap = new Map(m.p.map((a) => [a[0], a]));
  if (!prevMap) prevMap = curMap;
  snapT = now;

  const t = Math.ceil(m.r), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  el.clock.textContent = mm + ':' + ss;
  el.clock.classList.toggle('low', t <= 30 && st && st.ph === 'play');

  if (st && st.ph === 'countdown') {
    el.cd.className = 'cd';
    el.cd.textContent = m.c > 1.6 ? String(Math.ceil(m.c)) : 'HAZIR';
  }
  const mine = curMap.get(me.id);
  const hold = mine ? (mine[6] || 0) : 0;
  const hh = $('#holdHud');
  hh.classList.toggle('hidden', !hold);
  if (hold) hh.textContent = 'TOP SENDE — ' + (hold / 10).toFixed(1) + ' sn içinde oyunu başlat!';
  if (mine) {
    if (mine[4] !== lastStam) { lastStam = mine[4]; el.stam.style.width = mine[4] + '%'; }
  }
}

// ------------------------------------------------------------------ çizim
const cv = $('#cv'), ctx = cv.getContext('2d');
const pitchCv = document.createElement('canvas');
let dpr = 1, cw = 0, ch = 0, sc = 1, ox = 0, oy = 0;

function resize() {
  if (!cfg || scr.game.classList.contains('hidden')) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = window.innerWidth; ch = window.innerHeight;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  const isFan = me.slot < 0;
  const top = ch > 520 ? 100 : 64, bottom = isFan ? (ch > 520 ? 118 : 64) : 10, pad = 12;
  standH = clamp(Math.round(ch * 0.05), 18, 34);
  const availH = ch - top - bottom - standH * 2 - 8;
  sc = Math.min((cw - pad * 2) / (cfg.W + cfg.GD * 2), availH / (cfg.H + pad));
  ox = (cw - cfg.W * sc) / 2;
  oy = top + standH + 4 + (availH - cfg.H * sc) / 2;
  buildPitch();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

function buildPitch() {
  pitchCv.width = cv.width; pitchCv.height = cv.height;
  const g = pitchCv.getContext('2d');
  const { W, H, GW, GD, POST } = cfg;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#0a3519'; g.fillRect(0, 0, pitchCv.width, pitchCv.height);
  // tribünler (v1.2)
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const i of [0, 1]) {
    const r = standRect(i);
    const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, i ? '#33475b' : '#1b2733'); gr.addColorStop(1, i ? '#1b2733' : '#33475b');
    g.fillStyle = gr; g.fillRect(r.x0, r.y, r.w, r.h);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.strokeRect(r.x0 + .5, r.y + .5, r.w - 1, r.h - 1);
  }
  g.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);

  const n = 14, sw = W / n;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#1b6e34' : '#1f7a3a'; g.fillRect(i * sw, 0, sw + 0.5, H); }

  const cy = H / 2, hg = GW / 2;
  // kaleler (ağ)
  for (const side of [0, 1]) {
    const x0 = side ? W : -GD;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x0, cy - hg, GD, GW);
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= GD; x += 8) { g.moveTo(x0 + x, cy - hg); g.lineTo(x0 + x, cy + hg); }
    for (let y = 0; y <= GW; y += 8) { g.moveTo(x0, cy - hg + y); g.lineTo(x0 + GD, cy - hg + y); }
    g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath();
    if (side === 0) { g.moveTo(0, cy - hg); g.lineTo(-GD, cy - hg); g.lineTo(-GD, cy + hg); g.lineTo(0, cy + hg); }
    else { g.moveTo(W, cy - hg); g.lineTo(W + GD, cy - hg); g.lineTo(W + GD, cy + hg); g.lineTo(W, cy + hg); }
    g.stroke();
  }

  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.lineJoin = 'round';
  g.strokeRect(0, 0, W, H);
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  g.beginPath(); g.arc(W / 2, cy, 90, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(W / 2, cy, 4, 0, Math.PI * 2); g.fill();
  // ceza ve kale sahaları
  for (const side of [0, 1]) {
    const dir = side ? -1 : 1, x0 = side ? W : 0;
    g.strokeRect(side ? W - cfg.BOX_W : 0, cy - cfg.BOX_H / 2, cfg.BOX_W, cfg.BOX_H);
    g.strokeRect(side ? W - 70 : 0, cy - (GW / 2 + 20), 70, GW + 40);
    g.beginPath(); g.arc(x0 + dir * 120, cy, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x0 + dir * 120, cy, 70, dir > 0 ? -0.93 : Math.PI - 0.93, dir > 0 ? 0.93 : Math.PI + 0.93); g.stroke();
  }
  // direkler
  for (const x of [0, W]) for (const y of [cy - hg, cy + hg]) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, POST, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#222'; g.stroke();
  }
}

function drawPlayer(x, y, info, isMe, charge, hold) {
  const R = cfg.R;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + R * 0.75, R, R * 0.55, 0, 0, 6.2832); ctx.fill();
  // v1.1: şut çemberi — top bu çembere değerse vurulabilir
  ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
  ctx.strokeStyle = isMe ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.3)';
  const ring = info && info.sl === 0 ? cfg.KRING : cfg.RING;   // kaleci çemberi daha küçük
  ctx.beginPath(); ctx.arc(x, y, ring, 0, 6.2832); ctx.stroke(); ctx.restore();
  if (hold > 0) {   // v1.2: kaleci topu tutuyor — 5 sn geri sayım
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, cfg.KRING + 5, -Math.PI / 2, -Math.PI / 2 + hold / (cfg.HOLD_T * 10) * 6.2832); ctx.stroke();
    ctx.fillStyle = '#ff8a3d'; ctx.font = '800 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((hold / 10).toFixed(1), x, y + R + 17);
  }
  if (charge > 0) {
    ctx.strokeStyle = charge > 70 ? '#ff5252' : '#ffd23f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, R + 6, -Math.PI / 2, -Math.PI / 2 + charge / 100 * 6.2832); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(x, y, R, 0, 6.2832);
  ctx.fillStyle = info.color; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = isMe ? '#fff' : '#0b0b0b'; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = textOn(info.color); ctx.font = '800 15px system-ui,sans-serif';
  ctx.fillText(info.num, x, y + 1);
  ctx.font = '600 11px system-ui,sans-serif';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.strokeText(info.name, x, y - R - 9); ctx.fillStyle = '#fff'; ctx.fillText(info.name, x, y - R - 9);
  if (isMe) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(x, y - R - 17); ctx.lineTo(x - 5, y - R - 25); ctx.lineTo(x + 5, y - R - 25); ctx.closePath(); ctx.fill();
  }
}

function drawBall(x, y) {
  const r = cfg.BR;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + r * 0.8, r, r * 0.5, 0, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * 1.2566;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42);
  }
  ctx.closePath(); ctx.fill();
}

// ------------------------------------------------------------------ taraftar / tribün (v1.2)
function standRect(i) {
  return { x0: ox - cfg.GD * sc, w: (cfg.W + cfg.GD * 2) * sc, y: i === 0 ? oy - 4 - standH : oy + cfg.H * sc + 4, h: standH };
}
function layoutFans() {
  fanSeats.clear();
  if (!st) return;
  const fans = st.players.filter((p) => p.tm < 0).sort((a, b) => a.id - b.id);
  const groups = [[[], [], []], [[], [], []]];
  fans.forEach((p, i) => { groups[i % 2][p.ft === 0 ? 0 : p.ft === 1 ? 1 : 2].push(p); });
  for (let stand = 0; stand < 2; stand++) for (let g = 0; g < 3; g++) {
    const arr = groups[stand][g];
    arr.forEach((p, k) => fanSeats.set(p.id, { id: p.id, stand, g, k, cnt: arr.length, ft: p.ft }));
  }
}
function seatPos(f) {
  const r = standRect(f.stand), sp = 16, rows = Math.max(1, Math.floor((r.h - 4) / 10));
  const col = Math.floor(f.k / rows), row = f.k % rows, cols = Math.ceil(f.cnt / rows);
  let x;
  if (f.g === 0) x = r.x0 + 14 + col * sp;
  else if (f.g === 1) x = r.x0 + r.w - 14 - col * sp;
  else x = r.x0 + r.w / 2 + (col - (cols - 1) / 2) * sp;
  return { x, y: r.y + (r.h - rows * 10) / 2 + 5 + row * 10 };
}
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawStands(now) {
  if (!fanSeats.size) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const f of fanSeats.values()) {
    const p = seatPos(f);
    const cele = celeb.until > now && celeb.team === f.ft;
    const bob = cele ? Math.abs(Math.sin(now / 110 + f.id)) * 5 : Math.abs(Math.sin(now / 600 + f.id * 1.7)) * 1.2;
    const col = f.ft >= 0 && st.teams[f.ft] ? st.teams[f.ft].c : '#cfd8dc', y = p.y - bob;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, y + 2, 4, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.stroke();
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(p.x, y - 3, 2.6, 0, 6.2832); ctx.fill();
    if (f.id === me.id) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(p.x - 3, y - 9, 6, 2); }
    if (cele) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x - 4, y); ctx.lineTo(p.x - 7, y - 8); ctx.moveTo(p.x + 4, y); ctx.lineTo(p.x + 7, y - 8); ctx.stroke(); }
  }
  ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [id, b] of bubbles) {
    if (b.until < now) { bubbles.delete(id); continue; }
    const f = fanSeats.get(id);
    if (!f) continue;
    const r = standRect(f.stand), p = seatPos(f), maxW = Math.min(r.w - 8, 360);
    let txt = b.txt;
    while (txt.length > 4 && ctx.measureText(txt).width + 14 > maxW) txt = txt.slice(0, -2) + '…';
    const w = ctx.measureText(txt).width + 14, h = Math.min(18, standH - 2);
    const x = clamp(p.x, r.x0 + w / 2 + 2, r.x0 + r.w - w / 2 - 2), y = r.y + r.h / 2;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; rrect(x - w / 2, y - h / 2, w, h, 8); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillText(txt, x, y + 1);
  }
}
function resetFans() {
  fanSeats.clear(); bubbles.clear();
  const f = $('#feed'); if (f) f.textContent = '';
  const fb = $('#fanBar'); if (fb) fb.classList.add('hidden');
  const hh = $('#holdHud'); if (hh) hh.classList.add('hidden');
}
function onSay(m) {
  bubbles.set(m.id, { txt: m.n + ': ' + m.txt, until: performance.now() + 5000 });
  const feed = $('#feed'), d = mk('div'), chip = mk('i', 'chip');
  chip.style.cssText = 'width:10px;height:10px;margin-right:6px;vertical-align:-1px;background:' + (m.ft >= 0 && st && st.teams[m.ft] ? st.teams[m.ft].c : '#cfd8dc');
  d.append(chip, mk('b', '', m.n + ':'), document.createTextNode(m.txt));
  feed.append(d);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => d.remove(), 14000);
}
const fanBar = $('#fanBar'), fanTxt = $('#fanTxt');
for (const t of ['Hadi!', 'Goool!', 'Hakem!', 'Güzel pas!', 'Yuh!']) {
  const b = mk('button', '', t); b.type = 'button';
  b.addEventListener('click', () => send({ t: 'say', txt: t }));
  $('#fchants').append(b);
}
fanBar.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = fanTxt.value.trim();
  if (!t) return;
  send({ t: 'say', txt: t }); fanTxt.value = '';
});
$('#fs0').addEventListener('click', () => send({ t: 'support', v: 0 }));
$('#fs1').addEventListener('click', () => send({ t: 'support', v: 1 }));
$('#fsN').addEventListener('click', () => send({ t: 'support', v: -1 }));
function updateFanBar() {
  const on = !!(joined && st && me.slot < 0 && st.ph !== 'end');
  fanBar.classList.toggle('hidden', !on);
  if (!on) return;
  const mine = st.players.find((p) => p.id === me.id), ft = mine ? mine.ft : -1;
  for (const t of [0, 1]) {
    const b = $('#fs' + t);
    b.querySelector('em').textContent = st.teams[t].n;
    b.querySelector('.chip').style.background = st.teams[t].c;
    b.classList.toggle('on', ft === t);
  }
  $('#fsN').classList.toggle('on', ft !== 0 && ft !== 1);
}
function updateTouchUi() {
  $('#touch').classList.toggle('hidden', !(('ontouchstart' in window) || navigator.maxTouchPoints > 0) || me.slot < 0);
  $('#tHold').classList.toggle('hidden', me.slot !== 0);
  $('#stamWrap').classList.toggle('hidden', me.slot < 0);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!joined || !st || !cfg || scr.game.classList.contains('hidden') || !snapCur) return;
  if (scr.lobby.classList.contains('hidden') === false) return;
  pushInput();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(pitchCv, 0, 0);
  drawStands(now);
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  const a = clamp((now - snapT) / snapInt, 0, 1);

  for (const arr of snapCur.p) {
    const info = pinfo.get(arr[0]);
    if (!info) continue;
    const pv = prevMap.get(arr[0]);
    const x = pv ? pv[1] + (arr[1] - pv[1]) * a : arr[1];
    const y = pv ? pv[2] + (arr[2] - pv[2]) * a : arr[2];
    drawPlayer(x, y, info, arr[0] === me.id, arr[3], arr[6] || 0);
  }
  const b = snapCur.b, pb = snapPrev.b || b;
  drawBall(pb[0] + (b[0] - pb[0]) * a, pb[1] + (b[1] - pb[1]) * a);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ giriş
const keys = new Set();
const joy = { x: 0, y: 0, id: -1 };
let kickKey = false, sprintKey = false, touchKick = false, touchSprint = false, lastKey = '';
let grabKey = false, mouseKick = false, mouseGrab = false, touchHold = false;
const KMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };

function inGameView() { return joined && st && st.ph !== 'lobby' && scr.lobby.classList.contains('hidden') && !scr.game.classList.contains('hidden'); }

function pushInput() {
  let dx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
  let dy = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
  if (joy.id !== -1) { dx = joy.x; dy = joy.y; }
  const s = (sprintKey || touchSprint) ? 1 : 0, k = (kickKey || touchKick || mouseKick) ? 1 : 0, g = (grabKey || mouseGrab || touchHold) ? 1 : 0;
  const key = dx + ',' + dy + ',' + s + ',' + k + ',' + g;
  if (key === lastKey) return;
  lastKey = key;
  send({ t: 'in', dx, dy, s, k, g });
}

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (!inGameView()) return;
  const d = KMAP[e.code];
  if (d) keys.add(d);
  else if (e.code === 'Tab') setPanel(true);
  else if (e.code === 'Space' || e.code === 'KeyX' || e.code === 'KeyK') kickKey = true;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') sprintKey = true;
  else if (e.code === 'KeyE' || e.code === 'KeyF') grabKey = true;
  else return;
  e.preventDefault();
  pushInput();
});
window.addEventListener('keyup', (e) => {
  const d = KMAP[e.code];
  if (d) keys.delete(d);
  else if (e.code === 'Tab') { setPanel(false); e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'KeyX' || e.code === 'KeyK') kickKey = false;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') sprintKey = false;
  else if (e.code === 'KeyE' || e.code === 'KeyF') grabKey = false;
  else return;
  pushInput();
});
window.addEventListener('blur', () => { keys.clear(); kickKey = sprintKey = grabKey = mouseKick = mouseGrab = false; pushInput(); });

// fare (v1.2): sol tık = şut, sağ tık = kaleci topu tutar
scr.game.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || !inGameView()) return;
  if (e.target.closest && e.target.closest('button,input,select,#statsPanel,#end')) return;
  if (e.button === 0) mouseKick = true;
  else if (e.button === 2) mouseGrab = true;
  else return;
  e.preventDefault();
  pushInput();
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (e.button === 0) mouseKick = false;
  else if (e.button === 2) mouseGrab = false;
  else return;
  pushInput();
});

// dokunmatik
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) {
  $('#touch').classList.remove('hidden');
  const zone = $('#joy'), knob = $('#knob');
  let ox0 = 0, oy0 = 0;
  const MAXR = 56;
  zone.addEventListener('pointerdown', (e) => {
    if (joy.id !== -1) return;
    joy.id = e.pointerId; ox0 = e.clientX; oy0 = e.clientY;
    zone.setPointerCapture(e.pointerId);
    const r = zone.getBoundingClientRect();
    knob.style.display = 'block'; knob.style.left = (ox0 - r.left) + 'px'; knob.style.top = (oy0 - r.top) + 'px';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - ox0, dy = e.clientY - oy0;
    const l = Math.hypot(dx, dy);
    if (l > MAXR) { dx = dx / l * MAXR; dy = dy / l * MAXR; }
    const r = zone.getBoundingClientRect();
    knob.style.left = (ox0 + dx - r.left) + 'px'; knob.style.top = (oy0 + dy - r.top) + 'px';
    const q = (v) => Math.round(v / MAXR * 10) / 10;
    joy.x = Math.abs(dx / MAXR) < 0.15 ? 0 : q(dx);
    joy.y = Math.abs(dy / MAXR) < 0.15 ? 0 : q(dy);
    pushInput();
  });
  const end = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = -1; joy.x = joy.y = 0; knob.style.display = 'none'; pushInput();
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  const bind = (id, on, off) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); on(); pushInput(); });
    const up = () => { b.classList.remove('on'); off(); pushInput(); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  };
  bind('#tKick', () => { touchKick = true; }, () => { touchKick = false; });
  bind('#tSprint', () => { touchSprint = true; }, () => { touchSprint = false; });
  bind('#tHold', () => { touchHold = true; }, () => { touchHold = false; });
}
document.addEventListener('contextmenu', (e) => e.preventDefault());

cMaxUpdate();
show('menu');
})();
