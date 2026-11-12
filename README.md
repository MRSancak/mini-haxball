# SoccerOnline v1.3 (8v8)

Haxball x PES tarzı online futbol. Node.js + ws (sunucu), saf HTML/CSS/JS (istemci).

## v1.3 Yenilikleri
- Başlangıç menüsünde **11v11 MAÇ** düğmesi: tek kalıcı 11v11 sunucusu (sahibi yok, boşalınca sıfırlanır, listede görünmez). Saha %30 büyük, 5 diziliş (4-4-2, 4-3-3, 3-5-2, 4-2-3-1, 5-3-2).
- Kaleler %10 genişledi (GW 190 -> 209) ve oyuncular kalenin içine girebiliyor.
- Kaleci çemberi %50 küçüldü (çember payı 10 -> 5 px, KRING = 21), top tutma süresi 3.5 sn.
- Şutlar %5 daha hızlı (SHOT_BOOST = 1.05).
- Sağ üstte hesap oluşturma / giriş yapma. Parolalar scrypt ile hashlenir, düz metin saklanmaz. Oturum 30 gün (imzalı token).
- Hesapla giren oyuncunun adı hesabından gelir (başkası taklit edemez).

### Hesapların saklanması (Render önemli!)
Render ücretsiz web servisinin dosya sistemi geçicidir; deploy/restart/uyku sonrası dosyalar silinir. Bu yüzden hesaplar veritabanında tutulur:
1. Bir PostgreSQL oluştur (Render Postgres ücretsiz planda 30 gün sonra sona erer; Neon veya Supabase ücretsiz Postgres kalıcı bir seçenektir).
2. Servisin Environment ayarlarına `DATABASE_URL` (bağlantı adresi) ekle. `SESSION_SECRET` render.yaml ile otomatik üretilir.
3. Deploy et; açılışta `users` tablosu kendiliğinden oluşur.
`DATABASE_URL` yoksa hesaplar `users.local.json` dosyasına yazılır (sadece yerel geliştirme için).

## v1.2 Yenilikleri
- Taraftar: oynamayanlar tribüne oturur, takım tutar, tribünden mesaj yazar / tezahürat yapar
- Kaleci topu eline alır (kale sahası içinde, E veya sağ tık); 5 sn içinde oyunu başlatmalı, süre dolunca top otomatik atılır
- Sol tık ile şut
- Sabit sunucular kaldırıldı: sunucu listesi + sunucu kurma (isim, kapasite 16–64, isteğe bağlı parola)
- Sunucu sahibi parola koyabilir/kaldırabilir ve oyuncuları atabilir (atılan 1 dk giremez); sahip çıkarsa sıradaki oyuncu sahip olur, boş sunucu kapanır

## v1.1 Yenilikleri
- Durduktan sonraki kayma %50 azaldı
- Karakter hızı %10 arttı
- Stamina %25 arttı
- Şut dolum süresi %10 azaldı
- Karakter etrafında şut çemberi: top çembere 1 piksel bile girse vurulabilir

## Render'a kurulum
1. Bu klasörü bir GitHub deposuna yükle.
2. Render > New > Web Service > depoyu seç.
3. Build: `npm install`  |  Start: `npm start`  (render.yaml bunu otomatik doldurur)
4. Deploy bitince verilen adres oyunun adresidir (WebSocket otomatik wss kullanır).

Not: Render ücretsiz planda 15 dk işlem olmazsa uyur; ilk giriş birkaç saniye sürebilir.

## Yerelde çalıştırma
    npm install && npm start   ->  http://localhost:3000

## Kontroller
WASD/Oklar hareket | Boşluk/X/Sol tık şut (basılı tut = güç) | E/Sağ tık kaleci topu tutar | Shift koşu | Tab (basılı tut) istatistik | Telefonda: joystick + ŞUT/KOŞ + İstatistik düğmesi

## Ayarlar (server.js başı)
MATCH_SECONDS, GOAL_SECONDS, MIN_MAX/MAX_MAX/MAX_ROOMS, HOLD_SECONDS, CFG.BOX_W/BOX_H, FORMATIONS, P/B (fizik)
