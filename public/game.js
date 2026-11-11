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
const scr = { menu: $('#menu'), servers: $('#servers'), lobby: $('#lobby'), game: $('#game') };
let ws = null, joined = false, lobbyOpen = false, wasKicked = false, maxP = 30;
let st = null, cfg = null, forms = null;
const me = { id: 0, team: -1, slot: -1 };
const pinfo = new Map();      // id -> {color,num,name,team}
let snapCur = null, snapPrev = null, curMap = new Map(), prevMap = new Map(), snapT = 0, snapInt = 33;
let prevPhase = '';
let lastStats = null;
let bannerTimer = 0, toastTimer = 0;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function show(name) {
  for (const k in scr) scr[k].classList.toggle('hidden', k !== name);
  if (name === 'servers') loadServers();
}

// ------------------------------------------------------------------ menü
$('#menuForm').addEventListener('submit', (e) => {
  e.preventDefault();
  profile.num = clamp(parseInt(inNum.value, 10) || 10, 1, 99);
  profile.name = (inName.value || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 14) || 'Oyuncu';
  inNum.value = profile.num; inName.value = profile.name;
  try { localStorage.setItem('mf_profile', JSON.stringify(profile)); } catch (err) { /* yoksay */ }
  show('servers');
});
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
  for (const r of list) {
    const c = mk('div', 'srv');
    const left = mk('div');
    left.append(mk('h3', '', r.name), mk('div', 'st', phaseText(r)));
    c.append(left, mk('div', 'cnt', r.count + '/' + r.max));
    const bar = mk('div', 'bar'); const fill = mk('i'); fill.style.width = (r.count / r.max * 100) + '%'; bar.append(fill);
    const b = mk('button', 'btn primary', r.count >= r.max ? 'DOLU' : 'KATIL');
    b.type = 'button'; b.disabled = r.count >= r.max;
    b.addEventListener('click', () => join(r.id));
    c.append(bar, b);
    box.append(c);
  }
}
function loadServers() {
  if (scr.servers.classList.contains('hidden')) return;
  fetch('/api/servers', { cache: 'no-store' }).then((r) => r.json()).then(renderServers).catch(() => {});
}
setInterval(loadServers, 2000);

// ------------------------------------------------------------------ bağlantı
function join(room) {
  closeWs(); wasKicked = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(proto + '://' + location.host + '/ws');
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'join', room, name: profile.name, num: profile.num }));
  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    onMsg(m);
  };
  sock.onclose = () => {
    if (sock !== ws) return;
    const was = joined;
    ws = null; joined = false; st = null; snapCur = snapPrev = null; lobbyOpen = false;
    keys.clear(); pushInput();
    if (was && !wasKicked) toast('Bağlantı koptu');
    show('servers');
  };
}
function closeWs() {
  if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* yoksay */ } }
  joined = false; st = null; snapCur = snapPrev = null; lobbyOpen = false;
}
function leaveRoom() { closeWs(); keys.clear(); lastKey = ''; show('servers'); }
$('#btnLeave').addEventListener('click', leaveRoom);
$('#btnExit').addEventListener('click', leaveRoom);
$('#btnLobby').addEventListener('click', () => { lobbyOpen = true; keys.clear(); pushInput(); updateView(); });
$('#btnCloseLobby').addEventListener('click', () => { lobbyOpen = false; updateView(); });

