# Arama kayıtları

Faz E uygulaması yalnız `apps/web-beta` panelini kapsar. Legacy `arama_kayitlari` bu değişiklikte taşınmaz.

## Kaynak ve kurulum

- Migration: `030_add_call_logs.sql`. `users.sip_extension` IF NOT EXISTS ile eklenir; paralel 029 ile uyumludur. Rollback bu ortak sütunu kaldırmaz.
- NetGSM Netsantral → Ayarlar / Genel Ayarlar → API Talep Ayarları → URL'e yönlendirme adresi: `https://<api-domain>/api/netgsm/webhook/santral`.
- Beta Ayarlar → Santral, isteğe bağlı `netgsm.santral_webhook_token` ayarını ve token içeren kopyalanabilir adresi sunar. Token 16–128 harf/rakam/alt çizgi/tire; boş değer korumayı kapatır. Geçersiz token da HTTP 200 alır, çağrı uygulanmaz.
- JSON ve form desteklenir. Senaryolar: Inbound_call, Outbound_call, Local_call, Answer, Hangup, Queue, InboundtoPBX, Context, DTMF, QueueLeave, cdr.
- Her teslimat `webhook_events` içine kaydedilir. Senaryo aynı çağrı ID'sini tekrar kullandığından `external_event_id` boş bırakılır. `call_logs.unique_id` ve olay içerik özeti tekrarları ayıklar. İşlenemeyen teslimatlar `received` durumunda kalır; uygulama hatası loglanır.
- `call_logs` kolonları İngilizce snake_case; kimlikler, numaralar, yön, sonuç, süreler, zamanlar, kuyruk/context/DTMF/trunk, kaynak ses URL'si ve dosya ilişkisi tutulur. `raw_payload` son birleşik alanları; `events` her farklı teslimatın bütün özgün payload'ını, kaynağını ve alınma zamanını içerir. Henüz bitmemiş çağrının `status` alanı NULL'dır.
- Dahili `users.sip_extension` ile; dış telefon, rakamlara indirgenmiş son 10 haneyle müşteri ile eşleşir. Sipariş bağı yalnız softphone istemci olayından alınır; müşteri/telefon uyuşmazlığı reddedilir. Belirsiz müşteri/dahili eşleşmesinde en küçük kullanıcı/müşteri ID'si seçilir.

## İstemci sözleşmesi

`POST /api/call-logs/client-events`, Bearer oturum, calisan/admin/owner:

```json
{
  "direction": "outbound",
  "phone": "05551112233",
  "order_public_id": "ord_example",
  "customer_public_id": "cus_example",
  "started_at": "2026-10-17T10:00:00Z",
  "ended_at": "2026-10-17T10:01:00Z",
  "client_status": "answered",
  "talk_seconds": 40
}
```

201 yanıtı `{ "call_log": ... }`. Paylaşılan tipler `@garanti-kulucka/shared` paketinde `CallLogClientEventRequest`, `CallLogClientEventResponse`, `CallLog`, `CallLogListResponse`; doğrulama `callLogClientEventRequestSchema`.

Durumlar: answered, failed, busy, no_answer, cancelled (`no_answer` → `missed`). Aynı kullanıcı, yön ve telefon için başlangıcı ±2 dakika içinde olan en yakın softphone kaydı NetGSM kaydıyla birleşir; geliş sırası ve eşzamanlı teslimatlar desteklenir. Farklı NetGSM unique_id'leri yalnız telefon/zaman yakın diye birleştirilmez. Dahili sonradan öğrenilirse erken provider satırı da softphone satırıyla birleştirilir. NetGSM nihai sonucu önceliklidir; sipariş bağı korunur.

GET `/api/call-logs`: direction, status, user (public ID), date_from/date_to (ISO), customer_public_id, order_public_id, missed_only, limit (1–100), offset. GET `/{public_id}` ayrıntı/ham olaylar; GET `/{public_id}/recording` Garage presigned indirme yönergesi. Personel yalnız kendi çağrı/ses kaydını, admin/owner hepsini görür. Genel `/api/files` erişimi de arşiv kayıtlarına aynı sahiplik denetimini uygular.

