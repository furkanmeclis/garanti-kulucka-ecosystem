# Garanti Kulucka Ecosystem Continuation Handoff

Bu belge, projeye yeni bir sohbetten veya bağlamsız bir çalışma oturumundan devam etmek için tek devam kaynağıdır. Önce bu dosya, ardından `MASTER_ROADMAP.md` ve yalnız çalışılacak fazın ilgili teknik belgeleri okunmalıdır. Buradaki yayımlanmış durum ile çalışma ağacındaki yayımlanmamış durum birbirine karıştırılmamalıdır.

## 1. Proje Kimliği ve Güncel Durum

- Repo: `/Users/furkanmeclis/Documents/Projects/garanti-kulucka-ecosystem`
- GitHub çalışma modeli: monorepo, yalnız `main`, PR yok.
- Yayımlanmış son checkpoint: `v0.1.266`
- Yayımlanmış son commit: `e4901f6d1cccae01b1b3f438d92c8540d7fc916e`
- Commit mesajı: `feat(web): add provider cron dry-run trigger`
- Genel ilerleme: yaklaşık `%86`
- Son tamamlanan çalışma: P5 backend-driven frontend shell checkpoint'i; auth/public route parity, legacy route surfaces, backend API-driven inbox/messages/customers/orders/products/shipments/admin/file upload/download/webphone akışları, Socket.IO `message.created` publish/broadcast, conversation join/leave ve seçili/seçili olmayan konuşma yenileme parity kanıtı, inbox okunmamış/havuz/human-agent metrikleri, Instagram/Facebook/Messenger kanal filtresi, açık/kapalı durum filtresi, filtre sonrası görünen konuşma detay seçimi, filtre butonlarının `/api/conversations` backend query parametreleriyle çalışması ve stale filter response guard'ı, admin provider attempt dry-run request preview/redaction paneli, admin settings ve integration audit trail panelleri ile local sensitive-key redaction kanıtı, retry/timeout/rate-limit/queue/storage operation policy paneli ve `/admin/settings/operations.policy` write kanıtı, silme yapmayan admin orphan file candidate görünürlüğü ve non-admin denial kanıtı, selectable conversation detail, canonical customers API ile beslenen müşteri rehberi/list/card summary, `admin`/`calisan` müşteri rehberi erişimi ve `kargo_operatoru` API/UI denial kanıtı, comments moderation detail, legacy comments AI/platform summary, cancellation review detail, backend products API ile beslenen legacy Kuluçka/Yedek Parçalar/Diğer Malzemeler stok kategori summary, ürün SKU/fiyat/stok detayı, kritik stok takibi, inventory signal detail, balances detail ve legacy payment request summary, VAPI AI detail, selected order ve shipment detail panelleri, selected-shipment status update davranışı, backend order özetlerinden üretilen legacy toplam/aktif/teyit/ciro sipariş summary-filter bandı, backend shipment özetlerinden üretilen legacy PTT/Sürat/yoldaki/teslim edilen kargo section summary ve PTT/Sürat/almayan/takipsiz filter summary, shipment pipeline Mesaj/SMS/VAPI/Teslim route parity, Sürat debug route parity, cargo cron debug route parity, reports KPI/detail surface ve legacy teslim/teyit/kargo hareketi oran özeti, manual SMS template preview/character counter, SMS gönderim kayıtları summary, Instagram publish preview ve analytics summary, presigned upload sonrası backend file metadata verification, presigned download instruction ve GET kanıtı, NetGSM SMS confirmation settings write flow, SIP/santral config settings write flow, backend-owned presence toggle, role-filtered navigation, admin integration-account list/upsert/detail/settings/token masking route'ları, tüm admin route yüzeyleri için desktop/mobile visual frame browser E2E kanıtı ve `kargo_operatoru` için izinli mesajlar/siparişler/kargo/kargo pipeline/SMS route setinde desktop/mobile visual frame kanıtıyla yayımlandı.
- Son ek checkpoint: `v0.1.234` provider live-gate catalog görünürlüğünü yayımladı. API `GET /admin/integrations/provider-catalog` read-only catalog döndürür; PTT, Surat, KolayBi, Meta, WhatsApp, Instagram, Messenger, NetGSM, Vapi ve SIP için `fixture_only`, `providers.<provider>.live_mode`, channel/operation listesi, `fixture_replay_contract_required` ve `live_call_permitted: false` UI'da ve API-domain/browser E2E'de kanıtlandı. GitHub Actions run `37169729534`, artifact `container-images-v0.1.234`, artifact id `11291325205`, size `411123870`, expired değil.
- Son güvenlik düzeltmesi: `v0.1.236` UI'daki PTT live gate aksiyonunun `true` yazmasını engelledi; buton artık `PTT live gate kapalı kaydet` olarak `providers.ptt.live_mode=false` kaydeder ve browser E2E request body'yi doğrular. GitHub Actions run `37170419902`, artifact `container-images-v0.1.236`, artifact id `11291441205`, size `411106593`, expired değil.
- Son frontend taşıma dilimi: `v0.1.238` `/kargo/pipeline` route'unu `apps/web` içine aldı; nav item, backend shipment summary tabanlı Mesaj/SMS/VAPI/Teslim durum türetimi, pipeline metric/tabs/detail paneli, selected shipment update sonrası route parity ve desktop/mobile visual frame kapsamı browser E2E ile kanıtlandı. GitHub Actions run `37171138590`, artifact `container-images-v0.1.238`, artifact id `11291811772`, size `411117143`, expired değil.
- Son frontend debug dilimi: `v0.1.240` `/kargo/surat-debug` route'unu admin-only olarak `apps/web` içine aldı; legacy `/api/surat-kargo/debug` yüzeyi backend provider attempt/catalog verisinden karşılanır, `providers.surat.live_mode`, `fixture_replay_contract_required`, `POST /kargo-takip`, retry/duration/status ve local redaction kanıtları browser E2E ile doğrulandı. GitHub Actions run `37171894977`, artifact `container-images-v0.1.240`, artifact id `11291412445`, size `411123499`, expired değil.
- Son frontend cron debug dilimi: `v0.1.242` `/kargo/cron-debug` route'unu admin-only olarak `apps/web` içine aldı; legacy `/api/ptt/cron-debug`, `/api/surat/cron-debug` ve cron-takip-guncelle görünürlüğü backend provider attempt/catalog verisinden karşılanır, `providers.ptt.live_mode`, `providers.surat.live_mode`, PTT/Sürat tracking attempt listesi ve canlı trigger gate kapalılığı browser E2E ile doğrulandı. GitHub Actions run `37172558543`, artifact `container-images-v0.1.242`, artifact id `11291634700`, size `411106520`, expired değil.
- Son inbox filtre dilimi: `v0.1.244` `/mesajlar` yüzeyine unread/havuz/human-agent metriklerini, Instagram/Facebook/Messenger kanal filtresini, açık/kapalı durum filtresini ve filtre sonrası görünen konuşma detay seçimini ekledi; browser E2E global request listener ile doğrudan Supabase/storage origin kullanımını da reddeder. GitHub Actions run `37173499772`, artifact `container-images-v0.1.244`, artifact id `11292516843`, size `411152213`, expired değil.
- Son conversation state dilimi: `v0.1.246` `/api/conversations/:conversation_public_id/state` endpoint'ini, OpenAPI contract'ını ve web client aksiyonlarını ekledi; `/mesajlar` artık okundu yapma, human-agent aç/kapat ve havuzdan al/havuza bırak aksiyonlarını backend API üzerinden çalıştırır. API-domain Playwright ve browser E2E state response, request path ve UI detail güncellemesini kanıtlar. GitHub Actions run `37174263439`, artifact `container-images-v0.1.246`, artifact id `11292213971`, size `411131318`, expired değil.
- Son chat order dilimi: `v0.1.248` `/mesajlar` konuşma detayına `Konuşmadan sipariş aç` aksiyonunu ekledi; frontend seçili conversation public id ile backend `POST /api/orders` çağırır ve browser E2E request body'de `conversation_public_id=cnv_playwright`, `order_number=ORD-WEB-CHAT` ve conversation-order notunu doğrular. GitHub Actions run `37174861381`, artifact `container-images-v0.1.248`, artifact id `11293080722`, size `411099757`, expired değil.
- Son inbox API query dilimi: `v0.1.250` `/mesajlar` kanal/durum filtre butonlarını backend `GET /api/conversations?channel=...&status=...&limit=20` sorgularına bağladı; API virgüllü `facebook,messenger` kanal filtresini repository `IN` sorgusuna çevirir, browser E2E URL kanıtı alır ve frontend stale filter response guard'ı son tıklama davranışını korur. GitHub Actions run `37175827944`, artifact `container-images-v0.1.250`, artifact id `11293131941`, size `411150415`, expired değil.
- Son order API query dilimi: `v0.1.252` `/siparisler` Hepsi/Aktif/Teyit/Teslim filtre butonlarını backend `GET /api/orders` sorgularına bağladı; API `status=active`, `status=delivered` ve `confirmation_status=pending` parametrelerini destekler, OpenAPI contract ve web client route mapping güncellendi, browser E2E filtre URL'lerini ve liste/detay güncellemesini kanıtlar. GitHub Actions run `37176694890`, artifact `container-images-v0.1.252`, artifact id `11293133005`, size `411086072`, expired değil.
- Son shipment API query dilimi: `v0.1.254` `/kargo` filtrelerini backend `GET /api/shipments` sorgularına bağladı; API `provider=ptt`, `provider=surat`, `provider=other`, `status=in_transit`, `status=delivered` ve `tracking_missing=true` parametrelerini destekler, OpenAPI contract ve web client route mapping güncellendi, browser E2E filtre URL'lerini, liste/detay güncellemesini ve status-filter refetch davranışını kanıtlar. GitHub Actions run `37177651001`, artifact `container-images-v0.1.254`, artifact id `11293474803`, size `411134450`, expired değil.
- Son cancellation action dilimi: `v0.1.256` `/iptaller` seçili order için `İptali onayla` aksiyonunu backend `PATCH /api/orders/:order_public_id/status` endpoint'ine bağladı; endpoint status/not günceller, `updated_at` tazeler, OpenAPI contract ve web client route mapping güncellendi, API-domain ve browser E2E request body/response/UI detail kanıtı alındı. GitHub Actions run `37178726578`, artifact `container-images-v0.1.256`, artifact id `11294950546`, size `411112177`, expired değil.
- Son manual SMS dilimi: `v0.1.258` `/sms` yüzeyindeki `SMS gönder` aksiyonunu backend `POST /api/sms/send` endpoint'ine bağladı; endpoint admin/owner/calisan/kargo_operatoru rol sınırı uygular, zorunlu shipment public id ve idempotency key ister, deterministic BullMQ job id ile `provider-delivery` NetGSM `sms.send` job envelope üretir, canlı NetGSM HTTP çağrısı yapmadan `live_call_permitted:false` döner. API-domain ve browser E2E request body/job envelope/UI history kanıtı alındı. GitHub Actions run `37179561935`, artifact `container-images-v0.1.258`, artifact id `11294916189`, size `411119551`, expired değil.
- Son shipment pipeline filtre dilimi: `v0.1.260` `/kargo/pipeline` yüzeyindeki Mesaj/SMS/VAPI/Teslim legacy sekmelerini backend `shipments` summary verisinden türetilen stateful filtrelere çevirdi; `Surat` ve `Sürat` provider yazımları SMS adımına normalize edilir, sekmeler `aria-pressed` ile seçili durumunu taşır, liste filtreleme global seçili shipment operasyon bağlamını bozmaz ve browser E2E Mesaj/SMS/VAPI/Teslim dahil-hariç satır kanıtını alır. GitHub Actions run `37180411054`, artifact `container-images-v0.1.260`, artifact id `11295038353`, size `411130112`, expired değil.
- Son SMS template variable dilimi: `v0.1.262` `/sms` manuel şablonundaki `{musteri_adi}`, `{takip_no}` ve `{kargo_firmasi}` butonlarını backend shipment/order özetlerinden çözülen stateful değişken seçimine bağladı; seçili değişken `aria-pressed` ile işaretlenir, çözülen değer satır-level `sms-template-selected-variable` E2E kanıtı taşır ve SMS gönderim payload'ı aynı backend-derived preview ile korunur. GitHub Actions run `37181062439`, artifact `container-images-v0.1.262`, artifact id `11294939494`, size `411087928`, expired değil.
- Son balance payment request dilimi: `v0.1.264` `/bakiye` yüzeyindeki `Ödeme isteği oluştur` aksiyonunu backend `POST /api/orders/:order_public_id/payment-request` endpoint'ine bağladı; endpoint admin/owner/calisan rol sınırı uygular, KolayBi için canlı provider kapalıyken durable `provider_attempts` kaydı üretir, aynı idempotency key için replay döner, farklı payload reuse için `409 idempotency_conflict` verir ve partial unique index ile uyumlu `ON CONFLICT ... WHERE idempotency_key IS NOT NULL` SQL'i kullanır. API-domain, OpenAPI contract, web client boundary, browser E2E ve Kysely SQL compile kanıtı alındı. GitHub Actions run `37182647165`, artifact `container-images-v0.1.264`, artifact id `11295941919`, size `411128363`, expired değil.
- Son provider cron dry-run dilimi: `v0.1.266` `/kargo/cron-debug` PTT cron dry-run aksiyonunu backend `POST /admin/integrations/provider-cron-triggers/:provider_key` endpoint'ine bağladı; endpoint admin-only çalışır, PTT/Sürat dışını reddeder, canlı provider çağrısı yapmadan canonical `provider_attempts.status=success` kaydı üretir, idempotency replay payload uyumsuzluğunu `409` olarak kapatır ve UI yeni dry-run attempt'i anında cron debug satırlarında gösterir. API-domain, OpenAPI contract, web client boundary ve browser E2E request/body/UI kanıtı alındı. GitHub Actions run `37183631575`, artifact `container-images-v0.1.266`, artifact id `11295564631`, size `411165488`, expired değil.
- Sıradaki bağımlılık kapısı production apply prerequisites'tır: customer address ve external identity fan-out write path'leri, public-id-to-FK resolution, account snapshot enforcement, multi-record customer writer ve per-target `legacy_id_map.mapping_role` semantiği executable hale getirilmelidir. P5 frontend shell migration artık backend-driven kritik akışları kanıtlar; full legacy page visual parity, live provider adapters, object storage operations ve production operations runbooks kendi kapılarında devam eder.
- Production `migrate --apply` kapısı kapalıdır. Tüm aktivasyon koşulları geçmeden açılmamalıdır.

