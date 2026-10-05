# Deployment Runbook

Bu runbook P11 "Production Hazırlığı" kapsamındaki deployment kurallarını tanımlar. Release ve tag
üretimi için `RELEASE_MODEL.md`, legacy veri aktarımı için `MIGRATION_APPLY_RUNBOOK.md` geçerlidir.

## 1. Temel İlkeler

- **Immutable image:** Her ortam yalnızca `ghcr.io/<owner>/garanti-kulucka-ecosystem/<service>:vX.Y.Z`
  tag'i ile deploy edilir. `latest`, branch adı veya yerelde build edilmiş image kullanılmaz.
- **Tek tag, tüm servisler:** `api`, `worker`, `migrator` ve `web` aynı `vX.Y.Z` ile birlikte
  promote edilir. Servisler arası tag karışımı yalnızca bu runbook'taki rollback adımında, geçici olarak,
  ve kayıt altına alınarak yapılır.
- **Tag yalnız yeşil CI'dan doğar:** `build-and-tag.yml` tüm testler, Docker build ve artifact
  paketleme başarılı olduktan sonra tag oluşturur. Tag'i elle oluşturmak yasaktır.
- **Digest kaydı:** Deploy kaydına her servis için image digest'i (`docker inspect --format '{{index .RepoDigests 0}}'`)
  yazılır; aynı tag'in farklı içerikle yeniden üretilmediği bu digest ile doğrulanır.
- **Konfigürasyon image dışında:** Secret ve ortam değerleri secret store'dan gelir, image'a gömülmez.

## 2. Ortamlar Ve Promotion

| Ortam | `APP_ENV` | Kaynak | Kapı |
| --- | --- | --- | --- |
| local | `local` | `docker compose` (yerel build) | yok |
| staging | `staging` | CI artifact `vX.Y.Z` | smoke + load script sonuçları |
| production | `production` | staging'de doğrulanmış **aynı** `vX.Y.Z` | onay + backup kanıtı |

Promotion kuralları:

1. Production'a yalnızca staging'de en az bir tam rollout + smoke testten geçmiş tag çıkar.
2. Staging'de doğrulanmamış hotfix production'a gidemez; hotfix de yeni patch tag'i alır.
3. Promotion, image'ı yeniden build etmez; staging'de çalışan digest production'a taşınır.
4. `npm run release-notes -- --tag vX.Y.Z --previous vA.B.C` çıktısı deploy kaydına eklenir.

## 3. Startup Config Doğrulaması

API, worker ve migrator açılışta `@garanti-kulucka/shared` içindeki `validateServiceEnv` ile
ortam değişkenlerini doğrular. Hata varsa süreç bağlantı açmadan **exit code 78** ile kapanır ve yalnız
değişken adlarını ve kuralı loglar; değerler (secret, URL içindeki parola) asla loglanmaz.

- `APP_ENV` verilmezse `NODE_ENV=production` olan container image'larında `production` kabul edilir.
  Yerel compose `APP_ENV=local` set eder.
- `staging` ve `production` katıdır:
  - API: `DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET` zorunlu.
  - Worker: `DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY` zorunlu.
  - Migrator: `TARGET_DATABASE_URL` veya `DATABASE_URL` zorunlu.
  - Secret'lar en az 32 karakter olmalı ve `change-me`, `local-dev` gibi geliştirme değerleri içeremez.
- Her ortamda: URL'ler protokol bazında (`postgres(ql)://`, `redis(s)://`, `http(s)://`) ve sayısal
  ayarlar (`PORT`, TTL'ler, `WORKER_CONCURRENCY`, shutdown timeout'ları) doğrulanır. Herhangi bir
  `S3_*` değişkeni verilirse `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET_MEDIA` birlikte zorunludur. `METRICS_ENABLED=true` ise `METRICS_BEARER_TOKEN` veya
  `METRICS_PORT` zorunludur; katı ortamlarda bearer token da 32 karakter kuralına tabidir.

