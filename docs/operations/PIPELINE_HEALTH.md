# Pipeline Sağlığı (kargo pipeline, cron'lar, webhook alımı, kuyruklar)

Kapsam: `apps/worker` (BullMQ işçileri, kargo pipeline tick'i, zamanlanmış işler), `apps/api` webhook alımı ve
`provider_attempts` / `webhook_events` kayıtları. İnceleme 2026-10-10 tarihinde yapıldı. Hiçbir canlı sağlayıcı
çağrılmadı; testler fixture/mock ve isteğe bağlı yerel Postgres ile koşar.

## Düzeltilen bulgular

| # | Önem | Bulgu | Düzeltme |
|---|------|-------|----------|
| 1 | Kritik | `provider_attempts (provider_id, idempotency_key)` her durum için tekildi. Bir kez hata alıp BullMQ tarafından yeniden denenen iş, sonraki denemesini kaydedemiyordu: `persist()` tekillik hatası attı ve iş başarısız sayıldı. Taşıyıcı çağrısı başarılı olsa bile iş yeniden denendi; SMS, WhatsApp mesajı ya da gönderi 5 kereye kadar tekrar gönderilebiliyordu. | Migration 027: anahtar yalnız `status='success'` için tekil, hata geçmişi tutulur. Canlı başarı aynı anahtardaki dry-run başarısının yerini alır, yarışan ikinci canlı başarı ilk satırı döndürür. `provider-delivery` canlı çağrıdan önce aynı anahtarın canlı başarısına bakar (replay guard); varsa çağrı yapmadan `status: "replayed"` döner. |
| 2 | Kritik | API'nin kuyruğa koyduğu `provider.webhook.received` işleri worker'da "provider envelope" olarak doğrulanıyordu. Her gelen webhook 5 kez başarısız olup dead-letter'a düşüyordu; hiçbir webhook konuşmaya, müşteriye ya da mesaja dönüşmüyordu. | Yeni gelen-mesaj hattı (`apps/worker/src/inbound-messages.ts`): WhatsApp, Instagram ve Messenger DM'leri ile Instagram ve Facebook yorumları işlenir. Mesajlar Meta id'leriyle tekildir, okunmamış sayacı konuşma satırı kilitliyken artar, echo ve okundu/iletildi bildirimleri atlanır. `webhook_events.status` ve `processed_at` güncellenir. |
| 3 | Kritik | Canlı adaptörlere deneme numarası yanlış alan adlarıyla (`attempt_number`/`max_attempts`) geçiyordu. Her deneme "3'te 1" sayılıyor ve hiçbir zaman dead-letter'a düşmüyordu. | `attemptNumber`/`maxAttempts` geçiliyor. |
| 4 | Yüksek | Retry kararı BullMQ'ya iletilmiyordu: 4xx yanıtlar, anahtarsız idempotent olmayan gönderimler ve tükenmiş denemeler yine 5 kez deneniyordu. | `dead_letter` kararında hata `UnrecoverableError` olarak işaretlenir, BullMQ yeniden denemez. |
| 5 | Yüksek | Webhook `external_event_id` değeri `entry[0].id`'ye (WABA, sayfa ya da IG hesap id'si; her olayda aynı) düşüyordu. İkinci teslim bildirimi ya da yorumdan sonra her olay "replay" sanılıp hiç saklanmıyordu. | Teslim bildirimleri için `status:<id>:<durum>`, yorumlar için `comment:<id>` kullanılıyor; aksi halde id yok. |
| 6 | Yüksek | Kaydı yapılıp kuyruğa konamayan webhook (publish hatası) kayboluyordu: sağlayıcı tekrar gönderince "zaten var" yanıtı dönüyor ama iş hiç oluşmuyordu. | `received` durumundaki olay, tekrar gelişte yeniden kuyruğa konur. İş id'si olaydan türetilir (`job_webhook_<event>`), böylece aynı olay iki kez paralel koşmaz. |
| 7 | Yüksek | `signature_mode=enforce` ayarlıyken secret yoksa imzasız istekler kabul ediliyordu (fail-open). | 401 döner. Varsayılan davranış değişmedi: secret yoksa mod `off`. |
| 8 | Yüksek | Worker'ın kendi yayınladığı işler (kargo pipeline SMS/VAPI, Instagram insights) `attempts=1` ile koşuyordu ve hiç silinmiyordu (telefon numaraları süresiz Redis'te kalıyordu). | `workerJobOptions`: 5 deneme, üstel backoff, tamamlanan işler 7 gün, başarısızlar 14 gün tutulur. |
| 9 | Yüksek | Kargo pipeline: kapanışta çalışan tick beklenmiyordu, sahiplenilen satırlar sonsuza dek `isleniyor` kalıyordu. Admin bir satırı iptal ettiğinde worker'ın sonucu bu iptali eziyordu. | `close()` çalışan tick'i bekler. 30 dakikadan eski ve VAPI çağrısı olmayan `isleniyor` satırlar `bekliyor`a döner. Worker güncellemeleri yalnız hâlâ `isleniyor` olan satırlara uygulanır. |
| 10 | Yüksek | `STORAGE_ORPHAN_DELETE_ENABLED=true` iken hızlı yanıt medyası, Instagram yayın medyası ve henüz eklenmemiş yüklemeler "yetim" sayılıp siliniyordu. Silinen dosyanın satırı yerinde kaldığından her çalışmada aynı 100 satır seçiliyordu. | Tüm referans tabloları hariç tutulur; `available` dosyalara 7 günlük bekleme süresi tanınır; önce satır (RESTRICT FK korumasıyla), sonra nesne silinir. |
| 11 | Orta | Gecikmeli takip yanıtı `delivered` bir gönderiyi `in_transit`'e geri çevirebiliyordu (pipeline'a yeniden girer). | `delivered` korunur; yalnız iade (`returned`) uygulanır. |
| 12 | Orta | Bozuk bir `settings.changed` mesajı ya da açılışta başarısız hydrate/zamanlama, işlenmemiş promise reddi olarak tüm worker replikalarını düşürebiliyordu. Hydrate hata verirse invalidation aboneliği hiç kurulmuyordu. | JSON hatası yutulur, açılış hataları loglanır, abonelik hydrate'ten önce kurulur. |
| 13 | Orta | Başarılı taşıyıcı çağrısından sonra sonuç yazımı (shipment write-back vb.) sessizce `failed` dönüyordu. | `worker.result_writeback_failed` hata logu. |
| 14 | Orta | Gelen webhook'lar hiç `processed_at` almadığı için veri saklama işi ham (kişisel veri içeren) payload'ları hiç silmiyordu. | Gelen-mesaj hattı `processed_at` yazar. |
| 15 | Orta | `/api/conversations/summary` yalnız en yeni 200 konuşmayı topluyordu; WhatsApp kanal sayısı hep 0'dı. | SQL aggregate; `unread_conversation_count` ve `channel_counts.whatsapp` eklendi. |