`%86` tahmini; önceki temellere ek olarak customer, conversation, message, product, order, order item ve shipment dry-run dönüşümlerini, transaction/lock safety guardlarını, row-content fingerprint persistence'ını, retry/redaction test kanıtını, real PostgreSQL dry-run source/target evidence'ını, customer address/external identity apply blocker kararını, real PostgreSQL recovery E2E'sini, backup/restore rehearsal kanıtını, backend-driven P5 frontend shell/browser E2E kanıtını, inbox metrik/kanal/durum filtre, conversation state action ve chat-to-order taşımasını, inbox/customer directory/comments/cancellations/inventory/balances/VAPI/order/shipment/shipment pipeline/Sürat debug/cron debug/file upload/download detail panel taşımasını, shipment pipeline Mesaj/SMS/VAPI/Teslim stateful filtre kanıtını, SMS şablon değişken seçici kanıtını, balance payment request backend action, idempotency conflict ve provider attempt persistence kanıtını, provider cron dry-run trigger ve provider attempt persistence kanıtını, Socket.IO `message.created` publish/broadcast ve browser join/leave/live refresh parity kanıtını, admin provider attempt dry-run preview/redaction panelini, admin settings/integration audit trail görünürlüğü ve local redaction kanıtını, operation policy read/write panelini, orphan file candidate visibility panelini, customer directory role-gating kanıtını, comments AI/platform summary taşımasını, backend products API ile beslenen stok kategori, ürün detayı ve kritik stok summary taşımasını, balance payment request summary taşımasını, manual SMS template preview ve character counter taşımasını, SMS gönderim kayıtları summary taşımasını, Instagram publish preview ve analytics summary taşımasını, backend order özetlerinden üretilen sipariş summary-filter bandını, backend shipment özetlerinden üretilen kargo carrier/status/filter/pipeline section taşımasını, presigned upload sonrası file metadata verification ve presigned download GET kanıtını, reports KPI/detail ve oran özeti surface taşımasını, NetGSM SMS settings flow taşımasını, SIP config settings flow taşımasını, tüm admin route yüzeylerinde desktop/mobile visual frame kanıtını ve `kargo_operatoru` izinli route seti visual frame kanıtını içerir. Canlı provider adapterları, full legacy page visual parity, production object storage lifecycle/delete/restore operations, observability/runbook kapıları ve production data apply açılışı tamamlanmış kabul edilmez.
`v0.1.234` sonrası bu orana admin provider live-gate catalog görünürlüğü de dahildir; gerçek live HTTP adapter implementasyonları ve worker policy açılışı bu checkpoint ile yapılmadı.