Beta `/aramalar` yön/durum/personel/tarih ve cevapsız filtresi, sayfalama, ses oynatıcı içerir. Müşteri ve sipariş detayındaki Aramalar bölümü aynı API filtrelerini kullanır. Bildirim zili cevapsız gelenleri listeler; `call.missed` Socket.IO olayı zili yeniler. Olay, atanan personel ile admin/owner oturumlarına gönderilir; genel yayın yapılmaz.

## Worker ve ses arşivi

- Her gün İstanbul saati 02:15'te `provider-delivery` / `netgsm.call.reconcile`: önceki takvim günü, 00:00–23:59. Rapor tarihleri İstanbul saat dilimindedir. `callReportRequest` çok günlük girdiyi başlangıç günüyle sınırlar; varsayılan yalnız bugündür.
- NetGSM rapor yönleri webhook'tan ayrıdır: 0 giden, 1 gelen, 2 gelen cevapsız, 3 giden cevapsız, 4 dahili, 5 dahili cevapsız. Rapordaki tüm alanlar `raw_payload` ve olayda saklanır. Rapor webhook'un mevcut dolu alanlarını ezmez.
- Uzlaştırma işi PostgreSQL advisory lock + kalıcı provider attempt zamanı ile sorgular arasında en az 31 saniye bırakır (dakikada ≤2); başarısız HTTP denemeleri de kaydedilir. Tek pencere 24 saatten kısadır. Manuel rapor tetiklerini aynı dakika içinde tekrar tekrar çalıştırmayın.
- `provider-delivery` / `netgsm.call.recording.archive`: kaynak URL'den ses indirilip Garage `call-recordings/<public_id>/recording` nesnesine ve `files` satırına yazılır. İki eşzamanlı iş tek dosya oluşturur. Retry aynı nesne anahtarını kullanır. Başarısız arşiv işleri sonraki gece yeniden kuyruğa alınır.
- İki iş de aktif NetGSM hesabı ve `providers.netgsm.live_mode=true` gerektirir. Kapalıyken HTTP/Garage çağrısı yapılmaz. S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_MEDIA mevcut Garage ayarlarıdır.
- İndirme HTTPS NetGSM alan adlarıyla sınırlıdır, yönlendirme reddedilir, süre 60 sn, ses boyutu en fazla 100 MB. Kaynak URL personel tarayıcısında oynatılmaz. Arşiv dosyaları orphan temizliğinin dışında tutulur ve FK ile korunur.

## Migrator hedefi

192 legacy `arama_kayitlari` satırı ayrı migrator çalışmasında `call_logs` tablosuna, `source='legacy'` ile aktarılabilir. `unique_id`, eksik NetGSM alanları ve `recording_file_id` NULL olabilir. Legacy ID'yi `raw_payload` içinde ve `legacy_id_map` üzerinden (`target_table='call_logs'`) koruyun. Kullanıcı/müşteri/sipariş FK'lerini mevcut legacy kimlik haritasıyla çözün; eksik zaman/süre/sonuç uydurmayın. Bu PR legacy veriye bağlanmaz veya veri taşımaz.

## Yerel doğrulama

`npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:contracts`, `npm run test:worker`, `npm run test:e2e:beta -- call-logs.beta.ts`.

macOS sandbox tarayıcı başlatmayı engellerse Playwright test sunucusu için `PLAYWRIGHT_WS_ENDPOINT` kullanılabilir; `<loopback>` ağ yönlendirmesi yerel Vite/mock adreslerini test sunucusuna açar. Bu yalnız test yapılandırmasıdır.

Ek gerçek PostgreSQL senaryoları `apps/api/test/call-logs-postgres.test.ts` içindedir. Yalnız localhost/127.0.0.1 olan **ayrı test veritabanına** `CALL_LOGS_TEST_DATABASE_URL` verildiğinde çalışır; her çalışmada geçici şema kurulur ve kaldırılır. DATABASE_URL okunmaz. `CALL_LOGS_TEST_DATABASE_URL=postgresql://...@127.0.0.1:<test-port>/<test-db> npx vitest run apps/api/test/call-logs-postgres.test.ts`. NetGSM HTTP ve Garage yazma mock'tur; gerçek sağlayıcıya istek gönderilmez.

Kaynak: https://www.netgsm.com.tr/netsantraldokuman/ — Webhook Santral Dinleme → URL'e Yönlendirme; Rapor → Görüşme Detayı (CDR).