function onMsg(m) {
  switch (m.t) {
    case 'hi':
      me.id = m.id; cfg = m.cfg; forms = m.forms; maxP = m.max || maxP; joined = true; lastStats = null; setPanel(false);
      $('#lobbyTitle').textContent = m.room;
      for (const c of ctrl) c.fillForms();
      resize();
      break;
    case 'err': toast(m.m || 'Hata'); break;
    case 'kicked': wasKicked = true; toast(m.m || 'Sunucudan atıldın'); break;
    case 'state': onState(m); break;
    case 's': onSnap(m); break;
    case 'stats':
      lastStats = m; updatePos();
      if (statsVisible()) renderStats($('#statsBody'));
      if (!$('#end').classList.contains('hidden')) renderStats($('#endStats'));
      break;
    case 'goal': onGoal(m); break;
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

  const adm = st.players.find((p) => p.id === st.ad);
  $('#lobbyInfo').textContent = st.players.length + '/' + maxP + ' oyuncu' + (adm ? ' • Admin: ' + adm.n + (adm.id === me.id ? ' (sen)' : '') : '');
  renderAdmin(byId);
  let hint;
  if (!inLobby) hint = 'Maç sürüyor — boş bir mevki seçerek oyuna katılabilirsin.';
  else if (me.slot < 0) hint = 'Bir mevki seç. Takımda ilk oturan kaptan olur.';
  else if (st.teams[me.team].cap === me.id) hint = 'Kaptansın: takımını ayarla ve HAZIR OL\'a bas. İki kaptan hazır olunca maç başlar.';
  else hint = 'Kaptanın hazır olmasını bekle. Mevkine tekrar tıklarsan izleyici olursun.';
  $('#lobbyHint').textContent = hint;
  const sp = st.players.filter((p) => p.tm < 0).map((p) => '#' + p.u + ' ' + p.n);
  $('#specs').textContent = sp.length ? 'İzleyiciler: ' + sp.join(', ') : '';
}

// ------------------------------------------------------------------ admin paneli
function renderAdmin(byId) {
  const isAdmin = st.ad === me.id;
  const box = $('#adminBox');
  box.classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  const others = st.players.filter((p) => p.id !== me.id);
  const idle = others.filter((p) => p.tm < 0).length;
  const kb = $('#btnKickIdle');
  kb.textContent = 'Boştakileri at (' + idle + ')';
  kb.disabled = idle === 0;
  const list = $('#adminList');
  list.textContent = '';
  if (!others.length) { list.append(mk('span', 'aempty', 'Sunucuda başka oyuncu yok')); return; }
  for (const p of others) {
    const row = mk('div', 'arow' + (p.tm < 0 ? ' idle' : ''));
    const where = p.tm < 0 ? 'boşta' : st.teams[p.tm].n + ' • ' + (forms[st.teams[p.tm].f][p.sl] || [''])[0];
    row.append(mk('span', 'an', '#' + p.u + ' ' + p.n), mk('small', '', where));
    const x = mk('button', 'akick', '✕'); x.type = 'button'; x.title = 'At';
    x.addEventListener('click', () => send({ t: 'kick', id: p.id }));
    row.append(x);
    list.append(row);
  }
}
$('#btnKickIdle').addEventListener('click', () => send({ t: 'kickIdle' }));

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
  scr.menu.classList.add('hidden'); scr.servers.classList.add('hidden');
  scr.lobby.classList.toggle('hidden', !showLobby);
  scr.game.classList.toggle('hidden', ph === 'lobby');
  $('#btnCloseLobby').classList.toggle('hidden', ph === 'lobby');
  if (showLobby) renderLobby();
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
  const top = 64, bottom = 10, pad = 12;
  const availH = ch - top - bottom;
  sc = Math.min((cw - pad * 2) / (cfg.W + cfg.GD * 2), availH / (cfg.H + pad));
  ox = (cw - cfg.W * sc) / 2;
  oy = top + (availH - cfg.H * sc) / 2;
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
    g.strokeRect(side ? W - 170 : 0, cy - 180, 170, 360);
    g.strokeRect(side ? W - 70 : 0, cy - 100, 70, 200);
    g.beginPath(); g.arc(x0 + dir * 120, cy, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x0 + dir * 120, cy, 70, dir > 0 ? -0.93 : Math.PI - 0.93, dir > 0 ? 0.93 : Math.PI + 0.93); g.stroke();
  }
  // direkler
  for (const x of [0, W]) for (const y of [cy - hg, cy + hg]) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, POST, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#222'; g.stroke();
  }
}

function drawPlayer(x, y, info, isMe, charge) {
  const R = cfg.R;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + R * 0.75, R, R * 0.55, 0, 0, 6.2832); ctx.fill();
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

function frame(now) {
  requestAnimationFrame(frame);
  if (!joined || !st || !cfg || scr.game.classList.contains('hidden') || !snapCur) return;
  if (scr.lobby.classList.contains('hidden') === false) return;
  pushInput();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(pitchCv, 0, 0);
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  const a = clamp((now - snapT) / snapInt, 0, 1);

  for (const arr of snapCur.p) {
    const info = pinfo.get(arr[0]);
    if (!info) continue;
    const pv = prevMap.get(arr[0]);
    const x = pv ? pv[1] + (arr[1] - pv[1]) * a : arr[1];
    const y = pv ? pv[2] + (arr[2] - pv[2]) * a : arr[2];
    drawPlayer(x, y, info, arr[0] === me.id, arr[3]);
  }
  const b = snapCur.b, pb = snapPrev.b || b;
  drawBall(pb[0] + (b[0] - pb[0]) * a, pb[1] + (b[1] - pb[1]) * a);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ giriş
const keys = new Set();
const joy = { x: 0, y: 0, id: -1 };
let kickKey = false, sprintKey = false, touchKick = false, touchSprint = false, lastKey = '';
const KMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };

function inGameView() { return joined && st && st.ph !== 'lobby' && scr.lobby.classList.contains('hidden') && !scr.game.classList.contains('hidden'); }

function pushInput() {
  let dx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
  let dy = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
  if (joy.id !== -1) { dx = joy.x; dy = joy.y; }
  const s = (sprintKey || touchSprint) ? 1 : 0, k = (kickKey || touchKick) ? 1 : 0;
  const key = dx + ',' + dy + ',' + s + ',' + k;
  if (key === lastKey) return;
  lastKey = key;
  send({ t: 'in', dx, dy, s, k });
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
  else return;
  pushInput();
});
window.addEventListener('blur', () => { keys.clear(); kickKey = sprintKey = false; pushInput(); });

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
}
document.addEventListener('contextmenu', (e) => e.preventDefault());

show('menu');
})();