Kontrol edilip sorunsuz bulunanlar: çalışma saatleri `Europe/Istanbul` ile hesaplanıyor; `claimDue`
`FOR UPDATE SKIP LOCKED` kullanıyor; aday eklemede `ON CONFLICT DO NOTHING` var; repeatable işler anahtarla
replikalar arasında tekilleşiyor; `drainWorkers` BullMQ'yu doğru kapatıyor.

## Kalan riskler

- **Replay guard'ın kontrolü ile çağrı arasında boşluk var (check-then-act).** Aynı idempotency anahtarı, farklı iş id'leriyle iki replikada aynı anda koşarsa iki çağrı da gidebilir. İş id'leri anahtardan türetildiği için pratikte nadir; kesin çözüm anahtar başına Redis ya da advisory lock.
- **Zaman aşımında "en az bir kez" teslim.** Anahtarlı ve idempotent olmayan bir gönderim zaman aşımına uğrarsa yeniden denenir. Taşıyıcı isteği aslında almışsa tekrar gönderim olabilir; WhatsApp ve NetGSM tarafında tekilleştirme yok.
- **Kargo pipeline defter tutma hatası.** Publish başarılı olup `recordSms` / `markVapiCallQueued` başarısız olursa deneme sayacı artar. Sonraki deneme yeni anahtarla ikinci SMS ya da arama üretebilir.
- **VAPI çağrı durumu yalnız API'de güncelleniyor.** Mutabakat (`reconcileOpenCalls`), biri pipeline ya da VAPI sayfasını açınca çalışıyor; VAPI adımındaki satırlar ancak o zaman ilerliyor. Bu mutabakat N+1 sorgu yapıyor ve `webhook_events` üzerinde `LIKE` taraması içeriyor. Worker tick'ine taşınmalı.
- **Gelen mesajlar için gerçek zamanlı yayın yok.** Worker Socket.IO'ya yayın yapmıyor; panel 5 ve 10 saniyelik yoklamayla görüyor. Instagram/Messenger müşteri adları Graph çağrısı gerektirdiğinden çekilmiyor; konuşma "Instagram ••••1234" biçiminde görünür. Medya yalnız etiket olarak saklanır (`[Görsel]`), indirilmez.
- **Sürat ATDurumListesi SOAP alanları legacy koda karşı doğrulanmadı.** Kullanılan alanlar: `KullaniciAdi`/`Sifre`/`Il`/`Ilce` istekte, `ATDurumu`/`Mahalle` yanıtta. Ayrıştırıcı toleranslı; `providers.surat.live_mode` açılmadan önce gerçek bir yanıtla fixture güncellenmeli.
- **AI yanıtları her zaman dry-run.** OpenAI adaptörü yok. "AI üret ve gönder" her zaman 409 `ai_live_disabled` döner ve müşteriye hiçbir şey gitmez.
- Hesap yapılandırması negatif önbelleği yalnız `settings.changed` ile temizleniyor. Repeatable iş aralığı env ile değişirse eski zamanlama da yaşamaya devam eder.

