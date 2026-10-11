
"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    maxPayload: 4096,
    perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 12;
const MAX_PER_TEAM = 6;
const DEFAULT_MATCH_SECONDS = 300;
const TICK = 1000 / 60;
const STATE_RATE = 1000 / 30;

const FIELD = { x: 40, y: 40, width: 1120, height: 620 };
const PLAYER_RADIUS = 17;
const PLAYER_SPEED = 4.6;
const BALL_RADIUS = 13;
const BALL_MAX_SPEED = 15;
const GOAL = { width: 35, height: 210 };

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function loadUsers() {
    try {
        const value = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
        return value && typeof value === "object" && !Array.isArray(value)
            ? value : {};
    } catch {
        return {};
    }
}

let users = loadUsers();
const sessions = new Map();
const loginAttempts = new Map();
const players = new Map();

let blueScore = 0;
let redScore = 0;
let matchTime = DEFAULT_MATCH_SECONDS;
let lastClockUpdate = Date.now();

const ball = {
    x: FIELD.x + FIELD.width / 2,
    y: FIELD.y + FIELD.height / 2,
    vx: 2.8,
    vy: 1.2
};

function saveUsers() {
    const temp = USERS_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(users, null, 2), {
        encoding: "utf8",
        mode: 0o600
    });
    fs.renameSync(temp, USERS_FILE);
}

function defaultProfile(username) {
    return {
        displayName: username,
        jerseyNumber: 10,
        jerseyColor: "#299cff"
    };
}

function normalizeUsername(value) {
    return typeof value === "string" ? value.trim() : "";
}

function userKey(username) {
    return username.toLocaleLowerCase("tr-TR");
}

function validUsername(username) {
    return /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ-]{3,16}$/.test(username);
}

function validPassword(password) {
    return typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128;
}

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
    return {
        salt,
        hash: crypto.scryptSync(password, salt, 64).toString("hex")
    };
}

