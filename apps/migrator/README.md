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
- `migrate --dry-run` source row count'larini okuyup batch planini kurar, sonra `public.musteriler`, `public.konusmalar`, `public.mesajlar`, `public.urunler` ve `public.siparisler` satirlarini canonical taslaklara donusturur. `public.siparis_kalemleri` ve `public.kargo_gonderimleri` satirlari yalniz sayilir ve kolon sozlesmesi dogrulanir. Target URL cozmez, target baglantisi acmaz ve veri yazmaz.
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
- `migrate --apply` legacy alan ve iliski mapping katalogu tamamlanana kadar fail-closed durumdadir. Komut target URL okumadan ve target baglantisi acmadan hata verir.
- Apply acildiginda `MIGRATION_RUN_ID` zorunlu olacak; sabit veya otomatik bir run kimligi kullanilmayacak.
- Gelecekteki apply akisi source ve target icin farkli normalize edilmis PostgreSQL kimlikleri zorunlu kilacak.

Target dogrulamasi ayri bir komuttur ve `TARGET_DATABASE_URL` ister. `DATABASE_URL` yalniz bu target dogrulamasi icin uyumluluk fallback'i olarak desteklenir.

Rapor dosyasi `command`, `status`, zaman bilgileri ve hata mesajini icerir. Database URL veya provider secret degerleri rapora yazilmaz.
