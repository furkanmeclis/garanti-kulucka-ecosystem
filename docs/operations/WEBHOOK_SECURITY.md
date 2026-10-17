# Webhook doğrulaması (Faz F)

Canlıya çıkmadan migration `031` uygulanır. Beta → Ayarlar → Entegrasyonlar (veya Meta sağlayıcı sekmesi)
üzerinden **Meta App Secret** girilir. `webhook.app_secret` global ayarı şifreli, maskeli ve salt yazılır;
API cevapları, sürüm geçmişi ve audit kayıtları sırrı döndürmez. Doğrulama göstergeleri API'nin kullandığı
sır çözümlemesinden üretilir; gösterge sağlayıcının canlı moduna veya GET verify token'ına bağlı değildir.

- WhatsApp, Instagram, Messenger ve `/webhooks/meta`: yapılandırılmış sır varsa `X-Hub-Signature-256`
  ham HTTP gövdesinin baytları üzerinden HMAC-SHA256 ile doğrulanır. `off`/`report_only` bu kuralı
  kapatamaz. Eksik/geçersiz imza 403 döndürür; olay veya kuyruk işi oluşturulmaz.
- Öncelik: seçili hesabın `webhook.app_secret` / `app_secret` ayarı → sağlayıcı genel ayarı →
  tek anlamlı aktif hesap sırrı (hesap seçilmemişse) → global `webhook.app_secret`.
  Birden fazla farklı hesap sırrı varsa callback URL'sinde `account_public_id` ile hesap seçilir
  veya ortak global sır girilir. Hesaplar arasında rastgele sır seçilmez.
- Sır yoksa geliştirme ortamında uyarı loglanır ve `webhook_events.verification_status=unverified`
  yazılır. `APP_ENV=production` olduğunda 403 ile kapalı kalır. Doğrulanmış olaylar `verified` yazılır.
- `/api/facebook/data-deletion`: form veya JSON içindeki `signed_request` imzası **kodlanmış payload**
  üzerinden doğrulanır; algoritma `HMAC-SHA256`, kullanıcı kimliği sayısal olmalıdır. Ortak global sır
  tercih edilir, yoksa tek anlamlı mevcut Meta sağlayıcı sırrı kullanılır. Geliştirmede sır yoksa
  kullanıcı kimliği güvenilir kabul edilmez (null); üretimde 403. Başarılı yanıtın `url` ve
  `confirmation_code` biçimi korunur.
- NetGSM IVR: `netgsm.ivr_webhook_token`; santral: `netgsm.santral_webhook_token`.
  Beta NetGSM/Santral sekmelerinden yapılandırılır ve callback URL'sine `?token=` eklenir.
  Üretimde token zorunludur. Geliştirmede yalnız ayar boşsa opsiyoneldir. Karşılaştırma sabit zamanlıdır.
  IVR geçersiz token için mevcut 401 yanıtını korur; santral reddedilen isteklere 200/`processed:false`
  döndürür, yalnız boş bir `rejected` audit olayı kaydedebilir. İş verisi ve kuyruk etkilenmez.

## Tekrarlar, saklama ve hız sınırı

Mevcut `webhook_events_provider_external_event_idx` benzersiz indeksi yeniden kullanılır. Meta batch'leri
tekil mesaj/durum/olay zarflarına ayrılır: `[a,b]` ardından `[b,c]` geldiğinde yalnız `c` yeni iş olur.
Kimliği olmayan olaylarda normalize edilmiş olay gövdesinin SHA-256 özeti anahtardır; ham imzalı gövdenin
SHA-256 özeti de olayın `raw_payload.signed_body_sha256` alanına yazılır. Query parametrelerini veya JSON
boşluklarını değiştirmek tekrar korumasını aşmaz. Anahtarlar PostgreSQL'de olduğundan süreç yeniden
başlatılması ve eşzamanlı API örneklerinde de koruma sürer.

Saklama penceresi mevcut webhook retention politikasına bağlıdır: varsayılan 90 gün
(`DATA_RETENTION_WEBHOOK_EVENTS_DAYS`, alt sınır 30 gün). Retention silme özelliği açılmadığında anahtarlar
silinmez. Başarıyla işlenmiş olay tekrar kuyruğa alınmaz. `received` kalan olay aynı deterministik BullMQ
job id'siyle yeniden sunulabilir: veritabanı yazımından sonraki kuyruk kesintisinde veri kaybı önlenir.
Beş dakikalık bellek cache'i yalnız kısa yol sağlar; kalıcı koruma PostgreSQL indeksidir.

Mevcut limiter kullanılır: `WEBHOOK_RATE_LIMIT_PER_MINUTE` varsayılan 600/IP/sağlayıcı.
Meta, IVR ve Facebook veri silme callback'i aşımda 429 verir. Santral aşımda mevcut 200/`processed:false`
kontratını korur, `Retry-After` ekler ve işi işlemez. GET Meta doğrulama handshake'leri değişmez.

## Yerel doğrulama

`npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:contracts`,
`npm run test:e2e:beta -- settings-tabs.beta.ts`.

`WEBHOOK_TEST_DATABASE_URL` yalnız `127.0.0.1`/`localhost` PostgreSQL'e verilirse API testleri izole bir
schema açıp tüm migration'ları uygular; eşzamanlı batch tekrarlarını, kalıcı hash tekilleştirmesini,
şifreli sırları ve doğrulama kolonunu test eder, sonunda schema'yı siler. Gerçek sağlayıcı çağrısı yapılmaz.
