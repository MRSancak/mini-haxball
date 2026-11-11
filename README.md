# OnlineSoccer (v1.3)

Haxball x PES tarzı online futbol. Node.js + ws (sunucu), saf HTML/CSS/JS (istemci).
İki sunucu vardır: **11v11** ve **8v8**. Her sunucuda sadece kendi modundaki maç oynanır.

## Render'a kurulum
1. Bu klasörü bir GitHub deposuna yükle.
2. Render > New > Web Service > depoyu seç.
3. Build: `npm install`  |  Start: `npm start`  (render.yaml bunu otomatik doldurur)
4. Deploy bitince verilen adres oyunun adresidir (WebSocket otomatik wss kullanır).

Not: Render ücretsiz planda 15 dk işlem olmazsa uyur; ilk giriş birkaç saniye sürebilir.

## Yerelde çalıştırma
    npm install && npm start   ->  http://localhost:3000

## Kontroller
WASD/Oklar hareket | Boşluk/X şut (basılı tut = güç) | Shift koşu | **Q / E falso** | Tab (basılı tut) istatistik |
Telefonda: joystick + ŞUT/KOŞ + Q/E + İstatistik düğmesi

## Yenilikler

### v1.1
- v1.1 notları buraya eklenecek.

### v1.2
- v1.2 notları buraya eklenecek.

### v1.3
- Oyunun adı **OnlineSoccer** oldu.
- İki sunucu: **11v11** (mevcut) ve yeni **8v8** (22+8 yerine 16 oyuncu + 8 izleyici = 24 kişi). 8v8 sunucusunun kendi dizilişleri (2-3-2, 3-3-1, 3-2-2, 2-4-1) ve biraz daha küçük sahası var.
- 11v11 maçlarda karakterler biraz küçültüldü (yarıçap 16 → 13).
- **Vuruş çemberi:** her karakterin etrafında bir çember var. Topa sadece top çemberin içindeyken (ya da çembere değiyorken) vurulabilir; dışındaysa vuruş olmaz. Top çemberdeyken çember yeşil yanar.
- **Kaleci:** KL mevkisi kaleci. Kalecinin çemberi %50 daha küçüktür (sarı kesikli çember, adın yanında "KL").
- **Falso:** şut tuşuyla birlikte **Q** (sola kavis) ya da **E** (sağa kavis). Kavis, şut gücüyle orantılıdır; top yavaşlayınca ve oyuncuya/direğe çarpınca azalır. Telefonda ekranda Q ve E düğmeleri vardır.
- İlk giren admin olur; admin çıkarsa sunucudaki en eski oyuncu admin olur. Admin, boştakileri tek tuşla ya da herhangi bir oyuncuyu ✕ ile atabilir.
- 11v11'e özel mevkiler ve dizilişler: 4-4-2 (varsayılan), 4-3-3, 4-2-3-1, 3-5-2, 3-4-3, 5-3-2.
- Mevki kısaltmaları: KL kaleci, SLB/SĞB sol/sağ bek, SLS/SĞS sol/sağ stoper, STP stoper, SLKB/SĞKB kanat bek, SLD/SĞD defansif orta, SLO/OS/SĞO orta saha, OOS ofansif orta saha, SLK/SĞK kanat, SLF/SĞF/FV forvet.

## Ayarlar (server.js başı)
MODES (sunucular), CFG11 / CFG8 (saha boyu, karakter boyu R, çember payı RING), GK_RING (kaleci çemberi oranı), SPIN (falso şiddeti), MATCH_SECONDS, GOAL_SECONDS, P/B (fizik)
