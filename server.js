const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;

app.use(express.static("public"));

const players = new Map();

const FIELD = {
    x: 50,
    y: 50,
    width: 1000,
    height: 550
};

const GOAL = {
    width: 30,
    height: 180
};

const ball = {
    x: 550,
    y: 325,
    radius: 15,
    vx: 3,
    vy: 0
};

let blueScore = 0;
let redScore = 0;

function randomId() {
    return Math.random().toString(36).substring(2, 10);
}

function resetBall() {
    ball.x = 550;
    ball.y = 325;
    ball.vx = Math.random() > 0.5 ? 3 : -3;
    ball.vy = (Math.random() - 0.5) * 2;
}

function resetPlayers() {
    let blueIndex = 0;
    let redIndex = 0;

    for (const player of players.values()) {
        if (player.team === "blue") {
            player.x = 250 + (blueIndex % 2) * 55;
            player.y = 230 + Math.floor(blueIndex / 2) * 65;
            blueIndex++;
        } else {
            player.x = 850 - (redIndex % 2) * 55;
            player.y = 230 + Math.floor(redIndex / 2) * 65;
            redIndex++;
        }

        player.vx = 0;
        player.vy = 0;
    }

    resetBall();
}

function addPlayer(ws) {

    if (players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({
            type: "full"
        }));

        ws.close();
        return;
    }

    const blueCount = [...players.values()]
        .filter(p => p.team === "blue")
        .length;

    const redCount = [...players.values()]
        .filter(p => p.team === "red")
        .length;

    const team = blueCount <= redCount ? "blue" : "red";

    const id = randomId();

    const player = {
        id,
        ws,
        team,
        x: team === "blue" ? 250 : 850,
        y: 325,
        vx: 0,
        vy: 0,
        radius: 20,
        speed: 4.5,
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
        id,
        team
    }));

    console.log(
        `Oyuncu katıldı: ${id} (${team}) - ${players.size}/${MAX_PLAYERS}`
    );

    resetPlayers();
}

wss.on("connection", ws => {

    addPlayer(ws);

    ws.on("message", message => {

        let data;

        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        const player = players.get(ws.playerId);

        if (!player) return;

        if (data.type === "input") {

            player.keys = {
                up: !!data.up,
                down: !!data.down,
                left: !!data.left,
                right: !!data.right
            };
        }

        if (data.type === "reset") {

            blueScore = 0;
            redScore = 0;
            resetPlayers();
        }
    });

    ws.on("close", () => {

        if (ws.playerId) {
            players.delete(ws.playerId);

            console.log(
                `Oyuncu ayrıldı. ${players.size}/${MAX_PLAYERS}`
            );

            resetPlayers();
        }
    });
});

function movePlayer(player) {

    let dx = 0;
    let dy = 0;

    if (player.keys.left) dx--;
    if (player.keys.right) dx++;
    if (player.keys.up) dy--;
    if (player.keys.down) dy++;

    if (dx !== 0 || dy !== 0) {

        const length = Math.hypot(dx, dy);

        dx /= length;
        dy /= length;

        player.vx = dx * player.speed;
        player.vy = dy * player.speed;

    } else {

        player.vx *= 0.72;
        player.vy *= 0.72;
    }

    player.x += player.vx;
    player.y += player.vy;

    player.x = Math.max(
        FIELD.x + player.radius,
        Math.min(
            FIELD.x + FIELD.width - player.radius,
            player.x
        )
    );

    player.y = Math.max(
        FIELD.y + player.radius,
        Math.min(
            FIELD.y + FIELD.height - player.radius,
            player.y
        )
    );
}

function collidePlayerBall(player) {

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;

    const distance = Math.hypot(dx, dy);
    const minimum =
        player.radius + ball.radius;

    if (distance >= minimum) return;

    const nx = dx / (distance || 1);
    const ny = dy / (distance || 1);

    ball.x =
        player.x +
        nx * minimum;

    ball.y =
        player.y +
        ny * minimum;

    ball.vx +=
        nx * 2.3 +
        player.vx * 0.65;

    ball.vy +=
        ny * 2.3 +
        player.vy * 0.65;

    const speed =
        Math.hypot(ball.vx, ball.vy);

    const maxSpeed = 14;

    if (speed > maxSpeed) {

        ball.vx =
            ball.vx / speed * maxSpeed;

        ball.vy =
            ball.vy / speed * maxSpeed;
    }
}

function updateBall() {

    ball.x += ball.vx;
    ball.y += ball.vy;

    ball.vx *= 0.992;
    ball.vy *= 0.992;

    if (
        ball.y - ball.radius <= FIELD.y
    ) {

        ball.y =
            FIELD.y + ball.radius;

        ball.vy *= -0.9;
    }

    if (
        ball.y + ball.radius >=
        FIELD.y + FIELD.height
    ) {

        ball.y =
            FIELD.y +
            FIELD.height -
            ball.radius;

        ball.vy *= -0.9;
    }

    const goalTop =
        325 - GOAL.height / 2;

    const goalBottom =
        325 + GOAL.height / 2;

    if (
        ball.x - ball.radius <=
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
            FIELD.x + ball.radius;

        ball.vx *= -0.9;
    }

    if (
        ball.x + ball.radius >=
        FIELD.x + FIELD.width
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
            ball.radius;

        ball.vx *= -0.9;
    }
}

function gameUpdate() {

    for (const player of players.values()) {
        movePlayer(player);
    }

    for (const player of players.values()) {
        collidePlayerBall(player);
    }

    updateBall();
}

function broadcast() {

    const playerData = [];

    for (const player of players.values()) {

        playerData.push({
            id: player.id,
            team: player.team,
            x: player.x,
            y: player.y
        });
    }

    const data = JSON.stringify({
        type: "state",

        players: playerData,

        ball: {
            x: ball.x,
            y: ball.y
        },

        score: {
            blue: blueScore,
            red: redScore
        },

        maxPlayers: MAX_PLAYERS
    });

    for (const player of players.values()) {

        if (
            player.ws.readyState ===
            WebSocket.OPEN
        ) {
            player.ws.send(data);
        }
    }
}

setInterval(() => {

    gameUpdate();

    broadcast();

}, 1000 / 60);

server.listen(PORT, () => {

    console.log(
        `Mini HaxBall çalışıyor: http://localhost:${PORT}`
    );
});