## 2. Tarihsel Schema Kimliği Checkpoint'i (`v0.1.116`)

Bu bölüm, `v0.1.116` ile yayımlanan tarihsel schema kimliği checkpoint'ini kaydeder. Güncel yayımlanmış release tabanı `v0.1.122`'dir; yeni sohbet bu tarihsel işi yeniden üretmeye çalışmadan P2 maddesinden devam etmelidir.

Checkpoint kapsamı:

- `packages/database/migrations/002_add_migration_identity_targets.sql` eklendi.
- `customer_external_identities` kayıtları `integration_account_id` kapsamında modellendi.
- External identity tekillikleri hesap kapsamında tanımlandı.
- `conversations.integration_account_id` ilişkisi eklendi.
- Conversation external thread tekillikleri hesaplı ve hesapsız kayıtlar için ayrı partial unique indexlere bölündü.
- `legacy_id_map.mapping_role` eklendi.
- Legacy map tekilliği `source_system`, `source_table`, `source_id`, `target_table`, `mapping_role` kapsamında genişletildi; aynı source satırından birden fazla canonical hedef üretilebilmesi için provenance ayrımı hazırlandı.
- Migrator entity listesi, canonical target allowlist, ID map lookup/upsert, target snapshot ve verification yüzeyleri yeni modelle uyumlu hale getirildi.
- `node-pg-migrate` sürümü `9.0.0` çizgisinde tekilleştirildi.
- Production apply kapısı kapalı tutuldu.
- BIGINT runtime tipi ve gerçek source manifest/completeness işleri aktivasyon koşulu olarak kaydedildi.

Bilinen değişiklik yüzeyleri:

- `apps/migrator/src/*` içindeki apply, command, ID map, plan, target, snapshot, type ve verification kodları
- İlgili migrator testleri
- `packages/database/migrations/002_add_migration_identity_targets.sql`
- `packages/database/src/schema.ts`
- Database schema ve migration contract testleri
- `packages/database/package.json` ve `package-lock.json`
- `docs/migration/MIGRATOR_DESIGN.md`
- `tests/migration/migrator-boundary.test.ts`

Bu checkpoint için alınmış kanıt:

- Database testleri: `6/6`
- Migrator testleri: `53/53`
- Migration suite: `3/3`
- Database typecheck: başarılı
- Migrator typecheck: başarılı
- Repository structure doğrulaması: başarılı
- `git diff --check`: başarılı
- Temiz PostgreSQL 18 üzerinde `001 -> 002` up zinciri: başarılı
- Aynı PostgreSQL 18 üzerinde `002` down ve yeniden up: başarılı
- Tam `npm run check`: başarılı
- GitHub Actions run `36487291914`: başarılı
- Otomatik tag: `v0.1.116`
- Artifact: `container-images-v0.1.116`
- Geçici PostgreSQL doğrulama konteyneri temizlendi

`001` down migration bilerek kapalıdır; çift down denemesi `User has disabled down migration on file: 001_initial_canonical_schema` hatasıyla durur. Desteklenen geri alma kanıtı `002` down koruması ve yeniden up zinciridir.

## 3. Tamamlanan P0 Blocker

Dosya: `packages/database/migrations/001_initial_canonical_schema.sql`, yaklaşık satır `331`.

Eski ve PostgreSQL tarafından reddedilen ifade:

```sql
UNIQUE (provider_id, account_id, key) NULLS NOT DISTINCT
```

Doğru PostgreSQL sözdizimi:

```sql
UNIQUE NULLS NOT DISTINCT (provider_id, account_id, key)
```

Hata kodu PostgreSQL `42601` olmuştur. Sözdizimi `0e53650` commit’iyle düzeltildi ve temiz PostgreSQL 18 üzerinde tam migration zinciri doğrulandı.

P0 doğrulama sonucu:

1. Boş PostgreSQL 18 veritabanında `001` ve `002` birlikte up çalıştı.
2. `002` down veri kaybı korumasıyla doğrulandı ve yeniden up çalıştı.
3. Database ve migrator typecheck geçti.
4. Database, migrator ve migration testleri geçti.
5. `npm run check` tam olarak geçti.
6. Checkpoint `main` dalına pushlandı.
7. GitHub Actions başarılı oldu, `v0.1.116` tag’i ve `container-images-v0.1.116` artifact’i oluştu.

## 3.1. Tamamlanan P1 Runtime Tip Dilimi

P1’in runtime `BIGINT` politikası dilimi `v0.1.118` ile yayımlandı.

Kapsam:

- `packages/database/src/integers.ts` eklendi.
- `pg` `int8` parser’ı `Number.isSafeInteger` kontrolüyle kuruldu.
- `createDatabase` kullanan API ve worker runtime yolları parser’ı otomatik kurar.
- Migrator’ın doğrudan `pg.Client` kullanan source runtime yolu aynı safe integer politikasını uygular.
- Safe integer aralığı dışındaki `int8` değerleri sessiz yuvarlanmak yerine `RangeError` ile durur.
- Malformed `int8` değerleri `TypeError` ile durur.

Kanıt:

- Database unit: `3` dosya, `9` test
- Migrator unit: `10` dosya, `54` test
- Tam `npm run check`: başarılı
- İlk commit `3058d49` CI’da package export çözümleme hatasıyla fail oldu ve tag üretmedi.
- Follow-up fix commit `10e73f6` CI’da başarılı oldu.
- Otomatik tag: `v0.1.118`
- Artifact: `container-images-v0.1.118`

## 3.2. Tamamlanan P1 Source Manifest ve Resume Guard Dilimi

P1’in source manifest/completeness ve resume guard dilimi `v0.1.120` ile yayımlandı.

Kapsam:

- Source manifest; source sistem kimliği, normalize database identity, schema/column snapshot’ları, satır sayıları, mapping catalog version, batch size, plan fingerprint ve manifest hash içerir.
- `migration_runs` manifest kayıtları immutable tutulur.
- `legacy_id_map` kayıtları migration run kapsamında izole edilir.
- Verify akışı persisted manifest’i yeniden doğrular; completeness kontrollerini manifest-driven ve run-scoped yürütür.
- Aynı `MIGRATION_RUN_ID` ile farklı source, mapping version, batch şekli, plan fingerprint veya manifest hash üzerinden resume reddedilir.
- Partial apply yasaktır ve production apply fail-closed kalır.
- P3 transaction snapshot isolation ile source row-content checksum/idempotency bu checkpoint’in kapsamında değildir.

Kanıt:

- Implementation commit: `1bab0fa1634745143eb6f7291ac77dc731fdf106` (`feat(migrator): add source manifest resume guard`)
- Migrator unit: `82/82`
- Database unit: `10/10`
- Migration boundary: `3/3`
- Tam `npm run check`: başarılı
- PostgreSQL 18 üzerinde `001 -> 002 -> 003`, `003` down ve yeniden up: başarılı
- `003` FK, manifest immutability, nonblank run ID, run-scoped partial primary target uniqueness ve preexisting batch/ID-map fail-closed davranışları: doğrulandı
- GitHub Actions run `36497700367`: başarılı
- Otomatik tag: `v0.1.120`
- Artifact: `container-images-v0.1.120`, `384237406` byte; API, worker, migrator ve web `.tar.gz` arşivlerini içerir

## 3.3. Tamamlanan P2 Customer Schema Introspection Dilimi

P2'nin ilk introspection ve mapping catalog checkpoint'i `v0.1.122` ile yayımlandı. Bu checkpoint customer dönüşümlerini veya P2 kabul kapısını tamamlamaz.

Kapsam:

- `mappingCatalogVersion` değeri `p2-customer-catalog-v1` olarak versionlandı.
- `public.musteriler` için 15 kolonlu `information_schema` sözleşmesi açıkça tanımlandı.
- Bilinmeyen veya eksik kolon; type, UDT, nullability ve identifier drift'i; duplicate kolon/ordinal metadata'sı fail-closed reddedilir.
- Catalog, source routing, catalog version ve seçilen snapshot kapsamı birbirine bağlandı; catalog ile snapshot verileri defensive clone/freeze ile doğrulama sonrasında dış mutasyona kapatıldı.
- Yalnız `customers` dry-run-ready durumundadır.
- `customer_addresses` ve `customer_external_identities`; koşullu cardinality, account resolution ve gerçek row transformları tamamlanana kadar descriptive tutulur ve çalıştırılabilir plana girmez.
- Core ve production apply, source veya target erişiminden önce kapalı kalır.

