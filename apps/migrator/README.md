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
- Mesaj medyasi icin live `media_url`/`media_type` alanlari birincildir; eski `medya_url`/`medya_tipi` yalniz fallback'tir. Iki kaynakta farkli dolu deger varsa dry-run rapora conflict uyarisi yazar. Inline `data:` medya PostgreSQL'e yazilmaz; dry-run MIME ve decoded byte toplamlarini raporlar, apply storage yapilandirmasi olmadan fail-closed durur.
- Apply inline medya icin S3 uyumlu Garage ayarlari ister: `MIGRATION_MEDIA_S3_ENDPOINT`, `MIGRATION_MEDIA_S3_ACCESS_KEY_ID`, `MIGRATION_MEDIA_S3_SECRET_ACCESS_KEY`, `MIGRATION_MEDIA_S3_BUCKET`; opsiyonel `MIGRATION_MEDIA_S3_REGION` ve `MIGRATION_MEDIA_S3_PREFIX`. Eski genel `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_MEDIA`, `S3_REGION` de fallback olarak okunur.
- Bridge veritabani inline (ve ileride suresi dolan Facebook/Instagram CDN) medyayi onceden Garage'a cikarir ve `media_url` alanini `s3://<legacy-bucket>/mesajlar/<sha256-hex>.<ext>` URI'si ile degistirir (`media_type` degismez). Bu URI kati dogrulanir: bucket `MIGRATION_LEGACY_MEDIA_BUCKET` (varsayilan `gk-legacy-media`) ile birebir esit olmali, anahtar tam olarak `mesajlar/` + kucuk harf 64-hex sha256 + bilinen uzanti (`jpg`, `jpeg`, `png`, `gif`, `webp`, `heic`, `mp4`, `mov`, `webm`, `3gp`, `ogg`, `opus`, `mp3`, `m4a`, `aac`, `amr`, `wav`, `pdf`) olmali. Dry-run gecerli `s3://` medyayi `legacyObjectMediaPayloads`/`legacyObjectMediaByMime` altinda inline `data:` (`inlineMediaPayloads`) ve http(s) (`remoteUrlMediaPayloads`) sayaclarindan ayri raporlar; bozuk URI `invalid_legacy_media_uri` uyarisi + `blockedRows` olarak fail-closed raporlanir.
- Apply `s3://` medyayi yeniden yuklemez/kopyalamaz: batch yazmadan once her nesne icin storage portu uzerinden HEAD atar (eksik nesne veya bozuk URI tum batch'i yazmadan durdurur), sonra nesnenin bulundugu bucket/anahtari gosteren `files` satiri (checksum = anahtardaki sha256, MIME = tam MIME ise `media_type`, degilse uzantidan, boyut = HEAD, `upload_status=available`, `scan_status=skipped`) ve inline yol ile ayni `message_attachments` baglantisini yazar. Public id'ler checksum'dan turetildigi icin tekrar calistirma idempotenttir; `raw_payload.media_url` yerine `media_storage` yazilir. Kaynak bucket hedef medya bucket'indan farkli olabilir; HEAD icin ayni `MIGRATION_MEDIA_S3_*` kimlik bilgileri kullanilir. http(s) URL'ler ve inline `data:` davranisi degismedi.
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
