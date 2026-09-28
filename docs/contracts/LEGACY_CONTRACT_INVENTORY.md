# Legacy Contract Inventory

This inventory freezes the first-pass compatibility surface extracted from the legacy project at:

`/Users/furkanmeclis/Documents/Projects/garanti-kulucka`

## Source Files

- `server.js`
- `routes/suratKargoRouter.js`
- `routes/aiAgentRouter.js`
- `routes/commentAiRouter.js`
- `frontend/src/services/supabase.js`
- `frontend/src/stores/authStore.js`
- `frontend/src/pages/mesajlar/MesajlarPage.jsx`
- `frontend/src/pages/kargo/KargolarPage.jsx`
- `backend-whatsapp-routes.js`
- `n8n/README.md`
- `n8n-whatsapp-ai-workflow.json`
- `WHATSAPP-KURULUM.md`
- `.env.example`

## API Groups To Preserve

### KolayBi

- `GET /api/kolaybi/status`
- `GET /api/kolaybi/urunler`
- `GET /api/kolaybi/debug`
- `POST /api/kolaybi/e-fatura/olustur`
- `POST /api/kolaybi/e-fatura/iptal`
- `GET /api/kolaybi/e-fatura/durum/:invoice_id`
- `POST /api/kolaybi/cari-olustur`
- `POST /api/kolaybi/adres-ekle`
- `POST /api/kolaybi/siparis-fatura`
- `ALL /api/kolaybi/*` generic proxy behavior

### PTT

- `GET /api/ptt/status`
- `GET /api/ptt/gonderiler`
- `GET /api/ptt/debug`
- `GET /api/ptt/iller`
- `GET /api/ptt/ilceler/:ilKodu`
- `POST /api/ptt/gonderi/olustur`
- `POST /api/ptt/gonderi/toplu-olustur`
- `GET /api/ptt/gonderi/takip`
- `GET /api/ptt/gonderi/takip-referans`
- `POST /api/ptt/gonderi/sil`
- `POST /api/ptt/gonderi/sil-referans`
- Cron debug and tracking update endpoints

### Surat

Mounted at `/api/surat-kargo`.

- `POST /kargoya-gonder`
- `POST /kargo-takip`
- `POST /gonderi-sil`
- `POST /gonderi-geri-cek`
- `POST /at-durum-kontrol`
- `POST /at-durum-toplu-kontrol`
- `GET /debug`
- `POST /debug/temizle`
- `GET /status`

### Messaging And Admin

- `GET /api/konusmalar`
- `PATCH /api/konusmalar/:konusmaId/human-agent`
- `GET /api/konusmalar/sayilar`
- `POST /api/konusmalar/tumunu-okundu`
- `GET /api/mesajlar/:konusmaId`
- `POST /api/personel/heartbeat`
- `POST /api/personel/durum`
- `GET /api/admin/kullanicilar`
- `PATCH /api/admin/kullanicilar/:id`
- `POST /api/admin/kullanicilar`
- `DELETE /api/admin/kullanicilar/:id`
- `POST /api/veri-silme-talebi`
- `POST /api/facebook/data-deletion`

### AI Agent

Mounted at `/api/ai-agent`.

- `POST /yanit`
- `POST /yanit-ve-gonder`
- `POST /otomatik-yanit`
- `GET /durum`
- `GET /prompt`
- `POST /prompt`
- `POST /prompt/sifirla`
- Conversation export, stats, debug, and test endpoints

### Social Comments

Mounted at `/api/yorumlar`.

- List
- Settings
- Statistics
- Control
- Manual ingest
- Detail
- Reply
- Delete
- Hide
- Manual queue

### Vapi

- `GET /api/vapi/config`
- `PUT /api/vapi/config`
- `GET /api/vapi/kargo-almayan`
- `POST /api/vapi/kuyruga-ekle`
- `GET /api/vapi/kuyruk`
- `DELETE /api/vapi/kuyruk/:id`
- `POST /api/vapi/arama-baslat`
- `POST /api/vapi/toplu-arama`
- `POST /api/vapi/webhook`
- `GET /api/vapi/aramalar`
- `GET /api/vapi/aramalar/:id`
- `GET /api/vapi/istatistikler`

## Webhook Contracts

### Meta WhatsApp Cloud

- `GET /api/whatsapp/webhook`
- `POST /api/whatsapp/webhook`
- Verification uses `hub.mode`, `hub.verify_token`, `hub.challenge`.
- POST responds `EVENT_RECEIVED`.

### Instagram

- `GET /api/instagram/webhook`
- `POST /api/instagram/webhook`
- Verification uses Meta challenge pattern.
- POST responds `EVENT_RECEIVED`.

### Messenger

- `GET /api/messenger/webhook`
- `POST /api/messenger/webhook`
- Verification uses Meta challenge pattern.

### NetGSM IVR

- `GET /api/netgsm/webhook/sesli-mesaj`
- `POST /api/netgsm/webhook/sesli-mesaj`

### Vapi

- `POST /api/vapi/webhook`
- Accepts `message` wrapper or flat event.

## Frontend Direct Supabase Usage To Remove

Direct table/storage/RPC usage found:

- `siparisler`
- `siparis_kalemleri`
- `kargo_gonderimleri`
- `kargo_takip`
- `konusmalar`
- `mesajlar`
- `musteriler`
- `kullanicilar`
- `roller`
- `settings`
- `islem_loglari`
- `urunler`
- `stok_hareketleri`
- `bakiye_hareketleri`
- `odeme_istekleri`
- `arama_kayitlari`
- `kisayollar`
- Storage bucket `kisayol-medyalar`
- RPC `tum_personel_bakiyeleri`

Realtime channels to replace with Socket.IO:

- `konusmalar-realtime`
- `personel-is-online-refresh`
- `auth-self-*`
- `mesajlar-{id}`
- `kargolar-siparis-sync`
- `kisayollar-changes`

## Provider Upstreams

- PTT WSDLs: `PttVeriYukleme/services/Sorgu`, `GonderiTakipV2/services/Sorgu`
- Surat base: `https://api01.suratkargo.com.tr/api`
- Surat operations: `OrtakBarkodOlustur`, `KargoTakipHareketDetayi`, `GonderiSil`, `GonderiGeriCek`

## Discovery Commands

```bash
rg -n "app\\.(get|post|put|patch|delete|all|use)\\(|router\\.(get|post|put|patch|delete)\\(" server.js routes backend-whatsapp-routes.js
rg -n "webhook|hub\\.challenge|EVENT_RECEIVED|/api/.+webhook|/webhook/" server.js routes n8n *.md *.json
rg -n "createClient|supabase\\.auth|supabase\\.channel|postgres_changes|\\.from\\(|\\.rpc\\(|\\.storage" frontend/src
rg -n "KOLAYBI|PTT_|SURAT_|NETGSM|INSTAGRAM|MESSENGER|WHATSAPP|OPENAI|VAPI|SIP" .env.example server.js frontend/src
```

## Classification Report

The classified route surface lives in `contracts/legacy/endpoint-classification.json`.
Contract tests fail when an inventoried API or webhook group is left unclassified or lacks a target boundary.

## Known Gaps

- n8n/Evolution WhatsApp docs may be stale versus the current Meta Cloud webhook path.
- Live Supabase policies were not inspected.