Kanıt:

- Implementation commit: `656c5f96e5c22cb47c63a1c841324552a5775065` (`feat(migrator): add legacy customer schema catalog`)
- Migrator unit: `142/142`
- Migration boundary: `3/3`
- Tam `npm run check`: başarılı
- GitHub Actions Build and Tag run `36503036840`: başarılı
- Otomatik tag: `v0.1.122`
- Artifact: `container-images-v0.1.122`, `384197701` byte, süresi dolmamış; API, worker, migrator ve web `.tar.gz` arşivlerini içerir

## 3.4. Tamamlanan P2 Customer Row Transform Dilimi

P2'nin row transform kütüphanesi `v0.1.124` ile yayımlandı. Bu checkpoint customer mapping kabul kapısını, dry-run bağlantısını veya apply aktivasyonunu tamamlamaz.

Kapsam:

- `transformLegacyCustomer` `public.musteriler` satırını frozen customer draft’ına çevirir.
- Ad ve soyad boşsa username, o da boşsa deterministik ve PII içermeyen fallback kullanılır.
- `adres`, `il`, `ilce` veya `posta_kodu` alanlarından biri doluysa `address:default` role’lü address draft üretilir. Hepsi boşsa address üretilmez.
- WooCommerce, KolayBi, Instagram (`ig_`) ve Messenger (`fb_`) değerleri unresolved external identity candidate olarak kalır. Account snapshot olmadan `mappingRole` verilmez.
- Bilinmeyen alan ve bozuk değer fail-closed reddedilir. Validation hataları ham PII yansıtmaz. Programlama hataları satır hatası diye yeniden yazılmaz.
- Source payload checksum dönüşümden önce doğrulanır.
- Migrator source transaction’ı `set local timezone = 'UTC'` ve `set local datestyle = 'ISO, MDY'` ile sabitlenir. Timestamp metni altı haneye kadar korunur.
- Migration `004` canonical WooCommerce provider seed’ini ekler ve çakışan mevcut satırı reddeder. Down migration seed’i silmez.
- `mappingCatalogVersion` `p2-customer-catalog-v1` olarak kalır. Yalnız `customers` dry-run-ready’dir. Address ve external identity hedefleri synthetic ve descriptive kalır.
- Customer apply, `customer_external_identities` veya `customer_addresses` descriptive ya da tanımsızken orchestrator’da fail-closed durur.
- Core ve production apply, source veya target erişiminden önce kapalı kalır.

Kanıt:

- Database seed commit: `b346503` (`feat(database): seed the WooCommerce provider`)
- Transform commit: `80c630e` (`feat(migrator): transform legacy customer rows`)
- Follow-up commit: `15627ade9f77cafe240e86b110bf21881aaa1a28` (`fix(migrator): pin source session and separate row errors`)
- Yerel tam `npm run check`: başarılı
- GitHub Actions Build and Tag run `36635362042`: başarılı
- Otomatik tag: `v0.1.124`, commit `15627ade9f77cafe240e86b110bf21881aaa1a28`
- Artifact: `container-images-v0.1.124`, `384247484` byte, süresi dolmamış

Üç commit tek push ile gönderildiği için workflow yalnız uç commit’i etiketledi. Ara commit’lerin ayrı tag’i yoktur.

## 3.5. Tamamlanan P2 Account Resolution ve Customer Dry-run Dilimi

Bu dilim `v0.1.126` ile yayımlandı. Customer mapping kabul kapısını veya apply aktivasyonunu tamamlamaz.

Kapsam:

- `resolveCustomerExternalIdentities` doğrulanmış hesap snapshot’ındaki tek aktif provider hesabına candidate bağlar.
- `mappingRole` değerleri `external_identity:woocommerce`, `external_identity:kolaybi`, `external_identity:instagram` ve `external_identity:messenger` olur.
- Aynı provider için birden fazla aktif hesap, tekrarlayan public id, bozuk snapshot veya ambiguous eşleşme fail-closed reddedilir. Hata metni public id, external id, e-posta, telefon veya token içermez.
- Aktif hesap yoksa candidate unresolved kalır ve `mappingRole` almaz.
- `assertVerifiedIntegrationAccounts` snapshot’ı source okumadan önce doğrular.
- Dry-run, catalog `customers` kaynağı `public.musteriler` ise planlanan batch’leri okur, satırları dönüştürür ve identity’leri çözer. Target’a yazmaz.
- Catalog kaynağı `public.musteriler` değilse dry-run batch okumadan reddeder.
- Dry-run raporu `customerTransform` özetini taşır: dönüşen satır, address draft, resolved identity, unresolved identity ve isim fallback uyarı sayıları.
- Batch’ten dönen satır sayısı `expectedRows` ile uyuşmazsa dry-run durur.
- `mappingCatalogVersion` `p2-customer-catalog-v1` kalır. Yalnız `customers` dry-run-ready’dir.
- Apply, source veya target açmadan kapalı kalır.

Kanıt:

- Resolution commit: `af42d66` (`feat(migrator): resolve customer external identities`)
- Dry-run commit: `12785be` (`feat(migrator): validate customer rows during dry-run`)
- Non-legacy reddi: `f5018e8` (`fix(migrator): reject non-legacy customer dry-runs`)
- Snapshot assertion: `4ccc5ec2362e6189eb347cf716c22581a7dd0c7e` (`fix(migrator): assert account snapshots explicitly`)
- Yerel tam `npm run check`: başarılı
- GitHub Actions Build and Tag run `36725232959`: başarılı
- Otomatik tag: `v0.1.126`, commit `4ccc5ec2362e6189eb347cf716c22581a7dd0c7e`
- Artifact: `container-images-v0.1.126`, `384223823` byte, süresi dolmamış

Dört commit tek push ile gönderildiği için workflow yalnız uç commit’i etiketledi.

## 4. Değişmez Mimari ve Teslimat Kararları

Bu kararlar yeni sohbetlerde yeniden tartışmaya açılmadan uygulanacaktır:

- Tek repo ve tek `main` dalı kullanılacak; özellik branch’i ve PR akışı olmayacak.
- Onaylanmış her commit küçük, geri alınabilir ve anlamlı olacak.
- Her `main` commit’i tam CI/build kapılarından geçecek; başarılı commit otomatik artan semantic tag alacak.
- PostgreSQL tek operasyonel veri kaynağı olacak; Supabase runtime bağımlılığı kaldırılacak.
- API, worker ve manuel migrator ayrı container sorumlulukları olacak.
- Migrator API özelliği olmayacak; yalnız operatörün açık komutuyla ve manuel compose profiliyle çalışacak.
- MinIO kullanılmayacak.
- Açık kaynak S3-compatible depolama için mevcut hedef Garage’dır. Production kabulü; durability, backup/restore, lifecycle, multipart upload, presigned URL, observability ve kapasite testlerinden sonra kesinleştirilecektir.
- Müşterinin alıştığı frontend görsel olarak değiştirilmeyecek.
- Frontend hiçbir yerde PostgreSQL, Supabase veya provider endpointlerine doğrudan bağlanmayacak; tüm uygulama verisi backend üzerinden akacak.
- Mevcut webhook yanıtları, callback yolları, provider payloadları ve dış servis veri formatları dondurulmuş sözleşme kabul edilecek.
- Yeni database tablo, kolon, constraint, index ve uygulama alan adları İngilizce `snake_case` olacak.
- Admin tarafından değiştirilebilir tüm operasyonel ayarlar PostgreSQL’de kalıcı tutulacak ve restart sonrası geri yüklenecek.
- Database bağlantı adresleri, master encryption key ve altyapı çekirdek sırları admin UI üzerinden yönetilmeyecek.
- Log, rapor, audit, hata nesnesi ve provider attempt kayıtlarında sırlar maskelenecek.
- Production apply, aşağıdaki aktivasyon kapılarının tamamı geçmeden fail-closed kalacak.
- CI gerçek provider credentialı veya internet erişimi gerektirmeyecek.

## 5. Kalan İşlerin Öncelik ve Bağımlılık Sırası

Sıra bağımlılık sırasıdır. Önceki madde tamamlanmadan sonraki riskli kapı açılmamalıdır.

### P0. Aktif Schema Checkpoint’i Tamamla ve Yayımla

Durum: tamamlandı ve `v0.1.116` ile yayımlandı.

