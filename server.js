const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 12;
const MAX_TEAM_PLAYERS = 6;

const MATCH_TIME = 5 * 60;

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

app.use(express.static("public"));

const players = new Map();

const ball = {
    x: 600,
    y: 350,
    vx: 3,
    vy: 0
};

let blueScore = 0;
let redScore = 0;

let matchTime = MATCH_TIME;
let lastSecond = Date.now();

function createId() {
    return Math.random()
        .toString(36)
        .substring(2, 10);
}

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

/*
 * TAKIM DAĞITIMI
 *
 * Oyuncular mümkün olduğunca dengeli
 * şekilde dağıtılır.
 */

function getTeam() {

    let blue = 0;
    let red = 0;

    for (const player of players.values()) {

        if (player.team === "blue") {
            blue++;
        }

        if (player.team === "red") {
            red++;
        }
    }

    /*
     * Önce küçük olan takıma oyuncu ver.
     */

    if (blue <= red && blue < MAX_TEAM_PLAYERS) {
        return "blue";
    }

    if (red < MAX_TEAM_PLAYERS) {
        return "red";
    }

    if (blue < MAX_TEAM_PLAYERS) {
        return "blue";
    }

    return null;
}

function getTeamPlayers(team) {

    return [...players.values()]
        .filter(player => player.team === team);
}

function spawnPosition(team, index) {

    const startX =
        team === "blue"
            ? FIELD.x + 180
            : FIELD.x + FIELD.width - 180;

    const direction =
        team === "blue"
            ? 1
            : -1;

    const column = index % 2;
    const row = Math.floor(index / 2);

    return {
        x: startX + direction * column * 55,
        y: FIELD.y + 125 + row * 105
    };
}

function resetBall() {

    ball.x =
        FIELD.x +
        FIELD.width / 2;

    ball.y =
        FIELD.y +
        FIELD.height / 2;

    ball.vx =
        Math.random() > 0.5
            ? 3
            : -3;

    ball.vy =
        (Math.random() - 0.5) * 3;
}

function resetPlayers() {

    const bluePlayers =
        getTeamPlayers("blue");

    const redPlayers =
        getTeamPlayers("red");

    bluePlayers.forEach((player, index) => {

        const pos =
            spawnPosition(
                "blue",
                index
            );

        player.x = pos.x;
        player.y = pos.y;

        player.vx = 0;
        player.vy = 0;
    });

    redPlayers.forEach((player, index) => {

        const pos =
            spawnPosition(
                "red",
                index
            );

        player.x = pos.x;
        player.y = pos.y;

        player.vx = 0;
        player.vy = 0;
    });

    resetBall();
}

function resetMatch() {

    blueScore = 0;
    redScore = 0;

    matchTime = MATCH_TIME;

    lastSecond = Date.now();

    resetPlayers();

    console.log("Yeni maç başladı.");
}

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

    const id = createId();

    const player = {

        id,

        name: cleanName(name),

        team,

        ws,

        x: 0,
        y: 0,

        vx: 0,
        vy: 0,

        radius: PLAYER_RADIUS,

        speed: PLAYER_SPEED,

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
        `${player.name} katıldı - ${team} - ${players.size}/${MAX_PLAYERS}`
    );
}

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
            players.get(ws.playerId);

        if (!player) {
            return;
        }

        if (data.type === "input") {

            player.keys.up =
                !!data.up;

            player.keys.down =
                !!data.down;

            player.keys.left =
                !!data.left;

            player.keys.right =
                !!data.right;
        }
    });

    ws.on("close", () => {

        if (!ws.playerId) {
            return;
        }

        const player =
            players.get(ws.playerId);

        if (player) {

            console.log(
                `${player.name} ayrıldı.`
            );

            players.delete(
                ws.playerId
            );
        }

        /*
         * Oyuncular ayrıldığında
         * pozisyonları tekrar düzenle.
         */

        resetPlayers();
    });
});

function movePlayer(player) {

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
            Math.hypot(dx, dy);

        dx /= length;
        dy /= length;

        player.vx =
            dx * player.speed;

        player.vy =
            dy * player.speed;

    } else {

        player.vx *= 0.72;
        player.vy *= 0.72;
    }

    player.x += player.vx;
    player.y += player.vy;

    player.x =
        Math.max(
            FIELD.x + player.radius,
            Math.min(
                FIELD.x +
                    FIELD.width -
                    player.radius,
                player.x
            )
        );

    player.y =
        Math.max(
            FIELD.y + player.radius,
            Math.min(
                FIELD.y +
                    FIELD.height -
                    player.radius,
                player.y
            )
        );
}

function collidePlayerBall(player) {

    const dx =
        ball.x - player.x;

    const dy =
        ball.y - player.y;

    const distance =
        Math.hypot(dx, dy);

    const minimum =
        player.radius +
        BALL_RADIUS;

    if (distance >= minimum) {
        return;
    }

    const nx =
        dx / (distance || 1);

    const ny =
        dy / (distance || 1);

    ball.x =
        player.x +
        nx * minimum;

    ball.y =
        player.y +
        ny * minimum;

    ball.vx +=
        nx * 2.4 +
        player.vx * 0.65;

    ball.vy +=
        ny * 2.4 +
        player.vy * 0.65;

    const speed =
        Math.hypot(
            ball.vx,
            ball.vy
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

function updateBall() {

    ball.x += ball.vx;
    ball.y += ball.vy;

    ball.vx *= 0.992;
    ball.vy *= 0.992;

    if (
        ball.y - BALL_RADIUS <=
        FIELD.y
    ) {

        ball.y =
            FIELD.y +
            BALL_RADIUS;

        ball.vy *= -0.9;
    }

    if (
        ball.y + BALL_RADIUS >=
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

    if (
        ball.x - BALL_RADIUS <=
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

    if (
        ball.x + BALL_RADIUS >=
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

function updateTimer() {

    const now =
        Date.now();

    if (
        now -
        lastSecond >=
        1000
    ) {

        const secondsPassed =
            Math.floor(
                (
                    now -
                    lastSecond
                ) / 1000
            );

        matchTime -=
            secondsPassed;

        lastSecond =
            now;

        if (matchTime <= 0) {

            matchTime = 0;

            /*
             * 5 dakika doldu.
             * Skoru ve pozisyonları sıfırla.
             */

            resetMatch();
        }
    }
}

function updateGame() {

    updateTimer();

    for (
        const player
        of players.values()
    ) {

        movePlayer(player);
    }

    for (
        const player
        of players.values()
    ) {

        collidePlayerBall(player);
    }

    updateBall();
}

function broadcast() {

    const playerData =
        [...players.values()]
            .map(player => ({

                id: player.id,

                name: player.name,

                team: player.team,

                x: player.x,

                y: player.y
            }));

    const message =
        JSON.stringify({

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

            matchTime: matchTime,

            maxPlayers: MAX_PLAYERS,

            field: FIELD,

            goal: GOAL
        });

    for (
        const player
        of players.values()
    ) {

        if (
            player.ws.readyState ===
            WebSocket.OPEN
        ) {

            player.ws.send(
                message
            );
        }
    }
}

setInterval(() => {

    updateGame();

    broadcast();

}, 1000 / 60);

server.listen(
    PORT,
    () => {

        console.log(
            `Mini HaxBall server ${PORT} portunda çalışıyor.`
        );
    }
);
