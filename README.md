# Garanti Kulucka Ecosystem

Garanti Kulucka operasyon panelinin yeni monorepo altyapisi.

## Kararlar

- Tek branch: `main`
- PR akisi yok
- Onaylanan her commit `main` branch'e girer
- Build gecen her commit otomatik artan tag alir
- Frontend deneyimi korunur
- Frontend, Supabase yerine backend API ve websocket kanali ile konusur
- API, worker ve migrator ayri container olarak tasarlanir
- Migrasyon backend feature degildir; manuel calistirilan ayri containerdir
- Veritabani semasi Ingilizce `snake_case` canonical isimlendirme ile ilerler
- DB baglantisi ve sistem secrets disindaki entegrasyon/config degerleri admin UI'dan yonetilir

## Hedef Yapi

```text
apps/api       Hono + TypeScript HTTP API
apps/web       Mevcut frontend deneyimini tasiyan web uygulamasi
apps/worker    Queue, webhook ve background job isleyicileri
apps/migrator  Eski veriyi yeni canonical semaya tasiyan manuel arac
packages/shared Paylasilan tipler, contractlar ve yardimcilar
```

## Release

`.github/workflows/build-and-tag.yml` sadece `main` branch push'larinda calisir.
Build basarili olursa son `vMAJOR.MINOR.PATCH` tag'i bulunur ve patch numarasi artirilarak ayni commit taglenir.