1. Migration `001` içindeki `NULLS NOT DISTINCT` sözdizimi düzeltildi.
2. Temiz PostgreSQL 18 üzerinde `001 -> 002` up zinciri doğrulandı.
3. `002` down senaryosu ve migration contract testleri doğrulandı.
4. Aktif çalışma ağacının kapsamı kontrol edildi.
5. Tam `npm run check` çalıştırıldı.
6. `feat(database): add migration identity targets` commit’i oluşturuldu ve `main` dalına pushlandı.
7. CI sonucu, otomatik tag ve API, worker, migrator ile web için dört `.tar.gz` arşivi içeren tek `container-images-v0.1.116` artifact’i doğrulandı.
8. Bu dokümantasyon senkronu P0 sonrasındaki ayrı docs checkpoint’idir.

Kabul kapısı: sıfırdan migration zinciri, testler, image buildleri ve CI aynı commit için yeşil olmalı.

### P1. Database Runtime Tip ve Completeness Temeli

Durum: tamamlandı ve runtime tip dilimi `v0.1.118`, source manifest/completeness dilimi `v0.1.120` ile yayımlandı.

1. PostgreSQL `BIGINT` runtime politikası belirlendi: mevcut Kysely `number` modeli korunur, `pg` `int8` değerleri kontrollü parser ile yalnız JavaScript safe integer aralığında `number` olur.
2. Sessiz precision kaybı yasaktır; safe integer dışı `int8` değerler runtime’da fail-fast davranır.
3. API, worker ve migrator runtime bağlantı yüzeyleri bu politikaya uyumlu hale getirildi.
4. Migration run için source sistem kimliği, normalize database kimliği, tablo/kolon snapshot’ı, satır sayıları, batch size, mapping catalog version, plan fingerprint ve manifest hash içeren gerçek source manifest oluşturuldu.
5. Verify aşaması target içindeki global sayımlar yerine persisted source manifest ve run-scoped `legacy_id_map` kapsamıyla karşılaştırmaya bağlandı.
6. Aynı `MIGRATION_RUN_ID` ile farklı source, mapping sürümü, batch şekli, plan fingerprint veya manifest hash üzerinden resume reddedilir.

Kabul kapısı: kaynaktan sessizce atlanan bir satır verification tarafından bulunmalı; güvenli sayı sınırı üstündeki ID hiçbir katmanda yuvarlanmamalı.

### P2. Legacy Schema Introspection ve Mapping Catalog

Durum: customer, conversation, message, product, order, order item ve shipment schema/dry-run dönüşüm dilimleri `v0.1.146` çizgisine kadar yayımlandı. Dry-run bu satırları dönüştürür ve target’a yazmaz. Address ve external identity hedefleri descriptive kalır; customer apply için ikisi de explicit prerequisite kabul edilir ve production apply kapısı kapalıdır.

Önce kaynak database gerçek yapısı `information_schema` üzerinden çıkarılmalıdır. Legacy migration dosyaları tek başına doğru kaynak kabul edilmemelidir; çalışan kod ile migration geçmişi arasında drift vardır.

Zorunlu mapping sırası:

1. `public.musteriler -> customers`
2. `public.musteriler -> customer_addresses` sentetik hedefi
3. `public.musteriler -> customer_external_identities`
4. `public.konusmalar -> conversations`
5. `public.mesajlar -> messages`
6. `public.urunler -> products`
7. `public.siparisler -> orders`
8. `public.siparis_kalemleri -> order_items`
9. `public.kargo_gonderimleri -> shipments`
10. Sonraki dilimlerde integrations ve diğer kullanılan tablolar

Catalog gereksinimleri:

- Her legacy tablo ve kolon açıkça tanımlanacak; bilinmeyen alan sessizce atılmayacak.
- Türkçe ve karma alanlar İngilizce canonical alanlara deterministik dönüştürülecek.
- Customer adı `ad + soyad`; boşsa `username`; o da boşsa deterministik fallback ve uyarı üretilecek.
- Legacy `adres`, `il`, `ilce`, `posta_kodu` alanlarından ayrı `customer_addresses` kaydı üretilecek.
- Adres bileşenleri tamamen boşsa adres kaydı üretilmeyecek.
- WooCommerce, KolayBi, Instagram ve Messenger dış kimlikleri account-scoped external identity kayıtlarına taşınacak.
- Conversation `musteri_id` zorunlu customer ID map üzerinden çözülecek.
- Conversation `atanan_kullanici_id` mevcut user map üzerinden çözülecek; çözülemeyen opsiyonel ilişki ayrı reconciliation kaydı ve rapor üretecek.
- `kanal`, `durum`, sender type ve diğer sınırlı değerler açık enum map ile dönüştürülecek; bilinmeyen değer apply’ı durduracak.
- `ig_account_id` doğru `integration_account_id` ile eşlenecek.
- Conversation account provider/channel uyumu doğrulanacak; Instagram konuşması yanlış provider account’una bağlanamayacak.
- Message `konusma_id` zorunlu conversation map üzerinden çözülecek.
- Legacy tarihleri korunacak; migration zamanı ile ezilmeyecek.
- Message sırası kaynak `id ASC` ve hedef `sent_at, id` kontrolleriyle doğrulanacak.
- `media_url/media_type` ile `medya_url/medya_tipi` drift’i introspection ile çözülecek.
- Medya ve kaynakta bulunan provider/gönderici alanları veri kaybetmeden `raw_payload` veya açık canonical kolonlarda korunacak.
- Bir source customer satırından customer, address ve birden fazla external identity üretilmesi `mapping_role` ile ayrı ayrı izlenecek.

Kabul kapısı: sentetik Türkçe/karma legacy PostgreSQL fixture’ı sıfır veri kaybıyla canonical hedefe taşınmalı; bilinmeyen kolon veya enum raporlu şekilde çalışmayı durdurmalı.

### P3. Migrator Transaction, Resume ve Validation Güvenliği

1. Canonical row, `legacy_id_map` ve batch checkpoint yazımları `v0.1.146` ile transaction içinde atomik hale getirildi.
2. Aynı migration run’ın paralel çalışmasını engelleyen PostgreSQL advisory lock `v0.1.146` ile eklendi.
3. Source okumalarını `REPEATABLE READ READ ONLY` snapshot içinde tut.
4. Offset tabanlı riskleri azalt; stabil primary-key cursor veya manifest ile sabitlenmiş aralık kullan.
5. P1'de tamamlanan persisted source manifest ile `readRows !== expectedRows` kontrolü target yazımından önce fail-closed çalışır; `v0.1.146` row-content fingerprintlerini manifest ve migration `005` ile persisted state kapsamına aldı.
6. P1 resume fingerprint temeli source identity, mapping version, plan, batch size ve source manifest hash içerir; `v0.1.146` row-content identity ve retry/resume idempotency kanıtını ekledi.
7. Retry sonrasında idempotent resume testleri `v0.1.146` ile eklendi; network-failure eşdeğeri recovery E2E kanıtı P4 gerçek PostgreSQL hattında `v0.1.154` ile tamamlandı.
8. Dry-run artık customer, conversation, message, product, order, order item ve shipment satırlarını transform/enum/FK/schema-gap kontrollerinden geçirir fakat target’a yazmaz.
9. Error ve report redaction testleri connection URL, password query parametreleri, token, header ve nested cause alanlarını `v0.1.146` ile kapsar.

Kabul kapısı: dry-run target bağlantısı açmadan gerçek uygulanabilirlik raporu üretmeli; apply tekrarlandığında duplicate oluşturmamalı; yarım batch atomik olarak geri alınmalı veya güvenli resume edilmelidir.

### P4. Apply Aktivasyonu ve Gerçek PostgreSQL E2E

Apply ancak şu koşulların tamamından sonra açılabilir:

- Migration `001`, `002` ve `003` temiz database üzerinde geçiyor.
- BIGINT runtime politikası uygulanmış.
- Source manifest/completeness doğrulaması aktif.
- İlk mapping catalog tamamlanmış ve versionlanmış.
- Legacy schema introspection bilinmeyen tablo/kolonları fail-closed yönetiyor.
- Zorunlu FK ve account resolution eksiksiz.
- Transaction, lock, resume fingerprint ve idempotency testleri geçiyor.
- Full dry-run validation geçiyor.
- Source ve target aynı database identity ise apply bağlantı açmadan reddediliyor.
- Secretsiz operasyon raporu üretiliyor.

Gerçek PostgreSQL E2E senaryoları:

