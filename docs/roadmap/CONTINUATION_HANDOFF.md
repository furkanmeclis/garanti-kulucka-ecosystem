# Garanti Kulucka Ecosystem Continuation Handoff

Bu belge, projeye yeni bir sohbetten veya bağlamsız bir çalışma oturumundan devam etmek için tek devam kaynağıdır. Önce bu dosya, ardından `MASTER_ROADMAP.md` ve yalnız çalışılacak fazın ilgili teknik belgeleri okunmalıdır. Buradaki yayımlanmış durum ile çalışma ağacındaki yayımlanmamış durum birbirine karıştırılmamalıdır.

## 1. Proje Kimliği ve Güncel Durum

- Repo: `/Users/furkanmeclis/Documents/Projects/garanti-kulucka-ecosystem`
- GitHub çalışma modeli: monorepo, yalnız `main`, PR yok.
- Yayımlanmış son checkpoint: `v0.1.128`
- Yayımlanmış son commit: `864840ccdbbe507bbe276264f2a7ec676ee5ba4f`
- Commit mesajı: `feat(migrator): catalog legacy conversation tables`
- Genel ilerleme: yaklaşık `%75`
- Son tamamlanan çalışma: `public.konusmalar` ve `public.mesajlar` için fail-closed kolon sözleşmesi. Catalog sürümü `p2-conversation-catalog-v1`. Müşteri 15 kolon sözleşmesi değişmedi.
- Sıradaki bağımlılık kapısı bu iki tablonun satır dönüşümüdür: zorunlu customer ve conversation ID-map çözümlemesi, account/provider uyumu ve bilinmeyen enum reddi. Dry-run bu tabloları şimdilik sayar; satır dönüşümü henüz yoktur.
- Kolon listesi numaralı legacy migration’lar ve Instagram `human_agent` ekinden çıkarılmıştır. Canlı `information_schema` dökümü henüz alınmamıştır. Uyuşmayan kolon dry-run’ı durdurur.
- Production `migrate --apply` kapısı kapalıdır. Tüm aktivasyon koşulları geçmeden açılmamalıdır.

`%75` tahmini; API, worker, auth temelleri, admin persistence, Socket.IO sınırları, fixture tabanlı provider sözleşmeleri, CI/tag otomasyonu, container buildleri, migrator dry-run güvenlik temeli, P1 source manifest/completeness, P2 customer introspection, customer row transform, account snapshot resolution ve customer dry-run validation dilimlerini içerir. Conversation ve message catalogları, gerçek frontend taşıması, canlı provider adapterları, P3 transaction snapshot isolation ile source row-content checksum/idempotency ve P4 production veri taşıma aktivasyonu tamamlanmış kabul edilmez.

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
- Customer apply, `customer_external_identities` descriptive veya tanımsızken orchestrator’da fail-closed durur.
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

Durum: customer schema introspection `v0.1.122`, customer row transform `v0.1.124`, account resolution ve customer dry-run validation `v0.1.126`, conversation ve message kolon sözleşmesi `v0.1.128` ile yayımlandı. Catalog sürümü `p2-conversation-catalog-v1`. Tam P2 tamamlanmadı. `customers`, `conversations` ve `messages` dry-run-ready’dir. Address ve external identity hedefleri descriptive kalır. Dry-run `public.musteriler` satırlarını dönüştürür. `konusmalar` ve `mesajlar` satırları henüz dönüştürülmez; yalnız sayılır ve kolon sözleşmesi doğrulanır.

Önce kaynak database gerçek yapısı `information_schema` üzerinden çıkarılmalıdır. Legacy migration dosyaları tek başına doğru kaynak kabul edilmemelidir; çalışan kod ile migration geçmişi arasında drift vardır.

Zorunlu mapping sırası:

1. `public.musteriler -> customers`
2. `public.musteriler -> customer_addresses` sentetik hedefi
3. `public.musteriler -> customer_external_identities`
4. `public.konusmalar -> conversations`
5. `public.mesajlar -> messages`
6. Sonraki dilimde orders, order items, shipments, products, integrations ve diğer kullanılan tablolar

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

1. Canonical row, `legacy_id_map` ve batch checkpoint yazımlarını transaction içinde atomik hale getir.
2. Aynı migration run’ın paralel çalışmasını PostgreSQL advisory lock veya eşdeğer lease ile engelle.
3. Source okumalarını `REPEATABLE READ READ ONLY` snapshot içinde tut.
4. Offset tabanlı riskleri azalt; stabil primary-key cursor veya manifest ile sabitlenmiş aralık kullan.
5. P1'de tamamlanan temel: persisted source manifest ile `readRows !== expectedRows` kontrolü target yazımından önce fail-closed çalışır. P3'te kalan iş: bu garantiyi transaction snapshot isolation ve source row-content checksum ile aynı tutarlı kaynak görünümüne bağla.
6. P1'de tamamlanan temel: resume fingerprint source identity, mapping version, plan, batch size ve source manifest hash içerir. P3'te kalan iş: fingerprint'i snapshot/row-content kimliğiyle güçlendir ve process/network retry sonrasında tam idempotency kanıtını tamamla.
7. Yarım yazım, process kill, network failure ve retry sonrasında idempotent resume testleri ekle.
8. Dry-run yalnız count üretmemeli; tüm satırları transform, enum, zorunlu alan, FK çözümleme, duplicate ve schema-gap kontrollerinden geçirmeli fakat target’a yazmamalı.
9. Error ve report redaction testleri connection URL, password query parametreleri, token, header ve nested cause alanlarını kapsamalı.

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

