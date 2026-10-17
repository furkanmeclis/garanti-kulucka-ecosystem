# Legacy Veri Kontrolü ve Gerçek Veri Dry-run (2026-10-11)

Bu belge, canlı legacy veritabanının dump'ı üzerinde yapılan kontrolün, ilk tam dry-run'ın ve kullanıcı onaylı eşleme kararlarının kalıcı kaydıdır. Kişisel veri, bağlantı dizesi ve sır içermez. Dump, yerel kopya ve kullanıcı listesi repo dışında, operatör makinesinde tutulur.

## Dump

- Kaynak: Supabase Postgres 15.8, `public` şeması, 2026-10-11 12:49 +03. Custom format, 2,0 GB (ham veri 3,69 GB).
- SHA-256 kayıtlı değerle aynı; `pg_restore --list` hatasız (508 TOC girdisi, 32 tablo), tüm veri blokları eksiksiz açıldı.

| Tablo | Satır |
| --- | --- |
| `kargo_takip` | 6.815.246 |
| `mesajlar` | 412.683 |
| `musteriler` | 73.887 |
| `konusmalar` | 73.668 |
| `islem_kayitlari` | 22.704 |
| `islem_loglari` | 8.994 |
| `siparisler` | 4.695 |
| `kargo_gonderimleri` | 4.435 |
| `bakiye_hareketleri` | 4.289 |
| `siparis_kalemleri` | 3.799 |
| `sms_gonderimler` | 270 |
| `arama_kayitlari` | 192 |
| `kisayollar` | 53 |
| `vapi_aramalar` | 21 |
| `kullanicilar` | 16 |
| `urunler` | 15 |
| `stocks` | 14 |
| `settings` | 11 |
| `kargo_pipeline_kuyrugu`, `sms_sablonlar` | 5'er |
| `ayarlar` | 4 |
| `odeme_istekleri`, `roller` | 3'er |
| Diğer 9 tablo | 0 |

### `kargo_takip` tekrarı

6.815.246 satırın yalnız 43.325'i benzersiz (kargo + durum + açıklama + lokasyon); %99,4 tekrar. Legacy kargo takip cron'u aynı hareketleri her çalışmada yeniden ekliyor; canlı veritabanındaki ~2 GB şişmenin sebebi bu. Migrator bu tabloyu tekilleştirerek taşır.

### Düz PostgreSQL'e yükleme

Supabase'e özgü bağımlılıklar: `extensions.uuid_generate_v4()` (21 yer), `auth.uid()`/`auth.role()` kullanan 31 RLS politikası, `auth.users`'a 2 FK (`kullanicilar.auth_id`, `stock_movements.performed_by`), Supabase rollerine ACL'ler. Yükleme `--no-owner --no-acl` ile, POLICY / ROW SECURITY / `auth.users` FK'leri TOC listesinden çıkarılarak, `extensions` şeması (`uuid-ossp`, `pgcrypto`) ve `auth.uid()/role()` taslakları önceden oluşturularak yapıldı. 32 tablonun satır sayıları dump ile birebir.

## Dry-run sonuçları

Ayrı bir yerel PostgreSQL 18.4 kopyası üzerinde, target'a bağlanmadan.

- **#1 (kullanıcı eşlemesiz):** `passed`, 12,7 dk, 617.905 planlı satır, 621 parti, blokaj 0, uyarı 0.
- **#2 (kullanıcı eşlemeli, `MIGRATION_USER_PUBLIC_IDS_FILE`):** `passed`, 11,8 dk, blokaj 0, uyarı 0. Atanmamış konuşma 13.401 → 0, oluşturanı çözümsüz sipariş 4.695 → 0.

| Alan | Sonuç |
| --- | --- |
| Müşteri | 73.887; adres taslağı 149; IG/Messenger dış kimliği çözümsüz 48.494 (hesap eşlemesi bekliyor) |
| Konuşma | 73.668; IG hesabıyla eşleşen 1.489 |
| Mesaj | 412.683; medyalı 14.201; inline base64 1.394 (~1,88 GB: png 941 MB, mp4 828 MB, jpeg 112 MB, pdf 0,7 MB); uzak URL 4.104 |
| Ürün | 15; pasif 1; aynı KolayBi id'li 1 grup |
| Sipariş | 4.695; telefonla müşteriye bağlanan 2.304; sentetik müşteri 2.379 |
| Sipariş kalemi | 3.799; ürünle eşleşen 1.192, eşleşmeyen 2.607; kalemsiz sipariş 913; tutar farkı 60 siparişte toplam −29.930,66 TL |
| Kargo | 4.435 (PTT 3.853, Sürat 582); takip no ile siparişe bağlanan 3.929, belirsiz 92, eşleşmeyen 414; takip no'lu ama kargosuz sipariş 286 |
| Kargo hareketi | 6,8 M satır → 44.704 olay (sağlayıcı zamanlı 8.064, ilk görülme 36.640); gelecek tarihli 19 |