- Türkçe ve karma isimli legacy fixture’dan temiz canonical database’e migration
- Dry-run target’a sıfır yazım
- Apply sonrası ikinci apply’da sıfır duplicate
- Yarım batch sonrası resume
- Farklı source ile aynı run ID reddi
- Farklı batch size veya mapping version ile resume reddi
- FK, orphan, duplicate, order total, shipment reference ve message ordering kontrolleri
- Unmapped field ve bilinmeyen enum reddi
- Manual compose profile dışında migrator’ın başlamaması
- Backup alınmadan production apply’ın operasyon runbook tarafından engellenmesi

### P5. Gerçek Frontend Taşıması

`apps/web` artık gerçek Vite/React uygulama shell'i olarak çalışır ve kritik müşteri akışlarını backend API, presigned upload/download ve Socket.IO sınırları üzerinden kanıtlar. Tüm legacy sayfaların birebir görsel/işlevsel portu ve görsel regresyon kapısı hâlâ tamamlanmış değildir; UI yeniden tasarlanmayacaktır.

Yayımlanan kanıt:

- `v0.1.157` ile backend-driven frontend shell, Vite entrypoint ve login/inbox/orders/shipments/admin/file upload/webphone browser E2E temeli eklendi.
- `v0.1.158` ile backend auth session restore ve logout akışı eklendi.
- `v0.1.159` ile inbox message list/send action backend API'ye bağlandı.
- `v0.1.160` ile order create ve shipment status update actionları backend API'ye bağlandı.
- `v0.1.161` ile admin setting update actionı backend API'ye bağlandı.
- `v0.1.162` ile URL tabanlı route davranışı eklendi.
- `v0.1.163` ile legacy navigation surface route'ları eklendi.
- `v0.1.164` ile `/giris`, `/sifre-sifirla`, `/gizlilik-politikasi`, `/kullanim-kosullari` ve `/veri-silme` route'ları backend shell içinde geri geldi.
- `v0.1.165` ile role-filtered navigation `admin` ve `kargo_operatoru` browser E2E üzerinden kanıtlandı. GitHub Actions run `37128356266`, tag `v0.1.165`, artifact `container-images-v0.1.165`, `411103422` byte, expired değil.
- `v0.1.167` ile legacy personel/kargo çevrimiçi-çevrimdışı davranışı backend-owned `/auth/presence` sınırına taşındı; auth serialization `is_online` döndürür, logout offline'a çeker, admin topbar toggle görmez, `kargo_operatoru` toggle browser E2E ile kanıtlanır. GitHub Actions run `37129351973`, tag `v0.1.167`, artifact `container-images-v0.1.167`, `411118295` byte, expired değil.
- `v0.1.169` ile admin `Entegrasyonlar` route'u backend admin integration-account API'sine bağlandı; listeleme ve `Instagram hesabı kaydet` upsert akışı browser E2E ile kanıtlandı. GitHub Actions run `37130025381`, tag `v0.1.169`, artifact `container-images-v0.1.169`, `411117537` byte, expired değil.
- `v0.1.171` ile admin integration account snapshot/detail ve access-token upsert akışı backend API'ye bağlandı; token değeri ekranda gösterilmeden maskeli kalır ve browser E2E ile kanıtlanır. GitHub Actions run `37130631339`, tag `v0.1.171`, artifact `container-images-v0.1.171`, `411126145` byte, expired değil.
- `v0.1.173` ile admin integration account settings write akışı backend API'ye bağlandı; `webhook.enabled` account setting değeri UI'dan kaydedilir, snapshot yeniden yüklenir ve browser E2E ile kanıtlanır. GitHub Actions run `37131273095`, tag `v0.1.173`, artifact `container-images-v0.1.173`, `411136746` byte, expired değil.
- `v0.1.175` ile core legacy shell route'ları için desktop/mobile visual frame smoke eklendi; inbox, orders, shipments, integrations ve webphone panellerinde boş frame, yatay taşma, topbar/workspace overlap ve nav collapse browser E2E ile reddedilir. GitHub Actions run `37131946791`, tag `v0.1.175`, artifact `container-images-v0.1.175`, `411061523` byte, expired değil.
- `v0.1.177` ile orders ve shipments yüzeylerine seçili detay panelleri eklendi; ilk fixture kaydı, create edilen order, ilk shipment hareketi ve delivered update sonrası shipment detail refresh browser E2E ile kanıtlandı. GitHub Actions run `37132827652`, tag `v0.1.177`, artifact `container-images-v0.1.177`, `411128687` byte, expired değil.
- `v0.1.179` ile inbox yüzeyine selectable conversation detail eklendi; seçili konuşma backend `listMessages` ile yeniden yüklenir, message send seçili conversation'a gider ve browser E2E conversation detail state'ini kanıtlar. GitHub Actions run `37133426940`, tag `v0.1.179`, artifact `container-images-v0.1.179`, `411102356` byte, expired değil.
- `v0.1.181` ile SMS yüzeyine NetGSM otomatik teyit araması ayar paneli eklendi; legacy `netgsm_teyit_ayarlar` Supabase write davranışı backend admin settings API'ye taşındı ve browser E2E `/admin/settings/netgsm_teyit_ayarlar` write akışını kanıtlar. GitHub Actions run `37134151255`, tag `v0.1.181`, artifact `container-images-v0.1.181`, `411103455` byte, expired değil.
- `v0.1.183` ile Arama/Santral yüzeyine SIP sunucu ayar paneli eklendi; legacy `sip_config` Supabase write davranışı backend admin settings API'ye taşındı ve browser E2E `/admin/settings/sip_config` write akışını kanıtlar. GitHub Actions run `37134841047`, tag `v0.1.183`, artifact `container-images-v0.1.183`, `411120486` byte, expired değil.
- `v0.1.185` ile Raporlar yüzeyine backend domain summary verilerinden KPI ve operasyon dağılımı paneli eklendi; browser E2E ciro, açık konuşma ve aktif kargo metriklerini kanıtlar. GitHub Actions run `37135646900`, tag `v0.1.185`, artifact `container-images-v0.1.185`, `411120231` byte, expired değil.
- `v0.1.187` ile Yorumlar yüzeyine backend conversation/message summary verilerinden yorum moderasyonu detayı eklendi; browser E2E müşteri, kanal ve son yorum metninin Supabase kullanmadan render edildiğini kanıtlar. GitHub Actions run `37136316941`, tag `v0.1.187`, artifact `container-images-v0.1.187`, `411111927` byte, expired değil.
- `v0.1.189` ile İptaller yüzeyine backend order summary verilerinden iptal inceleme detayı eklendi; browser E2E sipariş numarası, müşteri ve notun Supabase kullanmadan render edildiğini kanıtlar. GitHub Actions run `37136979553`, tag `v0.1.189`, artifact `container-images-v0.1.189`, `411093213` byte, expired değil.
- `v0.1.191` ile Stoklar yüzeyine backend order/shipment summary verilerinden stok ve sevkiyat sinyal detayı eklendi; browser E2E sipariş numarası, müşteri ve sevkiyat bağlı durumunu Supabase kullanmadan render edildiğini kanıtlar. GitHub Actions run `37137588211`, tag `v0.1.191`, artifact `container-images-v0.1.191`, `411113406` byte, expired değil.
- `v0.1.193` ile Bakiyeler ve VAPI AI yüzeylerine backend order/settings ve webphone/settings verilerinden detay panelleri eklendi; browser E2E bakiye tutarı, sipariş numarası, SIP domain, SIP kullanıcı ve model ayarı sınırını Supabase kullanmadan render edildiğini kanıtlar. `LegacySurfacePanel` helper'ı `apps/web` içinden tamamen kaldırıldı. GitHub Actions run `37138248828`, tag `v0.1.193`, artifact `container-images-v0.1.193`, `411103327` byte, expired değil.
- `v0.1.195` ile desktop/mobile visual frame browser E2E kapsamı tüm admin route yüzeylerine genişletildi; inbox, yorumlar, siparişler, kargo, iptaller, stok, bakiye, SMS, arama, VAPI AI, raporlar, entegrasyonlar, ayarlar, dosya ve santral ekranları panel boyutu, topbar overlap, yatay taşma ve nav collapse açısından doğrulanır. GitHub Actions run `37138891993`, tag `v0.1.195`, artifact `container-images-v0.1.195`, `411115579` byte, expired değil.
- `v0.1.197`-`v0.1.222` aralığında kargo operatoru mobile/desktop visual frame kapsamı, sipariş/kargo/report legacy summary parity, manual SMS preview, SMS history, balance payment summary, comments AI/platform summary, Instagram publish preview, products inventory parity, customer directory parity, backend file metadata verification ve Socket.IO realtime message parity eklendi. Son implementasyon checkpoint'i `v0.1.222`: GitHub Actions run `37165527542`, tag `v0.1.222`, artifact `container-images-v0.1.222`, `411106557` byte, expired değil.
- `v0.1.224`-`v0.1.234` aralığında provider attempt preview observability, admin audit trail visibility, operational policy settings, presigned download flow, orphan file candidate visibility ve provider live-gate catalog visibility eklendi. Son implementasyon checkpoint'i `v0.1.234`: GitHub Actions run `37169729534`, tag `v0.1.234`, artifact `container-images-v0.1.234`, `411123870` byte, expired değil.
- `v0.1.236` ile admin provider live gate write flow güvenli hale getirildi: UI canlı modu açan bir ifade kullanmaz, backend'e `providers.ptt.live_mode=false` yazar ve bu request body browser E2E ile kanıtlanır. GitHub Actions run `37170419902`, tag `v0.1.236`, artifact `container-images-v0.1.236`, `411106593` byte, expired değil.
- `v0.1.238`-`v0.1.266` aralığında shipment pipeline route parity, Sürat debug route parity, cargo cron debug route parity, inbox kanal/durum filtre parity, conversation state action parity, chat-to-order parity, inbox filter API query parity, order filter API query parity, shipment filter API query parity, cancellation status action parity, manual SMS send parity, shipment pipeline stateful tab parity, SMS template variable selector parity, balance payment request action parity ve provider cron dry-run trigger parity eklendi. Son implementasyon checkpoint'i `v0.1.266`: GitHub Actions run `37183631575`, tag `v0.1.266`, artifact `container-images-v0.1.266`, `411165488` byte, expired değil.

