# Migrator

Eski veriyi yeni canonical PostgreSQL semasina tasiyan manuel calistirilan container.

Backend feature degildir.

Beklenen komutlar:

```bash
docker compose run --rm migrator migrate --dry-run
docker compose run --rm migrator verify
```

Opsiyonel komut raporu:

```bash
docker compose run --rm migrator migrate --dry-run --report-file reports/migration_dry_run.json
docker compose run --rm migrator verify --report-file reports/migration_verify.json
```

Dry-run legacy source baglantisini ve opsiyonel snapshot dosyalarini ister:

```bash
SOURCE_DATABASE_URL=postgres://legacy-readonly@legacy/legacy
MIGRATION_BATCH_SIZE=500
MIGRATION_SOURCE_SYSTEM=legacy_postgres
MIGRATION_CONVERSATION_ACCOUNTS_FILE=/snapshots/conversation_accounts.json
MIGRATION_USER_PUBLIC_IDS_FILE=/snapshots/user_public_ids.json
```

- `SOURCE_DATABASE_URL` zorunludur. Source okumalari `REPEATABLE READ READ ONLY` transaction icinde yapilir.
- `migrate --dry-run` source row count'larini okuyup batch planini kurar, sonra `public.musteriler`, `public.konusmalar`, `public.mesajlar`, `public.urunler`, `public.siparisler`, `public.siparis_kalemleri`, `public.kargo_gonderimleri` ve `public.kargo_takip` satirlarini canonical taslaklara/rapor ozetlerine donusturur. Target URL cozmez, target baglantisi acmaz ve veri yazmaz.
- Source okumalari tek snapshot icinde oldugu icin tablolar ardisik batch'lerde keyset ile okunur (`id > onceki batch'in son id'si`); plan ve batch state hala `offset` tasir, ardisik olmayan ilk okuma (resume, tekrar okuma) OFFSET'e duser. `public.kargo_takip` aggregate'i run basina bir kez `SCROLL` cursor'a hesaplanir; count, tum batch'ler ve apply'in ikinci okumasi bu cursor'dan `MOVE ABSOLUTE`/`FETCH` ile okunur (cursor transaction'a aittir, yazma gerektirmez).
- `shipmentTrackingEventTransform` her ham `kargo_takip` satirini hesaba katar: `sourceRows = transformedRows + supersededInsertTimeRows + undatedRows`. `transformedRows` event'lerin ve gelecek tarihli marker'larin `raw_row_count` toplamidir; `supersededInsertTimeRows` ayni (kargo_id, durum, lokasyon, aciklama) grubunda saglayici zamanli (tam saniye) satiri olan insert-zamanli kopyalardir (event'leri provider satirindan gelir, ayrica tasinmaz); `undatedRows` `tarih` bos satirlardir. Esitlik bozulursa dry-run fail-closed durur. `duplicateRowsDropped = duplicateRows + supersededInsertTimeRows` toplam atılan kopyayı dry-run ve apply raporunda gösterir; `sourceRows = uniqueEvents + duplicateRowsDropped + futureDatedRows + undatedRows`.
- Mesaj medyası (Faz B kararı): inline `data:` ve bridge `s3://` dosyaları **taşınmaz**. Upload, download ve HEAD yapılmaz; mesaj apply için Garage/S3 yapılandırması gerekmez. Mesajın metni ve tarihi korunur; türe göre `📎 Görsel/Video/Ses kaydı/Belge (eski sistemden taşınmadı)` notu metnin sonuna eklenir (boş metinde yalnız not). `raw_payload.media_omitted` tür, MIME ve inline decoded byte sayısını taşır; bridge boyutu kaynakta bulunmadığından `null` kalır. Base64 ve bridge URI hedefe yazılmaz; fallback `medya_url` içindeki base64 de temizlenir. http(s) URL'ler yalnız referans olarak korunur, indirilmez. Live `media_url`/`media_type` birincil, `medya_url`/`medya_tipi` fallback; çelişkiler raporlanır.
- Dry-run `inlineMediaPayloads`, `inlineMediaDecodedBytesByMime`, `legacyObjectMediaPayloads`/`legacyObjectMediaByMime` ve `remoteUrlMediaPayloads` sayaçlarını korur. Taşınmayacak bridge URI'leri storage erişimi veya bucket doğrulaması gerektirmez. Mesaj payload'ları checksum ön geçişinde biriktirilmez.
- Sipariş müşterisi önce `musteri_id`, sonra son 10 telefon hanesiyle tek mevcut müşteri üzerinden çözülür. Kalanlar için normalize telefon başına tek sentetik müşteri (10 haneden kısa ama rakam içeren legacy numara da telefon kimliğidir), telefonsuz sipariş başına ayrı müşteri oluşturulur. Snapshot ön geçişi en yeni sipariş adını, farklı eski adları müşteri notunda ve adres içeren en yeni siparişin adresini varsayılan `customer_addresses` kaydı olarak seçer (`TR` ülke normalizasyonu). Telefon kimliği `legacy_id_map` içinde `public.siparisler` / `phone:<son10>` ve `synthetic_customer` / `synthetic_customer_address` rolleriyle saklanır; telefonsuzda sipariş UUID'si kullanılır. Müşteri ve adres siparişten önce, aynı parti transaction'ında yazılır; tekrar/resume çoğaltmaz. Dry-run `syntheticCustomersFromOrders` sipariş sayısı, `syntheticCustomers` tekil müşteri sayısı, `syntheticPhoneCustomers` ve `syntheticPhonelessCustomers` dağılımıdır.
- Siparis toplaminda canonical order tutari otoritatiftir. VAT dahil kalem toplami ile fark varsa `orders.manual_adjustment_amount` alanina yazilir ve raporda uyari olarak sayilir; siparis kalemi olmayan siparisler ayri `ordersWithoutItems` sayacina girer.
- Donusturulemeyen bir satir dry-run'i durdurur. Hata mesajina musteri bilgisi, mesaj metni veya kanal external id degerleri yazilmaz.
- `MIGRATION_CONVERSATION_ACCOUNTS_FILE` opsiyoneldir. Dosya konusmalarin baglanacagi integration account listesini iceren bir JSON dizisidir:

```json
[
  { "publicId": "iac_whatsapp_main", "providerKey": "whatsapp", "status": "active", "externalAccountId": null },
  { "publicId": "iac_instagram_main", "providerKey": "instagram", "status": "active", "externalAccountId": "17841400000000000" }
]
```

- `providerKey` `whatsapp`, `messenger` veya `instagram`; `status` `active` veya `inactive` olmalidir. `publicId` `iac_` ile baslar ve listede tekrar etmez.
- WhatsApp ve Messenger konusmalari o provider'daki tek aktif hesaba baglanir. Instagram konusmalari `ig_account_id` degeri `externalAccountId` ile eslesen tek aktif hesaba baglanir. Panel konusmalari hesap istemez.
- Panel disi bir konusma icin eslesen aktif hesap yoksa veya birden fazla hesap eslesirse dry-run fail-closed durur. Dosya verilmezse hesap listesi bos kabul edilir; bu durumda WhatsApp, Messenger veya Instagram konusmasi olan her source hata verir ve hata `MIGRATION_CONVERSATION_ACCOUNTS_FILE` degiskenini isaret eder.
- Ayni dosya musteri dis kimliklerinin (`telefon` alanindaki `ig_`/`fb_` yer tutuculari) hesap listesinin de tek kaynagidir: CLI dosyadaki `instagram` ve `messenger` girdilerini (`publicId`, `providerKey`, `status`) dry-run ve apply'a musteri kimlik hesaplari olarak gecirir; `whatsapp` girdileri musteri kimligi uretmedigi icin atlanir. Musteri kimlikleri provider basina tek aktif hesaba baglanir, bu yuzden ayni provider icin birden fazla aktif Instagram/Messenger hesabi varsa komut source okumadan once durur. WooCommerce ve KolayBi hesaplari bu dosyada ifade edilemez; `woocommerce_id`/`kolaybi_id` dolu musteri iceren bir source bugun CLI ile tasinamaz.
- Dry-run apply ile ayni kurali uygular: hesabi cozulemeyen musteri dis kimligi kalirsa (dosya yok, provider icin aktif hesap yok) dry-run tum musteri batch'lerini okuduktan sonra fail-closed durur ve hata yalniz eksik provider adlarini ve cozulemeyen kimlik sayisini yazar. Bu nedenle basarili dry-run raporunda `customerTransform.unresolvedIdentities` her zaman `0`'dir.
- Bolunmus legacy konusmalar birlestirilir (karar: PR #7). Hedefte `(integration_account_id, external_thread_id)` (hesapsiz konusmalarda `(channel, external_thread_id)`) tekildir; legacy'de ayni anahtari paylasan birden fazla `konusmalar` satiri tek hedef konusmaya katlanir. Kazanan en yeni aktiviteye sahip uyedir: `son_mesaj_tarihi`, sonra `guncelleme_tarihi`, sonra `olusturma_tarihi` (bos degerler en eski sayilir), esitlikte en buyuk legacy id. Kazananin satiri yazilir; `unread_count` uyelerin `okunmamis_sayisi` toplamidir, `last_message_*` (kazanan en yeni son mesaja sahip oldugu icin) ve durum/havuz/atama kazanandan gelir. Diger uyeler ("merged away") hedef satir almaz; legacy id'leri `legacy_id_map` icinde `mapping_role = 'merged_into'` ile kazananin public id'sine baglanir. Mesajlar ve siparislerin konusma baglantisi once `primary`, sonra `merged_into` eslemesinden cozulur, bu yuzden butun mesajlar kendi zaman damgalariyla kazanan konusmaya tasinir; hicbiri kaybolmaz veya cogalmaz. Birlestirme plani ayni snapshot'tan deterministik kurulur, kaldigi yerden devam eden ve tekrar calisan apply ayni sonucu verir.
- Dry-run birlestirmeyi ayni planla simule eder ve `dryRunReport.conversationMerge` altinda raporlar: `groups`, `memberRows`, `mergedAwayRows`, `largestGroup`, `groupsWithMultipleCustomers` (kazananin musterisi korunur), kanal basina `byChannel`, `messagesInMergedGroups` ve `messagesReassigned`. Birlestirme engelleyici degildir (`blockedRows` artmaz); dry-run yalniz apply'in de durdugu durumlarda durur. Apply raporu ayni ozeti `migration.conversationMerge` altinda tasir.
- `verify` birlestirmeyi hesaba katar: konusmalar icin kaynak kapsami `primary` + `merged_into` eslemelerinin ayri legacy id sayisidir, hedef kapsami `kaynak satir - merged_into satir` beklenir, ve `legacy_id_map.merged_conversations` her `merged_into` eslemesinin ayni run'da `primary` eslenmis bir konusmayi gosterdigini ve hicbir legacy konusmanin hem `primary` hem `merged_into` olmadigini kontrol eder. Mesajlarin kapsami degismez (her mesaj kendi `primary` eslemesine sahiptir).
- `MIGRATION_USER_PUBLIC_IDS_FILE` opsiyoneldir. Dosya legacy kullanici UUID'lerini yeni kullanici public id'lerine eslestiren bir JSON objesidir:

```json
{ "b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e": "usr_agent_1" }
```

- Anahtarlar gecerli UUID, degerler bos olmayan string olmalidir. Eslesmeyen `atanan_kullanici_id` satiri durdurmaz; konusmanin atanan kullanicisi bos kalir ve raporda `unresolvedAssignedUsers` altinda sayilir.
- Snapshot dosyalari okunamazsa, gecersiz JSON icerirse veya beklenen yapida degilse dry-run source okumadan once hata verir.
- `migrate --apply` manuel kapilarla korunur: `MIGRATION_APPLY_ENABLED=true`, gecerli backup evidence, source/target kimlik ayrimi, `MIGRATION_RUN_ID` ve approval objesi gereklidir.
- Gelecekteki apply akisi source ve target icin farkli normalize edilmis PostgreSQL kimlikleri zorunlu kilacak.

Target dogrulamasi ayri bir komuttur ve `TARGET_DATABASE_URL` ister. `DATABASE_URL` yalniz bu target dogrulamasi icin uyumluluk fallback'i olarak desteklenir.

Rapor dosyasi `command`, `status`, zaman bilgileri, hata mesajini ve dry-run/apply migration sonucunu icerir. Database URL veya provider secret degerleri rapora yazilmaz.

## Kısayollar, SMS ve VAPI geçmişi

- `public.kisayollar` → `message_shortcuts`; `varsayilan` → `default`, `custom` → `custom`. Pasiflik, sıra ve kaynak zamanları korunur. Migration 009'un aynı kodlu `msc_default_*` satırları mevcut public id ile güncellenir; diğer hedef kod çakışmaları fail-closed durur.
- Kısayol medyası **Faz B medya taşınmaz kararının tek istisnasıdır**. `medyalar` içindeki inline base64 ve public Supabase URL dosyaları apply sırasında `files` + `message_shortcut_attachments` + Garage'a taşınır. Mesaj medyasının taşınma kararı bu akıştan bağımsızdır.
- Dry-run indirme/upload/HEAD yapmaz. `dryRunReport.communicationTransforms.message_shortcuts` altında kısayol/pasif kayıt, medya, inline öğe/decoded bayt ve uzak URL sayıları vardır. Yerel 2026-10-17 kopyası: 53 kısayol (6 pasif), 10 medya (7 inline, **2.254.896 decoded bayt**, 3 URL). Dump'taki ~2,9 MB base64 metni decoded dosya boyutu değildir.
- Medyalı kısayol apply'ı `MIGRATION_MEDIA_S3_*` ayarları olmadan ilgili batch'i yazmadan durur. Mevcut S3 istemcisi kullanılır. Dosya checksum'ı SHA-256, boyutu decoded/indirilen bayt sayısıdır; `upload_status=available`, `scan_status=skipped`. Anahtar API dosya akışındaki `media/YYYY/MM/DD/fil_…/<temiz-dosya-adı>` biçimindedir; tarih kaynağın oluşturulma tarihi (yoksa 1970-01-01), public id kaynak kimliği + medya sırası + checksum'dan türetilir. Kısayollar bu API biçimini kullandığı için `MIGRATION_MEDIA_S3_PREFIX` yalnız diğer migrator medya yollarına uygulanır. HEAD nesneyi bulursa boyutu doğrulanır; yoksa PUT yapılır. DB rollback sonrası tekrar aynı nesneyi kullanır.
- Uzak indirme yalnız `https://db.garantikulucka.com/storage/v1/object/public/...` kaynakları için yapılır; yönlendirme izlenmez, süre 30 saniye, dosya sınırı 25 MiB. `MIGRATION_SHORTCUT_MEDIA_BASE_URL=https://yedek.example` origin/başlangıç yolunu değiştirir; kaynak `/storage/v1/object/public/<bucket>/<path>` yolu bunun sonuna eklenir. HTTP yalnız loopback mock test sunucuları için kabul edilir. Testler internete çıkmaz.
- `public.sms_gonderimler` → `sms_messages`: gözlenen `basarili` → `sent` (270 satır). `public.vapi_aramalar` → `vapi_calls`: gözlenen `basladi` → `basladi` (21 satır). Başka/null durumlar sessiz varsayılan yerine fail-closed hata verir. VAPI özet/transkript/süre/maliyet ve başlangıç/bitiş, SMS bulk id/hata/otomatiklik/takip no korunur. Geçmiş kayıtlar `queued=false` olarak yazılır; iş kuyruğu tetiklenmez.
- Opsiyonel `kargo_id`, aynı run'ın `legacy_id_map` primary shipment eşlemesinden çözülür. Bulunamazsa geçmiş kayıt `shipment_id=null` ile korunur; dry-run `unresolvedShipments`, apply `unresolved_optional_shipment` uyarı sayısı raporlanır. Hedef `sms_messages` tablosunda müşteri FK kolonu yoktur; müşteri adı ve telefonu korunur. Yerel kopyada 266 SMS'in kargo bağı vardır ve hepsi kaynak kargolarla eşleşir; VAPI'de kargo bağı yoktur.
- Her ana kayıt `primary`; kısayol dosyaları `media:<sıra>`, ekleri `attachment:<sıra>` legacy id rolleri alır. Verify kapsamı, hedef referansları, dosya-ek-kısayol eşleşmesi, mevcut dosya/checksum/boyut ve geçmiş kayıtların kuyruğa girmediği kontrol edilir.

## Akışlı checksum ve arama geçmişi

Row-content checksum, eski `{entity, rows:[{checksum,sourceId}]}` canonical JSON baytlarını entity başına artımlı SHA-256 ile işler. UUID/metin sırasındaki normal okumada yalnız o partinin digest satırları canlıdır. Sayısal kimliklerin sayısal sırası ile eski fingerprint'in metin sırası farklı olduğunda veya test kaynağı sırasız döndüğünde, disk üzerinde sınırlı tamponlu ikili birleştirme kullanılır. Eski JS string sırası ve ilk okumanın checksum'ını koruyan tekrar eleme değişmez. Planın kalıcı offset/parti numaraları fingerprint uyumluluğu için korunur; çalışma sırasında aynı partilerin cursor'ları ayrı tutulur ve `id > $2::uuid` / `int2` / `int4` / `int8` kullanılır. Kolon cast edilmez. Kargo özeti mevcut tek snapshot cursor'undan okunmaya devam eder.

Apply önce manifest'i doğrulamak zorundadır. Kaynağı iki kez sorgulamak yerine ilk okumadaki partiler `os.tmpdir()` altında özel `migrator-snapshot-*` dizinine yazılır (dizin 0700, dosyalar 0600); apply aynı partileri oradan okur. Başarıda ve yakalanan hatada dosyalar silinir. `TMPDIR`/container geçici diski ham JSON snapshot'ını, inline mesaj medyası dahil, taşıyacak kadar boş alana sahip olmalıdır; ani process/host kesintisinden kalan bu dizinler operatör tarafından silinmelidir. Dry-run ham partileri diske yazmaz; yalnız kimlik/checksum sıralama dosyalarını tutar. Checksum belleği O(parti boyutu); mevcut müşteri/konuşma/sipariş iş planı indeksleri ve parti metadata'sı ayrıca ölçeklenir.

`public.arama_kayitlari` → `call_logs`: `source=legacy`, `giden → outbound`; `cevaplandi → answered`, `hata → failed`, `cevapsiz → missed`, `mesgul → busy`, `iptal → cancelled`. Bilinmeyen/null yön veya durum fail-closed durur. `baslangic/bitis → initiated_at/ended_at`, `sure_sn → talk_seconds`; notlar dahil tüm kaynak satır `raw_payload` içinde korunur. Yeni event/bildirim/kayıt indirme işi oluşturulmaz.

Kullanıcı `MIGRATION_USER_PUBLIC_IDS_FILE`, opsiyonel sipariş aynı run'ın `public.siparisler` primary `legacy_id_map` kaydı, müşteri telefonun son 10 rakamıyla tekil eşleşme üzerinden çözülür. Çözümsüz/çoklu müşteri ve çözümsüz opsiyonel bağlar null kalır. Dry-run `communicationTransforms.call_logs` altında bağlı/çözümsüz kullanıcı, sipariş ve müşteri sayılarını; apply `unresolved_optional_user/order/customer` uyarı sayılarını verir. Her arama `primary` id-map rolüyle yazılır; verify kaynak/hedef kapsamını, legacy kaynağını ve FK'leri kontrol eder.
