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

/* =========================================================
   AYARLAR
========================================================= */

const MAX_PLAYERS = 12;

const MAX_TEAM_PLAYERS = 6;

const MATCH_TIME = 5 * 60;

const PHYSICS_FPS = 60;

const NETWORK_FPS = 30;

const PHYSICS_INTERVAL =
    1000 / PHYSICS_FPS;

const NETWORK_INTERVAL =
    1000 / NETWORK_FPS;

/* =========================================================
   SAHA
========================================================= */

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

/* =========================================================
   OYUNCULAR
========================================================= */

const players = new Map();

/* =========================================================
   TOP
========================================================= */

const ball = {

    x:
        FIELD.x +
        FIELD.width / 2,

    y:
        FIELD.y +
        FIELD.height / 2,

    vx: 3,

    vy: 0
};

/* =========================================================
   SKOR / SÜRE
========================================================= */

let blueScore = 0;

let redScore = 0;

let matchTime = MATCH_TIME;

let lastSecond =
    Date.now();

let lastPhysics =
    Date.now();

let lastNetwork =
    Date.now();

/* =========================================================
   ID
========================================================= */

function createId() {

    return Math.random()
        .toString(36)
        .substring(2, 10);
}

/* =========================================================
   İSİM TEMİZLE
========================================================= */

function cleanName(name) {

    if (
        typeof name !==
        "string"
    ) {

        return "Oyuncu";
    }

    name =
        name
            .replace(/[<>]/g, "")
            .trim();

    if (!name) {

        return "Oyuncu";
    }

    return name.substring(
        0,
        16
    );
}

/* =========================================================
   TAKIM SAYILARI
========================================================= */

function getTeamCounts() {

    let blue = 0;

    let red = 0;

    for (
        const player
        of players.values()
    ) {

        if (
            player.team ===
            "blue"
        ) {

            blue++;

        } else if (
            player.team ===
            "red"
        ) {

            red++;
        }
    }

    return {
        blue,
        red
    };
}

/* =========================================================
   TAKIM SEÇ
========================================================= */

function getTeam() {

    const {
        blue,
        red
    } = getTeamCounts();

    /*
     * Önce sayısı az olan takıma koy.
     */

    if (
        blue < red &&
        blue < MAX_TEAM_PLAYERS
    ) {

        return "blue";
    }

    if (
        red < blue &&
        red < MAX_TEAM_PLAYERS
    ) {

        return "red";
    }

    /*
     * Eşitse dönüşümlü.
     */

    if (
        blue <= red &&
        blue < MAX_TEAM_PLAYERS
    ) {

        return "blue";
    }

    if (
        red < MAX_TEAM_PLAYERS
    ) {

        return "red";
    }

    if (
        blue < MAX_TEAM_PLAYERS
    ) {

        return "blue";
    }

    return null;
}

/* =========================================================
   TAKIM OYUNCULARI
========================================================= */

function getTeamPlayers(team) {

    const result = [];

    for (
        const player
        of players.values()
    ) {

        if (
            player.team === team
        ) {

            result.push(player);
        }
    }

    return result;
}

/* =========================================================
   BAŞLANGIÇ POZİSYONU
========================================================= */

function spawnPosition(
    team,
    index
) {

    const startX =
        team === "blue"
            ? FIELD.x + 180
            : FIELD.x +
              FIELD.width -
              180;

    const direction =
        team === "blue"
            ? 1
            : -1;

    const column =
        index % 2;

    const row =
        Math.floor(
            index / 2
        );

    return {

        x:
            startX +
            direction *
                column *
                55,

        y:
            FIELD.y +
            125 +
            row *
                105
    };
}

/* =========================================================
   TOPU SIFIRLA
========================================================= */

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
        (Math.random() - 0.5) *
        3;
}

/* =========================================================
   OYUNCULARI SIFIRLA
========================================================= */

function resetPlayers() {

    const blue =
        getTeamPlayers("blue");

    const red =
        getTeamPlayers("red");

    for (
        let i = 0;
        i < blue.length;
        i++
    ) {

        const player =
            blue[i];

        const pos =
            spawnPosition(
                "blue",
                i
            );

        player.x =
            pos.x;

        player.y =
            pos.y;

        player.vx = 0;

        player.vy = 0;
    }

    for (
        let i = 0;
        i < red.length;
        i++
    ) {

        const player =
            red[i];

        const pos =
            spawnPosition(
                "red",
                i
            );

        player.x =
            pos.x;

        player.y =
            pos.y;

        player.vx = 0;

        player.vy = 0;
    }

    resetBall();
}

/* =========================================================
   YENİ MAÇ
========================================================= */

function resetMatch() {

    blueScore = 0;

    redScore = 0;

    matchTime =
        MATCH_TIME;

    lastSecond =
        Date.now();

    resetPlayers();
}

/* =========================================================
   OYUNCU EKLE
========================================================= */