function checkPassword(password, account) {
    try {
        const actual = Buffer.from(account.hash, "hex");
        const expected = crypto.scryptSync(password, account.salt, 64);
        return actual.length === expected.length &&
            crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function allowRequest(req) {
    const key = req.ip || "unknown";
    const now = Date.now();
    let record = loginAttempts.get(key);

    if (!record || now - record.started > 60_000) {
        record = { started: now, count: 0 };
    }

    record.count++;
    loginAttempts.set(key, record);
    return record.count <= 20;
}

function createSession(key) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, {
        key,
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    return token;
}

function findSession(token) {
    if (typeof token !== "string" || token.length > 256) return null;

    const session = sessions.get(token);
    if (!session) return null;

    if (session.expires <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function authenticatedUser(req) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const session = findSession(token);

    if (!session) return null;

    const user = users[session.key];
    if (!user) return null;

    if (!user.profile) {
        user.profile = defaultProfile(user.username);
    }

    return { key: session.key, user };
}

function publicProfile(user) {
    return {
        displayName: user.profile.displayName,
        jerseyNumber: user.profile.jerseyNumber,
        jerseyColor: user.profile.jerseyColor
    };
}

app.get("/api/health", (req, res) => {
    res.json({
        online: true,
        players: players.size,
        capacity: MAX_PLAYERS
    });
});

app.post("/api/register", (req, res) => {
    if (!allowRequest(req)) {
        return res.status(429).json({ error: "Çok fazla istek. Biraz bekle." });
    }

    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;

    if (!validUsername(username)) {
        return res.status(400).json({
            error: "Kullanıcı adı 3-16 karakter olmalı."
        });
    }

    if (!validPassword(password)) {
        return res.status(400).json({
            error: "Şifre 8-128 karakter arasında olmalı."
        });
    }

    const key = userKey(username);

    if (users[key]) {
        return res.status(409).json({
            error: "Bu kullanıcı adı zaten kullanılıyor."
        });
    }

    const credentials = makePasswordHash(password);

    users[key] = {
        username,
        salt: credentials.salt,
        hash: credentials.hash,
        profile: defaultProfile(username),
        createdAt: new Date().toISOString()
    };

    try {
        saveUsers();
    } catch (error) {
        delete users[key];
        console.error("Hesap kayıt hatası:", error);
        return res.status(500).json({
            error: "Hesap kaydedilemedi. Sunucu depolamasını kontrol et."
        });
    }

    const token = createSession(key);

    res.status(201).json({
        token,
        username,
        profile: publicProfile(users[key])
    });
});

app.post("/api/login", (req, res) => {
    if (!allowRequest(req)) {
        return res.status(429).json({
            error: "Çok fazla giriş denemesi. Biraz bekle."
        });
    }

    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;

    if (!username || typeof password !== "string") {
        return res.status(400).json({
            error: "Kullanıcı adı ve şifre gerekli."
        });
    }

    const key = userKey(username);
    const user = users[key];

    if (!user || !checkPassword(password, user)) {
        return res.status(401).json({
            error: "Kullanıcı adı veya şifre hatalı."
        });
    }

    if (!user.profile) user.profile = defaultProfile(user.username);

    const token = createSession(key);

    res.json({
        token,
        username: user.username,
        profile: publicProfile(user)
    });
});

app.get("/api/profile", (req, res) => {
    const auth = authenticatedUser(req);

    if (!auth) {
        return res.status(401).json({ error: "Tekrar giriş yapmalısın." });
    }

    res.json({
        username: auth.user.username,
        profile: publicProfile(auth.user)
    });
});

app.put("/api/profile", (req, res) => {
    const auth = authenticatedUser(req);

    if (!auth) {
        return res.status(401).json({ error: "Oturum süresi dolmuş." });
    }

    const displayName = typeof req.body?.displayName === "string"
        ? req.body.displayName.trim()
        : "";

    const jerseyNumber = Number(req.body?.jerseyNumber);
    const jerseyColor = req.body?.jerseyColor;

    if (!/^[\p{L}\p{N}_ -]{2,16}$/u.test(displayName)) {
        return res.status(400).json({
            error: "Sahadaki isim 2-16 karakter olmalı."
        });
    }

    if (!Number.isInteger(jerseyNumber) ||
        jerseyNumber < 1 || jerseyNumber > 99) {
        return res.status(400).json({
            error: "Forma numarası 1-99 arasında olmalı."
        });
    }

    if (typeof jerseyColor !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(jerseyColor)) {
        return res.status(400).json({
            error: "Geçersiz forma rengi."
        });
    }

    const previous = auth.user.profile;

    auth.user.profile = {
        displayName,
        jerseyNumber,
        jerseyColor
    };

    try {
        saveUsers();
    } catch (error) {
        auth.user.profile = previous;
        console.error("Profil kayıt hatası:", error);
        return res.status(500).json({
            error: "Profil kaydedilemedi."
        });
    }

    for (const player of players.values()) {
        if (player.username === auth.key) {
            player.name = displayName;
            player.jerseyNumber = jerseyNumber;
            player.jerseyColor = jerseyColor;
        }
    }

    res.json({
        ok: true,
        profile: publicProfile(auth.user)
    });
});

app.post("/api/logout", (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    sessions.delete(token);
    res.json({ ok: true });
});

function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function teamCounts() {
    let blue = 0;
    let red = 0;

    for (const player of players.values()) {
        if (player.team === "blue") blue++;
        else red++;
    }

    return { blue, red };
}

function chooseTeam() {
    const counts = teamCounts();

    if (counts.blue < counts.red && counts.blue < MAX_PER_TEAM) return "blue";
    if (counts.red < counts.blue && counts.red < MAX_PER_TEAM) return "red";
    if (counts.blue < MAX_PER_TEAM) return "blue";
    if (counts.red < MAX_PER_TEAM) return "red";

    return null;
}

function spawnPosition(team, index) {
    const x = team === "blue"
        ? FIELD.x + 180
        : FIELD.x + FIELD.width - 180;

    const direction = team === "blue" ? 1 : -1;

    return {
        x: x + direction * (index % 2) * 48,
        y: FIELD.y + 90 + (index % 6) * 88
    };
}

function resetBall() {
    ball.x = FIELD.x + FIELD.width / 2;
    ball.y = FIELD.y + FIELD.height / 2;
    ball.vx = Math.random() < 0.5 ? 2.8 : -2.8;
    ball.vy = (Math.random() - 0.5) * 2;
}

function resetPlayers() {
    let blueIndex = 0;
    let redIndex = 0;

    for (const player of players.values()) {
        const pos = player.team === "blue"
            ? spawnPosition("blue", blueIndex++)
            : spawnPosition("red", redIndex++);

        player.x = pos.x;
        player.y = pos.y;
        player.vx = 0;
        player.vy = 0;
        player.keys = { up: false, down: false, left: false, right: false };
    }

    resetBall();
}

function resetMatch() {
    blueScore = 0;
    redScore = 0;
    matchTime = DEFAULT_MATCH_SECONDS;
    lastClockUpdate = Date.now();
    resetPlayers();
}

function addPlayer(ws, data) {
    const session = findSession(data.token);

    if (!session) {
        send(ws, { type: "auth_error", message: "Giriş yapmalısın." });
        ws.close();
        return;
    }

    if (players.size >= MAX_PLAYERS) {
        send(ws, { type: "full", message: "Sunucu dolu." });
        ws.close();
        return;
    }

    const user = users[session.key];
    if (!user) {
        send(ws, { type: "auth_error", message: "Hesap bulunamadı." });
        ws.close();
        return;
    }

    for (const player of players.values()) {
        if (player.username === session.key) {
            send(ws, {
                type: "auth_error",
                message: "Bu hesap zaten oyunda."
            });
            ws.close();
            return;
        }
    }

    const team = chooseTeam();
    if (!team) {
        send(ws, { type: "full", message: "İki takım da dolu." });
        ws.close();
        return;
    }

    const count = [...players.values()].filter(p => p.team === team).length;
    const pos = spawnPosition(team, count);
    const profile = user.profile || defaultProfile(user.username);
    const id = crypto.randomBytes(8).toString("hex");

    const player = {
        id,
        username: session.key,
        name: profile.displayName,
        jerseyNumber: profile.jerseyNumber,
        jerseyColor: profile.jerseyColor,
        team,
        ws,
        x: pos.x,
        y: pos.y,
        vx: 0,
        vy: 0,
        keys: { up: false, down: false, left: false, right: false }
    };

    players.set(id, player);
    ws.playerId = id;

    send(ws, {
        type: "welcome",
        id,
        team,
        name: player.name
    });

    resetPlayers();

    console.log(`${player.name} oyuna katıldı (${players.size}/${MAX_PLAYERS})`);
}

wss.on("connection", ws => {
    ws.on("message", raw => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (!ws.playerId) {
            if (data.type === "join" && typeof data.token === "string") {
                addPlayer(ws, data);
            }
            return;
        }

        const player = players.get(ws.playerId);
        if (!player) return;

        if (data.type === "input") {
            player.keys.up = data.up === true;
            player.keys.down = data.down === true;
            player.keys.left = data.left === true;
            player.keys.right = data.right === true;
        }
    });

    ws.on("close", () => {
        if (!ws.playerId) return;

        players.delete(ws.playerId);
        resetPlayers();

        if (players.size === 0) {
            lastClockUpdate = Date.now();
        }
    });

    ws.on("error", error => {
        console.error("WebSocket hatası:", error.message);
    });
});

function updatePlayer(player) {
    let dx = Number(player.keys.right) - Number(player.keys.left);
    let dy = Number(player.keys.down) - Number(player.keys.up);

    if (dx || dy) {
        const length = Math.hypot(dx, dy);
        dx /= length;
        dy /= length;
        player.vx = dx * PLAYER_SPEED;
        player.vy = dy * PLAYER_SPEED;
    } else {
        player.vx *= 0.72;
        player.vy *= 0.72;
    }

    player.x += player.vx;
    player.y += player.vy;

    player.x = Math.max(FIELD.x + PLAYER_RADIUS,
        Math.min(FIELD.x + FIELD.width - PLAYER_RADIUS, player.x));

    player.y = Math.max(FIELD.y + PLAYER_RADIUS,
        Math.min(FIELD.y + FIELD.height - PLAYER_RADIUS, player.y));
}

function collideBall(player) {
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = PLAYER_RADIUS + BALL_RADIUS;

    if (distance >= minDistance) return;

    const nx = distance ? dx / distance : 1;
    const ny = distance ? dy / distance : 0;

    ball.x = player.x + nx * minDistance;
    ball.y = player.y + ny * minDistance;

    ball.vx += nx * 2.3 + player.vx * 0.65;
    ball.vy += ny * 2.3 + player.vy * 0.65;

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

    const top = FIELD.y;
    const bottom = FIELD.y + FIELD.height;
    const left = FIELD.x;
    const right = FIELD.x + FIELD.width;
    const goalTop = FIELD.y + FIELD.height / 2 - GOAL.height / 2;
    const goalBottom = goalTop + GOAL.height;

    if (ball.y - BALL_RADIUS < top) {
        ball.y = top + BALL_RADIUS;
        ball.vy = Math.abs(ball.vy) * 0.9;
    }

    if (ball.y + BALL_RADIUS > bottom) {
        ball.y = bottom - BALL_RADIUS;
        ball.vy = -Math.abs(ball.vy) * 0.9;
    }

    if (ball.x - BALL_RADIUS < left) {
        if (ball.y >= goalTop && ball.y <= goalBottom) {
            redScore++;
            resetPlayers();
            return;
        }

        ball.x = left + BALL_RADIUS;
        ball.vx = Math.abs(ball.vx) * 0.9;
    }

    if (ball.x + BALL_RADIUS > right) {
        if (ball.y >= goalTop && ball.y <= goalBottom) {
            blueScore++;
            resetPlayers();
            return;
        }

        ball.x = right - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx) * 0.9;
    }
}

function physics() {
    for (const player of players.values()) updatePlayer(player);
    for (const player of players.values()) collideBall(player);
    updateBall();
}

function sendState() {
    if (players.size === 0) return;

    const playerList = [...players.values()].map(player => ({
        id: player.id,
        name: player.name,
        team: player.team,
        jerseyNumber: player.jerseyNumber,
        jerseyColor: player.jerseyColor,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10
    }));

    const message = {
        type: "state",
        players: playerList,
        ball: { x: ball.x, y: ball.y },
        score: { blue: blueScore, red: redScore },
        matchTime,
        maxPlayers: MAX_PLAYERS,
        field: FIELD,
        goal: GOAL
    };

    for (const player of players.values()) send(player.ws, message);
}

setInterval(physics, TICK);
setInterval(sendState, STATE_RATE);

setInterval(() => {
    if (players.size === 0) {
        lastClockUpdate = Date.now();
        return;
    }

    const now = Date.now();
    const elapsed = Math.floor((now - lastClockUpdate) / 1000);

    if (elapsed > 0) {
        matchTime -= elapsed;
        lastClockUpdate += elapsed * 1000;

        if (matchTime <= 0) {
            resetMatch();
        }
    }
}, 250);

setInterval(() => {
    const now = Date.now();

    for (const [token, session] of sessions) {
        if (session.expires <= now) sessions.delete(token);
    }

    for (const [key, record] of loginAttempts) {
        if (now - record.started > 120_000) loginAttempts.delete(key);
    }
}, 60_000);

server.listen(PORT, () => {
    console.log(`Mini HaxBall çalışıyor: http://localhost:${PORT}`);
});