`apps/web` şu anda esas olarak typed client sınırıdır; müşterinin çalışan frontend’i henüz gerçek uygulama olarak buraya taşınmış değildir. UI yeniden tasarlanmayacaktır.

İş sırası:

1. Legacy frontend sayfalarını, routing yapısını, stilleri ve assetleri görsel davranışı koruyarak `apps/web` içine al.
2. Çalışır browser entrypoint, `index.html`, build assetleri ve production Nginx sunumunu tamamla.
3. Supabase auth çağrılarını backend auth clientına geçir.
4. `supabase.from` sorgularını domain API clientlarına geçir.
5. Supabase storage kullanımını backend presigned S3 akışına geçir.
6. Supabase channel kullanımını Socket.IO clientına geçir.
7. Login, inbox, conversation, message send, order, shipment, admin, file upload, integration account ve webphone ekranlarını backend’e bağla.
8. Repo genelinde doğrudan Supabase importu, URL’si, SDK kullanımı ve channel çağrısı kalmadığını guard ile kanıtla.
9. Legacy ve yeni uygulama arasında kritik ekran görsel regresyon testleri oluştur.

Kabul kapısı: web container `/` adresinde gerçek uygulamayı döndürmeli; mevcut müşteri akışları görsel ve davranışsal olarak korunmalı; E2E browser testleri UI üzerinden çalışmalıdır.

### P6. Auth, Realtime ve Webphone Browser E2E

1. Browser login, refresh rotation, logout, revoked session, disabled user ve role denial senaryolarını çalıştır.
2. Socket.IO auth reject, reconnect, room membership, Redis fanout ve stale session disconnect senaryolarını gerçek browser/client akışıyla doğrula.
3. Conversation görüntüleme ve mesaj gönderme sonrasında realtime güncellemesini doğrula.
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
864840ccdbbe507bbe276264f2a7ec676ee5ba4f
v0.1.128
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
- [ ] Source schema introspection tamam
- [x] Source manifest ve completeness doğrulaması tamam
- [ ] Customer mapping tamam
- [ ] Customer address sentetik mapping tamam
- [ ] External identity account resolution tamam
- [ ] Conversation mapping ve account/provider uyumu tamam
- [ ] Message mapping ve media/medya drift çözümü tamam
- [ ] Zorunlu FK çözümleme ve deferred reconciliation tamam
- [ ] Atomic transaction ve concurrent-run lock tamam
- [ ] Resume fingerprint ve idempotency tamam (P1 fingerprint temeli hazır; P3 transaction snapshot isolation, source row-content checksum, process/network retry ve tam idempotency kanıtı bekliyor)
- [ ] Full-transform dry-run validation tamam
- [ ] Secret redaction ve operation report testleri tamam
- [ ] Gerçek PostgreSQL source/target E2E tamam
- [ ] Backup ve restore runbook tatbikatı tamam
- [ ] Full `npm run check` başarılı

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

İlk görev P2 conversation ve message satır dönüşümüdür:

1. Yayımlanmış `v0.1.128` kolon sözleşmesini taban kabul et. `p2-conversation-catalog-v1` sürümünü ve müşteri 15 kolon sözleşmesini koru.
2. `public.konusmalar` ve `public.mesajlar` satırlarını canonical draft’lara çevir. Zorunlu customer ve conversation kimlikleri çözülemezse satırı durdur. Opsiyonel atanmış kullanıcı çözülemezse reconciliation kaydı üret ve satırı düşürme.
3. `kanal`, `durum` ve gönderici tipi için açık enum haritası kullan. Bilinmeyen değer fail-closed durur. `ig_account_id` yalnız Instagram konuşmasında ve eşleşen aktif hesaba bağlanır.
4. Dry-run bu satırları da dönüştürsün, target’a yazmasın. Apply kapalı kalsın.
5. Commit/push sonrası CI, yeni tag ve artifact’i doğrula. P3 ve P4 kapılarını açık tut.

P2 mapping ve introspection kabul kapısı tamamlanmadan P3 güvenlik çalışmalarına veya apply aktivasyonuna geçilmemelidir. P1 resume guard tamamlanmış olsa da tam resume/idempotency aktivasyon maddesi P3 transaction snapshot isolation ve source row-content checksum/idempotency kanıtları bitene kadar açık kalır.
