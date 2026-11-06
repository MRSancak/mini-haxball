# Mini Futbol 8v8

Haxball x PES tarzı online futbol. Node.js + ws (sunucu), saf HTML/CSS/JS (istemci).

## Render'a kurulum
1. Bu klasörü bir GitHub deposuna yükle.
2. Render > New > Web Service > depoyu seç.
3. Build: `npm install`  |  Start: `npm start`  (render.yaml bunu otomatik doldurur)
4. Deploy bitince verilen adres oyunun adresidir (WebSocket otomatik wss kullanır).

Not: Render ücretsiz planda 15 dk işlem olmazsa uyur; ilk giriş birkaç saniye sürebilir.

## Yerelde çalıştırma
    npm install && npm start   ->  http://localhost:3000

## Kontroller
WASD/Oklar hareket | Boşluk/X şut (basılı tut = güç) | Shift koşu | Tab (basılı tut) istatistik | Telefonda: joystick + ŞUT/KOŞ + İstatistik düğmesi

## Ayarlar (server.js başı)
MATCH_SECONDS, GOAL_SECONDS, ROOM_COUNT, MAX_PLAYERS, FORMATIONS, P/B (fizik)