## İzleme önerileri

- `queue_job_dead_letters_total` artışı ve `provider-webhooks` başarısız iş sayısı için alarm. Webhook işleri artık başarılı olmalı; dead-letter gerçek bir hatadır.
- `webhook_events` içinde 10 dakikadan eski `status='received'` satır sayısı: işlenmeyen gelen mesaj göstergesi.
- `cargo_pipeline_items` içinde 30 dakikadan eski `isleniyor` satır sayısı ve tick'in `released` sayısı.
- Sonuç yazım hataları için `worker.result_writeback_failed` log olayı.
- `provider_attempts` içinde aynı anahtar için birden fazla `retryable_failure` olması normal (retry geçmişi). Aynı anahtar için `status: "replayed"` dönen işler tekrar gönderim girişimini gösterir.

## Testler

- Birim/route: `apps/worker/test/{inbound-messages,surat-live-adapter,cargo-pipeline,provider-attempts}.test.ts`, `apps/api/test/webhook-ingestion.test.ts`.
- Gerçek Postgres (isteğe bağlı, `TEST_DATABASE_URL` migrate edilmiş bir veritabanını göstermeli; yoksa atlanır):
  `apps/worker/test/*.pg.test.ts`, `apps/api/test/*.pg.test.ts`, uçtan uca `tests/integration/inbound-webhook-pipeline.test.ts`
  (imzalı webhook → API → kuyruk → worker → Postgres).

```bash
docker compose up postgres
DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npm run db:migrate:up
TEST_DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npx vitest run tests/integration
TEST_DATABASE_URL=postgres://garanti:garanti@localhost:5432/garanti npm run test:unit -w @garanti-kulucka/worker
```