İş sırası:

1. Sıradaki gerçek frontend taşıma dilimi: kalan legacy sayfa/detay davranışlarını mevcut müşteri UI'sine karşı yeniden denetle ve ilk eksik aksiyonu backend API sınırına taşı. Yeni dilim doğrudan Supabase/table/storage/channel kullanmamalı, OpenAPI/web client mapping güncellenmeli ve browser/API-domain E2E request/response/UI kanıtı alınmalıdır.
2. Production Nginx/web container sunumu CI artifact içinde doğrulanır; release hattı yeşil kalmalıdır.
3. Supabase auth/table/storage/channel kullanımı kritik akışlarda backend auth/domain API/presigned S3/Socket.IO ile değiştirildi; kalan legacy sayfa portlarında aynı kural korunmalıdır.
4. Login, inbox conversation summary/detail/filter/state actions/chat-to-order, comments moderation detail, cancellation review detail, inventory signal detail, balances detail, VAPI AI detail, conversation/message send, order summary/detail, shipment summary/detail, reports KPI/detail, admin, NetGSM SMS settings, SIP config settings, integration account list/upsert/detail/settings/token masking, file upload, webphone ve personel presence ekran davranışları backend'e bağlıdır; `LegacySurfacePanel` kaldırılmıştır. Kalan iş gerçek legacy sayfa/detay görsel davranış parity'sini genişletmektir.
5. Repo genelinde doğrudan Supabase importu, URL’si, SDK kullanımı ve channel çağrısı kalmadığını guard ile kanıtlamaya devam et.
6. Legacy ve yeni uygulama arasında kritik ekran görsel regresyon kapsamını genişlet; `v0.1.195` ile tüm admin route yüzeyleri desktop/mobile frame stabilitesini kanıtlar, birebir eski ekran karşılaştırması hâlâ genişletilecek alandır.

Kabul kapısı: web container `/` adresinde gerçek uygulamayı döndürmeli; mevcut müşteri akışları görsel ve davranışsal olarak korunmalı; E2E browser testleri UI üzerinden çalışmalıdır.

### P6. Auth, Realtime ve Webphone Browser E2E

1. Browser login, refresh rotation, logout, revoked session, disabled user ve role denial senaryolarını çalıştır.
2. Socket.IO auth reject, reconnect, room membership, Redis fanout ve stale session disconnect senaryolarını gerçek browser/client akışıyla doğrula.
3. Conversation görüntüleme, mesaj gönderme, selected conversation refresh, unselected conversation broadcast refresh ve room join/leave komutları `v0.1.222` ile kanıtlandı; kalan realtime iş auth reject, reconnect, Redis fanout ve stale session disconnect kapsamıdır.
4. Admin ayarı değiştiğinde API/worker restart sonrası değerin PostgreSQL’den hydrate edildiğini kanıtla.
5. Instagram, Messenger ve WhatsApp hesap bağlantılarının restart sonrası kaybolmadığını E2E test et.
6. Webphone config permission, JsSIP/SIP boundary ve call-log persistence akışını gerçek SIP çağrısı yapmadan browser seviyesinde doğrula.
7. API’nin SIP media taşımadığını ve Socket.IO’nun job queue olarak kullanılmadığını koruyan sınır testlerini sürdür.

### P7. Canlı Provider Adapterları

Fixture kapsamı `15/15` olsa da canlı çağrılar kapalıdır. Adapterlar fixture handler yerine gerçek HTTP transport implementasyonlarını çalıştırmalıdır.

Uygulama sırası:

1. PTT
2. Sürat Kargo
3. KolayBi
4. Meta WhatsApp
5. Meta Instagram
6. Meta Messenger
7. NetGSM
8. Vapi ve gerekli SIP config provider sınırları

Her adapter için:

- Credential ve endpoint ayarlarını PostgreSQL’deki admin-managed integration account kayıtlarından yükle.
- Legacy çalışan request method/path/header/body biçimini değiştirme.
- Response normalizasyonunu ve webhook cevabını dondurulmuş contract ile koru.
- Yerel mock HTTP server ile method, path, header ve body birebir doğrula.
- Success, timeout, connection error, `429`, `5xx` ve malformed response testleri ekle.
- Her outbound attempt için süre, redacted request/response metadata, status ve retry kararı yaz.
- Non-idempotent çağrıyı idempotency key olmadan retry etme.
- Retry/dead-letter akışını BullMQ worker üzerinden yürüt.
- Provider/account bazlı canlı mod feature flag’i kullan.
- CI’da gerçek credential ve dış internet kullanma.

Kabul kapısı: contract testleri generic fixture handlerı değil gerçek adapterı mock server’a karşı çalıştırmalı; provider attempt persistence ve retry kararı database üzerinde doğrulanmalıdır.

### P8. Admin Tarafından Yönetilen Kalıcı Ayarlar

Database bağlantısı ve çekirdek altyapı sırları dışında operasyonel ayarlar admin UI üzerinden yönetilebilmelidir.

Kapsam:

- Provider hesapları ve credential rotasyonu
- Webhook config
- AI prompt ve model politikaları
- SIP/webphone config
- Provider/account canlı mod flagleri
- Rate limit, retry, timeout ve queue politikalarının izin verilen bölümü
- Object storage bucket/prefix ve upload politikalarının izin verilen bölümü
- Feature flags
- Integration account bağlantı durumu

Gereksinimler:

- PostgreSQL source of truth
- Application-managed encryption
- Masked API responses
- Audit old/new değerleri; secret alanlarda plaintext olmaması
- API ve worker restart hydration
- Multi-instance cache invalidation veya settings reload event’i
- Role/permission sınırları
- Hatalı config için schema validation ve güvenli rollback

### P9. Object Storage Kararı ve Dosya Akışı

MinIO yasaktır. Mevcut hedef Garage’dır.

Tamamlanacak işler:

- Garage deployment topolojisi ve kapasite modeli
- Bucket naming, tenant/prefix ayrımı ve lifecycle politikası
- Presigned upload/download contractları
- Multipart upload, content type, size limit, checksum ve malware scan sınırları
- File metadata ile object key atomikliği
- Orphan object reconciliation worker işi
- Backup/restore ve node kaybı tatbikatı
- Metrics, disk alerts ve capacity alerts
- S3 compatibility testleri ve failure injection

Kabul kapısı: upload/download browser E2E, restart persistence, orphan cleanup ve restore tatbikatı geçmelidir.

### P10. Observability ve Logging

- API request ID ile worker job ID, webhook event ID ve provider attempt ID korelasyonu kur.
- JSON structured log şemasını API, worker ve migrator için tekilleştir.
- Password, token, authorization header, cookie, connection string, presigned query ve provider secret redaction testlerini genişlet.
- Admin audit, integration audit ve provider attempt görünürlüğünü operasyon dashboardlarına bağla.
- Queue depth, retry, dead-letter, webhook latency, provider latency/error rate, websocket connection count ve migration progress metrics ekle.
- Health, readiness ve dependency health sinyallerini ayır.
- Alert eşikleri ve incident runbookları yaz.
- Log retention ve kişisel veri politikalarını tanımla.