Deploy öncesi doğrulama: yeni image'ı hedef ortam env'i ile bir kez `--rm` başlatın; exit code 78
görülürse rollout başlamaz.

## 4. Migration Öncesi Backup Kapısı

Schema migration içeren her deploy (yeni dosya `packages/database/migrations` altında) şu kapıdan geçer:

1. Production backup sürecinden PostgreSQL full backup alınır; PITR (WAL arşivi) aktif olmalıdır.
2. Backup artifact'ı veritabanı host'u dışında saklanır ve restore edilebilirliği son 30 gün içinde
   tatbikatla doğrulanmış olmalıdır.
3. Backup kanıtı `MIGRATION_APPLY_RUNBOOK.md` içindeki evidence formatında (hedef DB kimliği +
   `createdAt`) deploy kaydına eklenir; kanıt 24 saatten eski olamaz.
4. Kanıt yoksa migration ve dolayısıyla rollout **başlamaz**.

Schema migration, release image'ı içindeki migration dosyalarıyla tek seferlik job olarak çalışır:

```bash
docker run --rm --entrypoint npx \
  -e DATABASE_URL="$TARGET_DATABASE_URL" \
  ghcr.io/<owner>/garanti-kulucka-ecosystem/migrator:vX.Y.Z \
  node-pg-migrate up --migrations-dir packages/database/migrations
```

Migration'lar **expand/contract** kuralına uyar: bir release yalnız ekleyici (yeni tablo, nullable
kolon, yeni index `CONCURRENTLY`) değişiklik yapar; kolon silme/rename/NOT NULL sıkılaştırma, eski
kodun artık çalışmadığı bir **sonraki** release'te yapılır. Böylece önceki tag yeni şema ile çalışabilir.

## 5. Zero-Downtime Rollout Sırası

Sıra her zaman **migrate → worker → api → web** şeklindedir.

1. **migrate:** Backup kapısı geçildikten sonra schema migration job'ı çalışır. Başarısız olursa
   rollout durur; eski servisler expand-only şema ile çalışmaya devam eder.
