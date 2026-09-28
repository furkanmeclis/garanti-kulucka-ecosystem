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

Dry-run yalniz legacy source baglantisini ister:

```bash
SOURCE_DATABASE_URL=postgres://legacy-readonly@legacy/legacy
MIGRATION_BATCH_SIZE=500
MIGRATION_SOURCE_SYSTEM=legacy_postgres
```

- `SOURCE_DATABASE_URL` zorunludur. Source okumalari `REPEATABLE READ READ ONLY` transaction icinde yapilir.
- `migrate --dry-run` source row count'larini okuyup canonical entity planini kurar. Bu checkpoint source tarafinda da canonical tablo adlarini bekler. Target URL cozmez, target baglantisi acmaz ve veri yazmaz.
- Dry-run alan ve iliski donusumlerini dogrulamaz; bu faz yalniz tablo bazli hacim ve batch planlama raporudur.
- Legacy tablo adlari, alan adlari ve foreign key iliskileri icin mapping katalogu sonraki migrator fazinda eklenecektir.
- `migrate --apply` legacy alan ve iliski mapping katalogu tamamlanana kadar fail-closed durumdadir. Komut target URL okumadan ve target baglantisi acmadan hata verir.
- Apply acildiginda `MIGRATION_RUN_ID` zorunlu olacak; sabit veya otomatik bir run kimligi kullanilmayacak.
- Gelecekteki apply akisi source ve target icin farkli normalize edilmis PostgreSQL kimlikleri zorunlu kilacak.

Target dogrulamasi ayri bir komuttur ve `TARGET_DATABASE_URL` ister. `DATABASE_URL` yalniz bu target dogrulamasi icin uyumluluk fallback'i olarak desteklenir.

Rapor dosyasi `command`, `status`, zaman bilgileri ve hata mesajini icerir. Database URL veya provider secret degerleri rapora yazilmaz.
