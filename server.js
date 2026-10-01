const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

/* =========================
   AYARLAR
========================= */

const MAX_PLAYERS = 12;
const MAX_TEAM_PLAYERS = 6;

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

/* =========================
   OYUNCULAR
========================= */

const players = new Map();

/* =========================
   TOP
========================= */

const ball = {
    x: 600,
    y: 350,
    vx: 3,
    vy: 0
};

/* =========================
   SKOR
========================= */

let blueScore = 0;
let redScore = 0;

let matchTime = MATCH_TIME;

/* =========================
   TAKIM
========================= */

function getTeam() {

    let blue = 0;
    let red = 0;

    for (const player of players.values()) {

        if (player.team === "blue") {
            blue++;
        } else {
            red++;
        }
    }

    if (blue < red && blue < 6) {
        return "blue";
    }

    if (red < blue && red < 6) {
        return "red";
    }

    if (blue < 6) {
        return "blue";
    }

    if (red < 6) {
        return "red";
    }

    return null;
}

/* =========================
   İSİM
========================= */

function cleanName(name) {

    if (typeof name !== "string") {
        return "Oyuncu";
    }

    name = name
        .replace(/[<>]/g, "")
        .trim();

    if (!name) {
        return "Oyuncu";
    }

    return name.substring(0, 16);
}

/* =========================
   BAŞLANGIÇ POZİSYONU
========================= */

function spawnPosition(team, index) {

    const x =
        team === "blue"
            ? FIELD.x + 180
            : FIELD.x + FIELD.width - 180;

    const direction =
        team === "blue" ? 1 : -1;

    return {
        x:
            x +
            direction *
            (index % 2) *
            55,

        y:
            FIELD.y +
            120 +
            Math.floor(index / 2) *
            105
    };
}

/* =========================
   OYUNCULARI YERLEŞTİR
========================= */

function resetPlayers() {

    let blueIndex = 0;
    let redIndex = 0;

    for (const player of players.values()) {

        let pos;

        if (player.team === "blue") {

            pos =
                spawnPosition(
                    "blue",
                    blueIndex++
                );

        } else {

            pos =
                spawnPosition(
                    "red",
                    redIndex++
                );
        }

        player.x = pos.x;
        player.y = pos.y;

        player.vx = 0;
        player.vy = 0;
    }

    resetBall();
}

/* =========================
   TOP RESET
========================= */

function resetBall() {

    ball.x =
        FIELD.x +
        FIELD.width / 2;

    ball.y =
        FIELD.y +
        FIELD.height / 2;

    ball.vx =
        Math.random() < 0.5
            ? 3
            : -3;

    ball.vy =
        (Math.random() - 0.5) * 2;
}

/* =========================
   MAÇ RESET
========================= */

function resetMatch() {

    blueScore = 0;
    redScore = 0;

    matchTime = MATCH_TIME;

    resetPlayers();
}

/* =========================
   OYUNCU EKLE
========================= */

function addPlayer(ws, name) {

    if (players.size >= MAX_PLAYERS) {

        ws.send(JSON.stringify({
            type: "full"
        }));

        ws.close();

        return;
    }

    const team = getTeam();

    if (!team) {

        ws.send(JSON.stringify({
            type: "full"
        }));

        ws.close();

        return;
    }

    const id =
        Math.random()
            .toString(36)
            .substring(2, 10);

    const player = {

        id: id,

        name: cleanName(name),

        team: team,

        ws: ws,

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
        type: "welcome",
        id: id,
        team: team,
        name: player.name
    }));

    resetPlayers();

    console.log(
        player.name +
        " katıldı - " +
        team +
        " - " +
        players.size +
        "/12"
    );
}

/* =========================
   WEBSOCKET
========================= */

wss.on("connection", ws => {

    ws.on("message", raw => {

        let data;

        try {
            data =
                JSON.parse(
                    raw.toString()
                );
        } catch {
            return;
        }

        if (!ws.playerId) {

            if (
                data.type === "join" &&
                typeof data.name === "string"
            ) {

                addPlayer(
                    ws,
                    data.name
                );
            }

            return;
        }

        const player =
            players.get(
                ws.playerId
            );

        if (!player) {
            return;
        }

        if (data.type === "input") {

            player.keys.up =
                data.up === true;

            player.keys.down =
                data.down === true;

            player.keys.left =
                data.left === true;

            player.keys.right =
                data.right === true;
        }
    });

    ws.on("close", () => {

        if (!ws.playerId) {
            return;
        }

        players.delete(
            ws.playerId
        );

        resetPlayers();
    });
});

/* =========================
   OYUNCU HAREKET
========================= */

function updatePlayer(player) {

    let dx = 0;
    let dy = 0;

    if (player.keys.left) {
        dx--;
    }

    if (player.keys.right) {
        dx++;
    }

    if (player.keys.up) {
        dy--;
    }

    if (player.keys.down) {
        dy++;
    }

    if (dx !== 0 || dy !== 0) {

        const length =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        dx /= length;
        dy /= length;

        player.vx =
            dx * PLAYER_SPEED;

        player.vy =
            dy * PLAYER_SPEED;

    } else {

        player.vx *= 0.72;
        player.vy *= 0.72;
    }

    player.x += player.vx;
    player.y += player.vy;

    const minX =
        FIELD.x +
        PLAYER_RADIUS;

    const maxX =
        FIELD.x +
        FIELD.width -
        PLAYER_RADIUS;

    const minY =
        FIELD.y +
        PLAYER_RADIUS;

    const maxY =
        FIELD.y +
        FIELD.height -
        PLAYER_RADIUS;

    if (player.x < minX) {
        player.x = minX;
        player.vx = 0;
    }

    if (player.x > maxX) {
        player.x = maxX;
        player.vx = 0;
    }

    if (player.y < minY) {
        player.y = minY;
        player.vy = 0;
    }

    if (player.y > maxY) {
        player.y = maxY;
        player.vy = 0;
    }
}