### P11. Production Hazırlığı

Deployment:

- Tag tabanlı immutable image deployment
- Environment promotion ve config validation
- Database migration öncesi backup kapısı
- Önceki taga rollback runbook
- Schema rollback mümkün değilse forward-fix politikası
- API/worker graceful drain ve zero-downtime rollout

Data safety:

- PostgreSQL otomatik backup, PITR ve düzenli restore tatbikatı
- Garage backup/replication ve restore tatbikatı
- Redis’in source of truth olmadığının korunması
- Migrator source/target backup ve hashlenmiş manifest arşivi

Performance:

- API, websocket, worker queue, provider adapter ve database load testleri
- Connection pool, statement timeout, queue concurrency ve backpressure ayarları
- Büyük conversation/message ve order veri setleri için query plan incelemesi
- File upload/download kapasite testi

Security:

- Dependency ve container vulnerability taraması
- Secret rotation runbook
- Auth/session threat testleri
- RBAC/permission matrix testi
- Webhook signature ve replay koruması
- SSRF, SQL injection, stored XSS, upload abuse ve rate-limit testleri
- Audit log bütünlüğü ve erişim sınırları

CI maintenance:

- GitHub Actions JavaScript runtime için Node sürüm uyarısını takip et ve action sürümlerini güncelle.
- `ubuntu-latest` ortamının Ubuntu 26 geçişini sabit image veya doğrulanmış uyumlulukla yönet.
- Node 22 ve Docker build davranışını yeni runner image üzerinde önceden test et.
- Tag yaratma adımının yalnız tüm test ve artifact paketleme başarılarından sonra çalıştığını koru.

## 6. Resume Kontrol Komutları

Yeni sohbet ilk olarak şu kontrolleri çalıştırmalıdır:

```bash
cd /Users/furkanmeclis/Documents/Projects/garanti-kulucka-ecosystem
git status --short --branch
git rev-parse HEAD
git tag --sort=-v:refname | head -10
git diff --stat
git diff --name-only
git diff --check
```

Beklenen yayımlanmış taban:

```text
51f7fdc831f594c5177ed34c700496b40e92e529
v0.1.155
```

Aktif schema checkpoint kaybolmuşsa otomatik olarak yeniden üretme. Önce `git status`, `git reflog`, stash, başka worktree ve kullanıcı tarafından bırakılmış değişiklikleri araştır. Mevcut değişiklikleri koru.

Hızlı checkpoint doğrulaması:

```bash
npm run typecheck -w @garanti-kulucka/database
npm run test:unit -w @garanti-kulucka/database
npm run typecheck -w @garanti-kulucka/migrator
npm run test:unit -w @garanti-kulucka/migrator
npm run test:migrator
npm run verify:structure
git diff --check
```

Tam release doğrulaması:

```bash
npm run check
```

CI ve tag kontrolü:

```bash
gh run list --branch main --limit 5 --json databaseId,headSha,status,conclusion,displayTitle,createdAt
gh run watch <run-id> --exit-status
git fetch --tags origin
git tag --sort=-v:refname | head -10
gh api repos/furkanmeclis/garanti-kulucka-ecosystem/actions/runs/<run-id>/artifacts
```

## 7. Commit ve Release Çalışma Akışı

Her bağımsız dilim için:

1. Başlamadan `git status --short --branch` ve ilgili diff’i incele.
2. Kullanıcının mevcut değişikliklerini koru; görev dışı dosyaları değiştirme.
3. Hedefli testleri çalıştır.
4. Tam `npm run check` çalıştır.
5. Playwright veya build çıktılarının ürettiği geçici dosyaları kapsamı doğrulayarak temizle; tracked kullanıcı dosyalarını silme.
6. `git diff --check` ve `git status` ile commit kapsamını doğrula.
7. Yalnız onaylanmış dosyaları stage et.
8. Küçük ve açıklayıcı commit oluştur.
9. `main` dalına pushla.
10. GitHub Actions tamamlanana kadar izle.
11. Otomatik tag’in bir kez oluştuğunu ve API, worker, migrator ile web için dört `.tar.gz` arşivi içeren tek `container-images-vX.Y.Z` artifact’inin mevcut olduğunu doğrula.
12. Roadmap/handoff durumunu ayrı docs checkpoint’iyle güncelle; docs commit’inin CI ve tag sonucunu da doğrula.

Branch veya PR oluşturma. Başarısız CI commit’ini taglenmiş gibi kaydetme. Çalışma ağacındaki yayımlanmamış işi roadmapte release olarak gösterme.

Önerilen commit ayrımı:

- Schema/migration düzeltmesi
- Migrator mapping veya safety dilimi
- Frontend domain taşıma dilimi
- Provider adapter dilimi
- Operasyon/deployment dilimi
- Her büyük implementation checkpoint’inden sonra dokümantasyon senkronu

## 8. Apply Aktivasyon Kontrol Listesi

Bu listenin tamamı işaretlenmeden `migrate --apply` açılmayacaktır:

- [x] `001 -> 002 -> 003` temiz PostgreSQL migration zinciri başarılı
- [x] BIGINT runtime type politikası tamam
- [x] Source schema introspection tamamlanan legacy dry-run entity'leri için tamam
- [x] Source manifest ve completeness doğrulaması tamam
- [ ] Customer mapping tamam
- [ ] Customer address sentetik mapping tamam
- [ ] External identity account resolution tamam
- [ ] Conversation mapping ve account/provider uyumu tamam
- [ ] Message mapping ve media/medya drift çözümü tamam
- [ ] Zorunlu FK çözümleme ve deferred reconciliation tamam
- [x] Atomic transaction ve concurrent-run lock tamam
- [x] Resume fingerprint, row-content persistence ve retry idempotency tamam
- [x] Full-transform dry-run validation tamamlanan P2 legacy entity'leri için tamam
- [x] Secret redaction ve operation report testleri tamam
- [x] Gerçek PostgreSQL source/target dry-run E2E tamam
- [x] Gerçek PostgreSQL recovery E2E tamam
- [x] Backup ve restore runbook tatbikatı tamam
- [x] P4 evidence checkpoint'i için full `npm run check` başarılı
- [ ] Production apply açılışı öncesi final full `npm run check` başarılı

## 9. Tamamlanmış ve Yeniden Yapılmayacak Temeller

- Hono API bootstrap ve backend route sınırları
- PostgreSQL canonical temel şema
- Backend auth/session/permission temelleri
- Encrypted admin settings ve integration persistence temelleri
- Restart-hydratable integration snapshots
- File metadata ve presigned S3-compatible upload instruction sınırı
- Socket.IO event contractları ve Redis fanout sınırı
- SIP/WebRTC media’nın API dışında tutulması
- BullMQ worker ve webhook queue publishing
- Provider fixture kapsamı `15/15`
- Provider/channel catalog parity guardları
- Provider attempt persistence ve redacted admin görünürlüğü
- Migrator manual container profili ve source-only dry-run güvenlik temeli
- OpenAPI backend route contractı
- Main-only CI, otomatik semantic tag ve API, worker, migrator ile web için dört `.tar.gz` arşivi içeren tek `container-images-vX.Y.Z` artifact’i

Bu maddeler ihtiyaç varsa genişletilir; mevcut davranış sebepsiz yere yeniden yazılmaz.

## 10. Bir Sonraki Sohbet İçin İlk Somut Görev

İlk görev production apply prerequisites dilimidir:

1. Yayımlanmış `v0.1.155` P4 evidence checkpoint'ini taban kabul et. Apply kapalı kalsın.
2. Customer address ve external identity target'larını descriptive durumdan çıkaracak executable fan-out write tasarımını yap.
3. Public-id-to-FK resolution, account snapshot enforcement, multi-record customer writer ve per-target `legacy_id_map.mapping_role` semantiğini customer apply prerequisite olarak birlikte ele al.
4. Önce fail-closed catalog/test kapsamını genişlet, sonra gerçek PostgreSQL E2E ile duplicate üretmeyen retry/resume davranışını kanıtla.
5. Production `migrate --apply` yalnız checklist'in kalan mapping, FK, reconciliation ve final full-check maddeleri geçince açılabilir; frontend migration ve live provider adapter tracks bu kapıdan bağımsız fakat aynı CI/tag disiplininde ilerler.

P4 evidence tamamlanmıştır. Production yazım kapısı, kalan apply prerequisites bitmeden fail-closed kalır.
