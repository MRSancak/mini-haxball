# Mini Futbol 11v11 (v1.3)

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

## v1.3 yenilikleri
- Tek ve sabit **11v11** sunucu (takım başına 11 mevki, 22 oyuncu + 8 izleyici = 30 kişi).
- **İlk giren admin** olur; admin çıkarsa sunucudaki en eski oyuncu admin olur.
- Admin, lobideki *Admin paneli*nden **boşta olanları** (mevki almamış izleyicileri) tek tuşla atabilir ya da herhangi bir oyuncuyu ✕ ile atabilir. (Maç sırasında "Mevkiler" düğmesiyle panele ulaşılır.)
- 11v11'e özel mevkiler ve dizilişler: 4-4-2 (varsayılan), 4-3-3, 4-2-3-1, 3-5-2, 3-4-3, 5-3-2.
  Mevki kısaltmaları: KL kaleci, SLB/SĞB sol/sağ bek, SLS/SĞS sol/sağ stoper, STP stoper, SLKB/SĞKB kanat bek, SLD/SĞD defansif orta, SLO/OS/SĞO orta saha, OOS ofansif orta saha, SLK/SĞK kanat, SLF/SĞF/FV forvet.
- Diğer her şey (fizik, şut, kaptanlık, istatistik) aynı.

## Ayarlar (server.js başı)
MATCH_SECONDS, GOAL_SECONDS, ROOM_COUNT, MAX_PLAYERS, SLOTS, FORMATIONS, CFG (saha boyu), P/B (fizik)