**Rapor eksikliği:** `shipmentTrackingEventTransform.transformedRows` = 4.468.249. Tekilleştirmede atılan 2.346.978 kopya satır rapordaki hiçbir sayaca girmiyor (veri kaybı değil, bilerek atılan kopyalar; ama raporda görünmeli).

## Eşleme kararları (kullanıcı onayı, 2026-10-11)

- **9a Tutar farkı:** siparişin kendi tutarı esas; fark `orders.manual_adjustment_amount` (60 sipariş).
- **9b Müşterisi olmayan sipariş:** önce telefonla mevcut müşteriye bağla, olmazsa siparişteki bilgilerden sentetik müşteri.
- **9c Kalem ürünü:** eşleşmeyen kalem ad ve fiyatıyla ürün bağı olmadan taşınır; kalemsiz sipariş tutarıyla taşınır; aynı KolayBi id'li ürünlerde deterministik seçim.
- **9d Kargo–sipariş bağı belirsiz/eşleşmeyen:** kargo taşınır, siparişe bağlanmaz (deferred); geçiş sonrası panelde kontrol listesi.
- **9e Kargo hareketleri:** tekilleştir (sağlayıcı zamanı, yoksa ilk görülme).
- **9f Panel kanalı / `calisan` → `user`:** mevcut eşleme.
- **Kullanıcılar:** 16 legacy kullanıcının hepsi taşınır (rol: admin 2, calisan 13, kargo_operatoru 1). Migrator kullanıcı taşımaz; apply'dan önce bu kullanıcılar yeni sistemde planlanan `usr_` public id'leriyle oluşturulmalıdır. Legacy Supabase şifreleri taşınmaz, kullanıcılar şifre sıfırlama akışını kullanır.

## Migrator hazırlık bulguları

Test kanıtı (2026-10-11): migrator birim testleri 23 dosya / 502 test, `tests/migration` gerçek PostgreSQL 9 dosya / 11 test (customer fan-out, conversation+message, order/product/shipment apply, tam komut apply + idempotent tekrar + yarıda kalan resume, recovery, backup/restore) geçti.

Performans riskleri (kod okuması, ölçülmedi):

1. **Bellek:** `trackSourceRowContent` her kaydı bellekte biriktiriyor; apply checksum için tüm partileri iki kez okuyor. Inline medya RAM'e giriyor → büyük veride OOM riski.
2. **Sayfalama:** `OFFSET` tabanlı (O(n²)); `afterSourceId` `id::text > $2` kullanıyor, uuid indeksini kullanamıyor. Kargo partisi başına ~10 sn yeniden gruplama.
3. **Uzun kaynak transaction'ı:** tek `REPEATABLE READ` bağlantısı tüm çalışma boyunca açık; kopmada tüm run yeniden okunur.
4. **Hedef yazımı satır satır:** FK başına ayrı sorgu (N+1), tekil insert/upsert.
5. **Medya:** sıralı tekil S3 PUT/HEAD.
6. **Resume:** parti içi ilerleme, seçici entity yeniden çalıştırma ve ETA raporu yok; gerçek ölçekli benchmark yok.

Önerilen sıra: akışlı checksum (O1), keyset sayfalama (O2), toplu hedef yazımı ve FK önbelleği (O3), sınırlı paralel medya hattı (O4), kısa transaction'lar + yeniden bağlanma (O5). Her biri apply semantiği değişmeden, fingerprint eşitliği regresyon testiyle.

## Açık kararlar

- Migrator'ın okumadığı tablolar (`ayarlar`, `bakiye_hareketleri`, `cari_hesaplar`, `faturalar`, `stok_hareketleri`, `sosyal_yorumlar`, `vapi_*`, `teyit_aramalari`, `arama_kayitlari`, `odeme_istekleri`, `kargo_pipeline_kuyrugu`, `kisayollar`, log tabloları): ilk geçişe dahil mi, sıfırdan mı?
- Hedefte açılacak `integration_accounts` (dry-run'da yer tutucu id'ler kullanıldı).
- Medya: 1,88 GB inline base64 Garage'a; 4.104 süreli Meta CDN linki indirilecek mi, yalnız URL mi kalacak?
- Geçiş stratejisi: tek seferlik donma penceresi mi, delta senkron mu? Migrator bugün yalnız tam snapshot yapıyor.
- Hedef ortam (staging PostgreSQL + Garage) ve migrator konteyneri için kaynak sınırları.