2. **worker:** Yeni worker'lar başlatılır, sonra eski worker'lara `SIGTERM` gönderilir. Worker tüm
   BullMQ worker'larını pause eder, aktif job'ları `WORKER_SHUTDOWN_TIMEOUT_MS` (varsayılan 30s) kadar
   bekler; süre aşılırsa kalan worker'lar force-close edilir ve job'lar stalled olarak başka worker'a
   geçer (processor'lar idempotent olmalıdır). Orchestrator `stop_grace_period` değeri bu timeout'tan
   en az 5 saniye büyük olmalıdır (compose: 45s / 40s). Worker health (`WORKER_HTTP_PORT`) ve ayrı
   `METRICS_PORT` listener'ları drain süresince açık kalır, job'lar bittikten sonra kapatılır.
3. **api:** Instance'lar birer birer değiştirilir. Yeni instance `/health/ready` 200 dönmeden trafiğe
   alınmaz. Eski instance `SIGTERM` aldığında:
   - yeni HTTP istekleri `503 server_draining` + `Connection: close` alır (readiness da 503 döner,
     load balancer instance'ı çıkarır),
   - listener kapanır, idle keep-alive bağlantılar kapatılır,
   - Socket.IO yeni handshake'leri reddeder ve bağlı istemcileri disconnect eder; istemciler sağlıklı
     instance'a yeniden bağlanır (Redis streams adapter oda yayınlarını taşır),
   - süren istekler `API_SHUTDOWN_TIMEOUT_MS` (varsayılan 25s) kadar beklenir; sonra Redis, kuyruk
     publisher'ları, internal `METRICS_PORT` listener'ı ve DB pool kapatılır. Timeout aşılırsa exit code 1 ile loglanır.
4. **web:** Statik bundle en son değiştirilir; böylece yeni UI'nin çağırdığı API alanları zaten
   yayındadır.

Her adımdan sonra: `/health/ready`, hata oranı, kuyruk derinliği (`waiting`/`failed`) ve
websocket bağlantı sayısı kontrol edilir. Bir adım başarısızsa sonraki adıma geçilmez.

## 6. Önceki Taga Rollback

Rollback, kod rollback'idir; veritabanı geri alınmaz (bkz. bölüm 7).

1. Son bilinen sağlam `vA.B.C` tag'ini deploy kaydından belirleyin.
2. `vX.Y.Z` ile eklenen migration'ların expand-only olduğunu doğrulayın; değilse bölüm 7'ye geçin.
3. Image'ları registry'den veya `container-images-vA.B.C` artifact'ından alın (`RELEASE_MODEL.md`).
4. Ters sırayla değiştirin: **web → api → worker**. Migration job'ı rollback'te çalıştırılmaz.
5. Graceful drain her servis için yukarıdaki gibi uygulanır.
6. `/health/ready`, `garanti-migrator verify` (legacy aktarım yapılmışsa) ve kritik akış smoke
   testleri (login, sipariş listesi, mesaj gönderimi, webhook kabulü) çalıştırılır.
7. Olay kaydına: rollback nedeni, eski/yeni tag, digest'ler, süre.

Untagged image'a, yerelde build edilmiş image'a veya `latest`'e rollback yapılmaz.

## 7. Forward-Fix Politikası

Şema geri alınamıyorsa (veri dönüştüren migration, contract adımı, silinmiş kolon) **down migration
production'da çalıştırılmaz**. Bunun yerine:

1. Etkiyi sınırla: ilgili özelliği admin ayarı/feature flag ile kapat, gerekirse worker kuyruğunu
   pause et (job'lar Redis'te bekler, Postgres source of truth olmaya devam eder).
2. Düzeltmeyi yeni patch tag'i (`vX.Y.Z+1`) olarak hazırla; normal CI ve staging promotion'ından geçir.
3. Veri düzeltmesi gerekiyorsa idempotent bir forward migration yaz; elle SQL çalıştırılmaz.
4. Veri kaybı veya bozulma varsa backup/PITR'dan **ayrı bir instance'a** restore edip yalnız etkilenen
   kayıtları forward migration ile taşı; production'ın tamamını restore etmek son çaredir ve incident
   owner onayı gerektirir.
5. Olay kaydına migration adı, etkilenen tablolar ve doğrulama sorguları eklenir.

## 8. Kapasite Ve Load Doğrulaması

Staging promotion'ından önce `tools/load/README.md` içindeki scriptler staging URL'ine karşı çalıştırılır:

- `tools/load/api-list.mjs` — liste endpointleri, p95 < 500ms, hata < %1
- `tools/load/webhook-ingress.mjs` — imzalı webhook kabulü ve replay idempotency, p95 < 300ms
- `tools/load/socket-fanout.mjs` — Socket.IO handshake ve event teslim gecikmesi

Scriptler remote host için `--confirm-target=<host>` ister; production hedeflenmez.

## 9. CI Bakımı

- Runner image `ubuntu-24.04` olarak sabitlenmiştir. Yeni Ubuntu image'ına geçiş, Node 22 ve Docker
  build'in yeni image'da doğrulandığı ayrı bir commit ile yapılır.
- Action'lar Node 24 runtime'lı majör sürümlerdedir (`checkout@v5`, `setup-node@v5`,
  `upload-artifact@v5`). Runner Node sürüm uyarısı görüldüğünde ilgili action bir sonraki majöre alınır.
- `npm audit --omit=dev --audit-level=high` raporlayıcı adımdır (`continue-on-error`); bulgular
  `npm-audit-report-<sha>` artifact'ı ve workflow uyarısı olarak görünür, tag'i engellemez. Bulgular
  triage edildikten sonra bu adım bloklayıcı yapılacaktır.
- Tag adımı `npm run check`, Docker build, image paketleme ve artifact upload başarılı olmadan çalışmaz.