function addPlayer(
    ws,
    name
) {

    if (
        players.size >=
        MAX_PLAYERS
    ) {

        ws.send(
            JSON.stringify({
                type: "full"
            })
        );

        ws.close();

        return;
    }

    const team =
        getTeam();

    if (!team) {

        ws.send(
            JSON.stringify({
                type: "full"
            })
        );

        ws.close();

        return;
    }

    const id =
        createId();

    const player = {

        id,

        name:
            cleanName(name),

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

    players.set(
        id,
        player
    );

    ws.playerId =
        id;

    ws.send(
        JSON.stringify({

            type:
                "welcome",

            id,

            team,

            name:
                player.name
        })
    );

    resetPlayers();

    console.log(
        `${player.name} katıldı | ${team} | ${players.size}/12`
    );
}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
    "connection",
    ws => {

        /*
         * Ping/pong ile bağlantının
         * açık kalmasını sağla.
         */

        ws.isAlive = true;

        ws.on(
            "pong",
            () => {

                ws.isAlive = true;
            }
        );

        ws.on(
            "message",
            raw => {

                let data;

                try {

                    data =
                        JSON.parse(
                            raw.toString()
                        );

                } catch {

                    return;
                }

                /*
                 * Henüz oyuncu değilse
                 * sadece JOIN kabul et.
                 */

                if (!ws.playerId) {

                    if (
                        data.type ===
                            "join" &&
                        typeof data.name ===
                            "string"
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

                /*
                 * INPUT
                 */

                if (
                    data.type ===
                    "input"
                ) {

                    player.keys.up =
                        !!data.up;

                    player.keys.down =
                        !!data.down;

                    player.keys.left =
                        !!data.left;

                    player.keys.right =
                        !!data.right;
                }
            }
        );

        ws.on(
            "close",
            () => {

                if (
                    !ws.playerId
                ) {

                    return;
                }

                const player =
                    players.get(
                        ws.playerId
                    );

                if (player) {

                    console.log(
                        `${player.name} ayrıldı`
                    );

                    players.delete(
                        ws.playerId
                    );
                }

                resetPlayers();
            }
        );
    }
);

/* =========================================================
   OYUNCU HAREKETİ
========================================================= */

function movePlayer(
    player
) {

    let dx = 0;

    let dy = 0;

    if (
        player.keys.left
    ) {

        dx--;
    }

    if (
        player.keys.right
    ) {

        dx++;
    }

    if (
        player.keys.up
    ) {

        dy--;
    }

    if (
        player.keys.down
    ) {

        dy++;
    }

    /*
     * Normalizasyon
     */

    if (
        dx !== 0 ||
        dy !== 0
    ) {

        const length =
            Math.hypot(
                dx,
                dy
            );

        dx /=
            length;

        dy /=
            length;

        player.vx =
            dx *
            PLAYER_SPEED;

        player.vy =
            dy *
            PLAYER_SPEED;

    } else {

        player.vx *=
            0.72;

        player.vy *=
            0.72;
    }

    player.x +=
        player.vx;

    player.y +=
        player.vy;

    /*
     * Sınırlar
     */

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

    if (
        player.x < minX
    ) {

        player.x =
            minX;

        player.vx = 0;
    }

    if (
        player.x > maxX
    ) {

        player.x =
            maxX;

        player.vx = 0;
    }

    if (
        player.y < minY
    ) {

        player.y =
            minY;

        player.vy = 0;
    }

    if (
        player.y > maxY
    ) {

        player.y =
            maxY;

        player.vy = 0;
    }
}

/* =========================================================
   OYUNCU - TOP ÇARPIŞMASI
========================================================= */

function collidePlayerBall(
    player
) {

    const dx =
        ball.x -
        player.x;

    const dy =
        ball.y -
        player.y;

    const distanceSquared =
        dx * dx +
        dy * dy;

    const minimumDistance =
        PLAYER_RADIUS +
        BALL_RADIUS;

    if (
        distanceSquared >=
        minimumDistance *
        minimumDistance
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

    /*
     * Topu oyuncudan çıkar
     */

    ball.x =
        player.x +
        nx *
            minimumDistance;

    ball.y =
        player.y +
        ny *
            minimumDistance;

    /*
     * Topa kuvvet
     */

    ball.vx +=
        nx * 2.4 +
        player.vx * 0.65;

    ball.vy +=
        ny * 2.4 +
        player.vy * 0.65;

    /*
     * Maksimum hız
     */

    const speed =
        Math.hypot(
            ball.vx,
            ball.vy
        );

    if (
        speed >
        BALL_MAX_SPEED
    ) {

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

/* =========================================================
   TOP
========================================================= */

function updateBall() {

    ball.x +=
        ball.vx;

    ball.y +=
        ball.vy;

    /*
     * Sürtünme
     */

    ball.vx *=
        0.992;

    ball.vy *=
        0.992;

    /*
     * ÜST
     */

    if (
        ball.y -
            BALL_RADIUS <=
        FIELD.y
    ) {

        ball.y =
            FIELD.y +
            BALL_RADIUS;

        ball.vy *=
            -0.9;
    }

    /*
     * ALT
     */

    if (
        ball.y +
            BALL_RADIUS >=
        FIELD.y +
            FIELD.height
    ) {

        ball.y =
            FIELD.y +
            FIELD.height -
            BALL_RADIUS;

        ball.vy *=
            -0.9;
    }

    const goalTop =
        FIELD.y +
        FIELD.height / 2 -
        GOAL.height / 2;

    const goalBottom =
        FIELD.y +
        FIELD.height / 2 +
        GOAL.height / 2;

    /*
     * SOL KALE
     */

    if (
        ball.x -
            BALL_RADIUS <=
        FIELD.x
    ) {

        if (
            ball.y >
                goalTop &&
            ball.y <
                goalBottom
        ) {

            redScore++;

            resetPlayers();

            return;
        }

        ball.x =
            FIELD.x +
            BALL_RADIUS;

        ball.vx *=
            -0.9;
    }

    /*
     * SAĞ KALE
     */

    if (
        ball.x +
            BALL_RADIUS >=
        FIELD.x +
            FIELD.width
    ) {

        if (
            ball.y >
                goalTop &&
            ball.y <
                goalBottom
        ) {

            blueScore++;

            resetPlayers();

            return;
        }

        ball.x =
            FIELD.x +
            FIELD.width -
            BALL_RADIUS;

        ball.vx *=
            -0.9;
    }
}

/* =========================================================
   OYUN GÜNCELLEME
========================================================= */

function updateGame() {

    /*
     * Oyuncular
     */

    for (
        const player
        of players.values()
    ) {

        movePlayer(
            player
        );
    }

    /*
     * Oyuncu-top
     */

    for (
        const player
        of players.values()
    ) {

        collidePlayerBall(
            player
        );
    }

    /*
     * Top
     */

    updateBall();
}

/* =========================================================
   SÜRE
========================================================= */

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

        if (
            matchTime <= 0
        ) {

            /*
             * 5 dakika bitti.
             */

            resetMatch();
        }
    }
}

/* =========================================================
   NETWORK STATE
========================================================= */

function broadcast() {

    /*
     * Oyuncu listesini hazırla.
     */

    const playerData =
        [];

    for (
        const player
        of players.values()
    ) {

        playerData.push({

            id:
                player.id,

            name:
                player.name,

            team:
                player.team,

            x:
                Math.round(
                    player.x *
                    10
                ) / 10,

            y:
                Math.round(
                    player.y *
                    10
                ) / 10
        });
    }

    /*
     * Tek JSON oluştur.
     */

    const message =
        JSON.stringify({

            type:
                "state",

            players:
                playerData,

            ball: {

                x:
                    Math.round(
                        ball.x *
                        10
                    ) / 10,

                y:
                    Math.round(
                        ball.y *
                        10
                    ) / 10
            },

            score: {

                blue:
                    blueScore,

                red:
                    redScore
            },

            matchTime:
                matchTime,

            maxPlayers:
                MAX_PLAYERS,

            field:
                FIELD,

            goal:
                GOAL
        });

    /*
     * Herkese gönder.
     */

    for (
        const player
        of players.values()
    ) {

        const ws =
            player.ws;

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            ws.send(
                message
            );
        }
    }
}

/* =========================================================
   ANA OYUN DÖNGÜSÜ
========================================================= */

function gameLoop() {

    const now =
        Date.now();

    /*
     * Fizik zamanı
     */

    if (
        now -
        lastPhysics >=
        PHYSICS_INTERVAL
    ) {

        /*
         * Biriken zaman çok büyürse
         * server'ın geride kalmasını önle.
         */

        if (
            now -
            lastPhysics >
            100
        ) {

            lastPhysics =
                now;
        } else {

            lastPhysics +=
                PHYSICS_INTERVAL;
        }

        updateGame();

        updateTimer();
    }

    /*
     * Network 30 FPS
     */

    if (
        now -
        lastNetwork >=
        NETWORK_INTERVAL
    ) {

        lastNetwork =
            now;

        broadcast();
    }

    setImmediate(
        gameLoop
    );
}

gameLoop();

/* =========================================================
   PING
========================================================= */

const pingInterval =
    setInterval(
        () => {

            for (
                const ws
                of wss.clients
            ) {

                if (
                    ws.isAlive === false
                ) {

                    ws.terminate();

                    continue;
                }

                ws.isAlive =
                    false;

                ws.ping();
            }

        },
        30000
    );

wss.on(
    "close",
    () => {

        clearInterval(
            pingInterval
        );
    }
);

/* =========================================================
   SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `Mini HaxBall server ${PORT} portunda çalışıyor.`
        );

    }
);
