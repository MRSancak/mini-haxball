
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: false });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 12;
const MAX_TEAM_PLAYERS = 6;
const MATCH_TIME = 300;
const TICK_RATE = 1000 / 60;

const FIELD = { x: 40, y: 40, width: 1120, height: 620 };
const GOAL = { width: 35, height: 210 };
const PLAYER_RADIUS = 17;
const PLAYER_SPEED = 4.7;
const BALL_RADIUS = 14;
const BALL_MAX_SPEED = 15;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
    try {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
        return data && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
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
let matchTime = MATCH_TIME;
let lastSecond = Date.now();

const ball = {
    x: FIELD.x + FIELD.width / 2,
    y: FIELD.y + FIELD.height / 2,
    vx: 3,
    vy: 0
};

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function saveUsers() {
    const temp = USERS_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(users, null, 2), {
        mode: 0o600
    });
    fs.renameSync(temp, USERS_FILE);
}

function normalizeUsername(value) {
    return typeof value === "string" ? value.trim() : "";
}

function validUsername(name) {
    return /^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ-]{3,16}$/.test(name);
}

function validPassword(password) {
    return typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return { salt, hash };
}

function passwordMatches(password, user) {
    try {
        const candidate = crypto.scryptSync(password, user.salt, 64);
        const actual = Buffer.from(user.hash, "hex");
        return actual.length === candidate.length &&
            crypto.timingSafeEqual(candidate, actual);
    } catch {
        return false;
    }
}

function getClientKey(req) {
    return req.ip || "unknown";
}

function rateLimited(req) {
    const key = getClientKey(req);
    const now = Date.now();
    let item = loginAttempts.get(key);

    if (!item || now - item.started > 60_000) {
        item = { started: now, count: 0 };
    }

    item.count++;
    loginAttempts.set(key, item);
    return item.count > 20;
}

function issueSession(username) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, {
        username,
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    return token;
}