/* =========================
   TOP ÇARPIŞMA
========================= */

function collideBall(player) {

    const dx =
        ball.x - player.x;

    const dy =
        ball.y - player.y;

    const minDistance =
        PLAYER_RADIUS +
        BALL_RADIUS;

    const distanceSquared =
        dx * dx +
        dy * dy;

    if (
        distanceSquared >=
        minDistance *
        minDistance
    ) {
        return;
    }

    const distance =
        Math.sqrt(
            distanceSquared
        ) || 1;

    const nx =
        dx / distance;

    const ny =
        dy / distance;

    ball.x =
        player.x +
        nx * minDistance;

    ball.y =
        player.y +
        ny * minDistance;

    ball.vx +=
        nx * 2.4 +
        player.vx * 0.65;

    ball.vy +=
        ny * 2.4 +
        player.vy * 0.65;

    const speed =
        Math.sqrt(
            ball.vx * ball.vx +
            ball.vy * ball.vy
        );

    if (speed > BALL_MAX_SPEED) {

        ball.vx =
            ball.vx /
            speed *
            BALL_MAX_SPEED;

        ball.vy =
            ball.vy /
            speed *
            BALL_MAX_SPEED;
    }
}

/* =========================
   TOP
========================= */

function updateBall() {

    ball.x += ball.vx;
    ball.y += ball.vy;

    ball.vx *= 0.992;
    ball.vy *= 0.992;

    if (
        ball.y - BALL_RADIUS <
        FIELD.y
    ) {

        ball.y =
            FIELD.y +
            BALL_RADIUS;

        ball.vy *= -0.9;
    }

    if (
        ball.y + BALL_RADIUS >
        FIELD.y +
        FIELD.height
    ) {

        ball.y =
            FIELD.y +
            FIELD.height -
            BALL_RADIUS;

        ball.vy *= -0.9;
    }

    const goalTop =
        FIELD.y +
        FIELD.height / 2 -
        GOAL.height / 2;

    const goalBottom =
        FIELD.y +
        FIELD.height / 2 +
        GOAL.height / 2;

    /* SOL KALE */

    if (
        ball.x - BALL_RADIUS <
        FIELD.x
    ) {

        if (
            ball.y > goalTop &&
            ball.y < goalBottom
        ) {

            redScore++;

            resetPlayers();

            return;
        }

        ball.x =
            FIELD.x +
            BALL_RADIUS;

        ball.vx *= -0.9;
    }

    /* SAĞ KALE */

    if (
        ball.x + BALL_RADIUS >
        FIELD.x +
        FIELD.width
    ) {

        if (
            ball.y > goalTop &&
            ball.y < goalBottom
        ) {

            blueScore++;

            resetPlayers();

            return;
        }

        ball.x =
            FIELD.x +
            FIELD.width -
            BALL_RADIUS;

        ball.vx *= -0.9;
    }
}

/* =========================
   FİZİK
========================= */

function physics() {

    for (const player of players.values()) {
        updatePlayer(player);
    }

    for (const player of players.values()) {
        collideBall(player);
    }

    updateBall();
}

/* =========================
   NETWORK
========================= */

function sendState() {

    if (players.size === 0) {
        return;
    }

    const playerList = [];

    for (const player of players.values()) {

        playerList.push({
            id: player.id,
            name: player.name,
            team: player.team,
            x: Math.round(player.x * 10) / 10,
            y: Math.round(player.y * 10) / 10
        });
    }

    const message =
        JSON.stringify({

            type: "state",

            players: playerList,

            ball: {
                x:
                    Math.round(
                        ball.x * 10
                    ) / 10,

                y:
                    Math.round(
                        ball.y * 10
                    ) / 10
            },

            score: {
                blue: blueScore,
                red: redScore
            },

            matchTime: matchTime,

            maxPlayers: 12,

            field: FIELD,

            goal: GOAL
        });

    for (const player of players.values()) {

        if (
            player.ws.readyState ===
            WebSocket.OPEN
        ) {

            player.ws.send(message);
        }
    }
}

/* =========================
   FİZİK 60 FPS
========================= */

setInterval(
    physics,
    1000 / 60
);

/* =========================
   NETWORK 20 FPS
========================= */

setInterval(
    sendState,
    1000 / 20
);

/* =========================
   SÜRE
========================= */

setInterval(
    () => {

        if (players.size === 0) {
            return;
        }

        matchTime--;

        if (matchTime <= 0) {

            resetMatch();
        }

    },
    1000
);

/* =========================
   SERVER
========================= */

server.listen(
    PORT,
    () => {

        console.log(
            "Mini HaxBall server çalışıyor."
        );

        console.log(
            "Port: " +
            PORT
        );
    }
);