function getSession(token) {
    if (typeof token !== "string") return null;
    const session = sessions.get(token);
    if (!session) return null;

    if (session.expires <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

app.post("/api/register", (req, res) => {
    if (rateLimited(req)) {
        return res.status(429).json({
            error: "Çok fazla istek gönderdin. Bir dakika sonra tekrar dene."
        });
    }

    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;

    if (!validUsername(username)) {
        return res.status(400).json({
            error: "Kullanıcı adı 3-16 karakter olmalı; harf, rakam, _ ve - kullanılabilir."
        });
    }

    if (!validPassword(password)) {
        return res.status(400).json({
            error: "Şifre 8-128 karakter arasında olmalı."
        });
    }

    const key = username.toLocaleLowerCase("tr-TR");

    if (users[key]) {
        return res.status(409).json({
            error: "Bu kullanıcı adı zaten alınmış."
        });
    }

    const credentials = hashPassword(password);

    users[key] = {
        username,
        salt: credentials.salt,
        hash: credentials.hash,
        createdAt: new Date().toISOString()
    };

    try {
        saveUsers();
    } catch (error) {
        delete users[key];
        console.error("Hesap kaydedilemedi:", error);
        return res.status(500).json({
            error: "Hesap kaydedilemedi. Sunucu depolamasını kontrol et."
        });
    }

    const token = issueSession(key);

    res.status(201).json({
        token,
        username
    });
});

app.post("/api/login", (req, res) => {
    if (rateLimited(req)) {
        return res.status(429).json({
            error: "Çok fazla giriş denemesi. Bir dakika sonra tekrar dene."
        });
    }

    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;

    if (!username || typeof password !== "string") {
        return res.status(400).json({
            error: "Kullanıcı adı ve şifre gerekli."
        });
    }

    const key = username.toLocaleLowerCase("tr-TR");
    const user = users[key];

    if (!user || !passwordMatches(password, user)) {
        return res.status(401).json({
            error: "Kullanıcı adı veya şifre hatalı."
        });
    }

    const token = issueSession(key);

    res.json({
        token,
        username: user.username
    });
});

app.post("/api/logout", (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    sessions.delete(token);
    res.json({ ok: true });
});

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function cleanName(name) {
    if (typeof name !== "string") return "Oyuncu";
    return name.replace(/[<>]/g, "").trim().slice(0, 16) || "Oyuncu";
}

function getTeam() {
    let blue = 0;
    let red = 0;

    for (const player of players.values()) {
        if (player.team === "blue") blue++;
        else red++;
    }

    if (blue <= red && blue < MAX_TEAM_PLAYERS) return "blue";
    if (red < blue && red < MAX_TEAM_PLAYERS) return "red";
    if (blue < MAX_TEAM_PLAYERS) return "blue";
    if (red < MAX_TEAM_PLAYERS) return "red";

    return null;
}

function spawnPosition(team, index) {
    const x = team === "blue"
        ? FIELD.x + 180
        : FIELD.x + FIELD.width - 180;

    const direction = team === "blue" ? 1 : -1;

    return {
        x: x + direction * (index % 2) * 55,
        y: FIELD.y + 100 + index * 82
    };
}

function resetBall() {
    ball.x = FIELD.x + FIELD.width / 2;
    ball.y = FIELD.y + FIELD.height / 2;
    ball.vx = Math.random() < 0.5 ? 3 : -3;
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
    matchTime = MATCH_TIME;
    resetPlayers();
}

function addPlayer(ws, data) {
    if (players.size >= MAX_PLAYERS) {
        send(ws, { type: "full", message: "Sunucu dolu." });
        ws.close();
        return;
    }

    const session = getSession(data.token);
    if (!session) {
        send(ws, { type: "auth_error", message: "Önce giriş yapmalısın." });
        ws.close();
        return;
    }

    const user = users[session.username];
    if (!user) {
        send(ws, { type: "auth_error", message: "Hesap bulunamadı." });
        ws.close();
        return;
    }

    // Aynı hesabın birden fazla kez bağlanmasını engelle.
    for (const player of players.values()) {
        if (player.username === session.username) {
            send(ws, { type: "auth_error", message: "Bu hesap zaten oyunda." });
            ws.close();
            return;
        }
    }

    const team = getTeam();
    if (!team) {
        send(ws, { type: "full" });
        ws.close();
        return;
    }

    const id = crypto.randomBytes(8).toString("hex");
    const pos = spawnPosition(team, [...players.values()]
        .filter(p => p.team === team).length);

    const player = {
        id,
        username: session.username,
        name: cleanName(user.username),
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
            if (data.type === "join") addPlayer(ws, data);
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
    const minDistance = PLAYER_RADIUS + BALL_RADIUS;
    const distance = Math.hypot(dx, dy);

    if (distance >= minDistance) return;

    const nx = distance ? dx / distance : 1;
    const ny = distance ? dy / distance : 0;

    ball.x = player.x + nx * minDistance;
    ball.y = player.y + ny * minDistance;
    ball.vx += nx * 2.4 + player.vx * 0.65;
    ball.vy += ny * 2.4 + player.vy * 0.65;

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
        ball.vy = Math.abs(ball.vy) * 0.9;
    }

    if (ball.y + BALL_RADIUS > FIELD.y + FIELD.height) {
        ball.y = FIELD.y + FIELD.height - BALL_RADIUS;
        ball.vy = -Math.abs(ball.vy) * 0.9;
    }

    const goalTop = FIELD.y + FIELD.height / 2 - GOAL.height / 2;
    const goalBottom = goalTop + GOAL.height;

    if (ball.x - BALL_RADIUS < FIELD.x) {
        if (ball.y >= goalTop && ball.y <= goalBottom) {
            redScore++;
            resetPlayers();
            return;
        }
        ball.x = FIELD.x + BALL_RADIUS;
        ball.vx = Math.abs(ball.vx) * 0.9;
    }

    if (ball.x + BALL_RADIUS > FIELD.x + FIELD.width) {
        if (ball.y >= goalTop && ball.y <= goalBottom) {
            blueScore++;
            resetPlayers();
            return;
        }
        ball.x = FIELD.x + FIELD.width - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx) * 0.9;
    }
}

function physics() {
    for (const player of players.values()) updatePlayer(player);
    for (const player of players.values()) collideBall(player);
    updateBall();
}

function sendState() {
    if (!players.size) return;

    const playerList = [...players.values()].map(player => ({
        id: player.id,
        name: player.name,
        team: player.team,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10
    }));

    const message = JSON.stringify({
        type: "state",
        players: playerList,
        ball: { x: ball.x, y: ball.y },
        score: { blue: blueScore, red: redScore },
        matchTime,
        maxPlayers: MAX_PLAYERS,
        field: FIELD,
        goal: GOAL
    });

    for (const player of players.values()) send(player.ws, JSON.parse(message));
}

setInterval(physics, TICK_RATE);
setInterval(sendState, 1000 / 20);

setInterval(() => {
    if (!players.size) {
        lastSecond = Date.now();
        return;
    }

    const now = Date.now();
    const elapsed = Math.floor((now - lastSecond) / 1000);

    if (elapsed > 0) {
        matchTime -= elapsed;
        lastSecond += elapsed * 1000;

        if (matchTime <= 0) resetMatch();
    }
}, 250);

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (session.expires <= now) sessions.delete(token);
    }

    for (const [ip, item] of loginAttempts) {
        if (now - item.started > 120_000) loginAttempts.delete(ip);
    }
}, 60_000);

server.listen(PORT, () => {
    console.log(`Mini HaxBall çalışıyor: ${PORT}`);
});
