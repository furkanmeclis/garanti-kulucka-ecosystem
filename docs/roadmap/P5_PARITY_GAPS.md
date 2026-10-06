# P5 Parity Gaps

Audit tarihi: 2026-10-05. Kapsam: legacy `frontend/src` route/page/component davranislari, yeni `apps/web/src/ui/App.tsx` ve API clientlari, backend `apps/api/src/http`.

Durum anahtari: `yes` = yeni appte gercek akista var; `partial` = ozet/smoke veya dar kapsam var; `no` = yok. Endpoint anahtari: `exists` = backend route var; `partial` = benzer/eksik semantik var; `missing` = route yok.

## Genel Bulgular

- Legacy UI cok sayfali, Supabase realtime/RPC ve provider servislerine dogrudan bagli. Yeni UI tek `App.tsx` icinde ozet/list/smoke akislari sunuyor.
- Yeni app gorunumu legacy ile birebir degil; P5 hedefi icin sayfa bilesenleri ve davranislar legacy layout/visual ile tasinmali.
- Backend temel alanlari kapsiyor: auth, conversations/messages, orders, balances summary, products list/summary, shipments list/summary/pipeline/status, SMS send, files, webphone, admin settings/integrations.
- Eksik buyuk backend alanlari: siparis detay/duzenleme/silme/geri alma/toplu islemler, kargo olusturma/barkod/fatura PDF, KolayBi e-fatura/cari, yorum moderasyon aksiyonlari, SMS sablon/gecmis/cron, NetGSM rehber/sesli mesaj/gorusme, VAPI kuyruk/arama listesi, stok CRUD/hareket, bakiye odeme istekleri ve admin kullanici/log/debug rotalari.

## Route Parity Matrisi

| Legacy route / page | Roller | Legacy aksiyonlar | Yeni app | Backend endpoint | Size |
|---|---|---|---|---|---|
| `/giris` `LoginPage` | public | Email/sifre giris, auth init, hatalar, sifre sifirla linki | partial: backend login var ama legacy gorsel/akis degil | exists: `POST /auth/login`, `/auth/me`, `/auth/logout` | S |
| `/sifre-sifirla` `ResetPasswordPage` | public | Sifre sifirlama formu | partial: statik ekran | missing: reset token/email akisi yok | M |
| `/gizlilik-politikasi`, `/kullanim-kosullari` | public | Statik yasal sayfalar | yes | n/a | S |
| `/veri-silme` `DataDeletionPage` | public | Veri silme talep formu, durum mesaji | partial: statik sayfa var, form yok | missing: legacy `POST /api/veri-silme-talebi` | S |
| `/mesajlar` `MesajlarPage` | admin, calisan | Konusma liste/arama/kanal-durum filtreleri, temsilci online toggle, aktif temsilci atama, konusma secme, mesaj gonderme, okunmadi okundu, human-agent/AI toggle, konusma ayarlari dialog, musteri notu autosave, medya/PDF upload, coklu medya, kisayol ekle/duzenle/sil/indir, AI yanit uret/kullan/gonder, konusmadan siparis formu, drag-drop alan doldurma, Sürat AT uyarisi, siparis/kargo detay/takip modali, realtime Supabase updates | partial: conversation filters, select, text reply, state update, human-agent, pool assign, smoke order create, Socket.IO message.created var; medya/kisayol/AI/siparis formu/not/legacy layout yok | partial: `GET/POST /api/conversations...`, `PATCH /state`, Socket.IO exists; media upload generic exists; AI, shortcuts, notes, rich order form missing | L |
| `/yorumlar` `YorumlarPage` | admin, calisan | Kontrol paneli, istatistik, liste filtreleri, durum/platform filtreleri, cevap modal, sil/gizle/onayla/yeniden isle, ayarlar paneli ve kaydet | partial: sadece moderation summary | missing: legacy `/api/yorumlar*` aksiyonlari yok | M |
| `/siparisler` `SiparislerPage` | admin, calisan, kargo_operatoru | Liste, arama, tarih presetleri, durum/kargo/personel filtreleri, secim/toplu secim, Excel export, yeni siparis modal/form, urun/kalem/ek kalem, mukerrer kontrol, Sürat AT kontrol, stok dusme, KolayBi cari/fatura/e-fatura, fatura goruntule, e-fatura gonder, durum degistir, iptal/geri al/sil, kargo olustur PTT/Sürat, barkodlu PDF yazdir, toplu teyit ara, toplu KolayBi aktar, realtime siparis updates | partial: list/summary/filter, smoke create, cancel status | partial: `GET/POST /api/orders`, `PATCH /status`; missing detail/update/delete/restore/bulk/export/provider/KolayBi/stok/RPC equivalents | L |
| `/iptaller` `IptallerPage` | admin, calisan | Iptal/iade liste, arama, detay modal, geri al, kalici sil, KolayBi/e-fatura silme | partial: cancellation flow lists orders and cancel selected | partial: status update exists; restore/delete/KolayBi delete missing | M |
| `/kargo` `KargolarPage` | admin, calisan, kargo_operatoru | Kargo liste, firma/durum/tarih/personel filtreleri, takip no yok/yeni filtreleri, Excel export, detay/duzenle modal, siparis iptal/sil, PTT/Sürat gonderi olustur, tek/toplu kargo aktar, takip guncelle, capraz kontrol, barkodlu fatura PDF yazdir/indir, popup postMessage, KargoTakipModal, realtime updates | partial: shipments list/summary/provider/status/tracking filters, delivered status update | partial: `GET /api/shipments`, `PATCH /status`; missing create shipment, labels, tracking provider calls, export, edit/delete/cancel, realtime shipment-specific | L |
| `/kargo/pipeline` `KargoPipelinePage` | admin, calisan, kargo_operatoru | Pipeline adimlari, test paneli, otomatik takip/mesaj/SMS/VAPI/teslim akis gorunumu, filtreler | partial: pipeline summary/filter only | partial: `GET /api/shipments/pipeline-summary`; trigger/action endpoints missing | M |
| `/kargo/surat-debug` `SuratKargoDebugPage` | admin | Sürat config/test, AT durum, gonderi/etiket/debug | partial: provider attempts/debug ozet var | partial: admin provider attempts exists; Sürat-specific test endpoints missing | M |
| `/kargo/cron-debug` `CronDebugPage` | admin | PTT/Sürat cron loglari, otomatik yenile, cron tetikle, log temizle | partial: provider cron trigger and attempts summary var | partial: `POST /admin/integrations/provider-cron-triggers/:provider_key`; legacy log temizle/list yok | M |
| Unrouted legacy `BarkodYazdirPage` | n/a in App | Takip no/siparis no ara, PTT/Sürat barkod render, PDF/ZPL/EPL indir/yazdir, kopyala | no | missing: shipment lookup/label download/print route | M |
| `/stok` `StokPage` | admin, calisan | Kategori/arama/durum filtreleri, urun kartlari, yeni/duzenle modal, stok giris/cikis, soft delete, KolayBi urun eslestirme, stok hareketi yazma | done (slice 10): `ui/pages/StokPage.tsx` kategori kartlari, arama, durum filtresi, yeni/duzenle modal, stok giris/cikis, soft delete, hareket gecmisi, kritik stok uyarisi; KolayBi eslestirme manuel ID girisi | done: `GET /api/products` (category/search/active), `POST/PATCH/DELETE /api/products`, `GET/POST /api/products/{id}/stock-movements`, migration `012` `stock_movements`; missing KolayBi product list proxy | M |
| `/bakiye` `BakiyePage` | admin, calisan | Personel bakiye ozetleri, hareketler/odeme istekleri tablari, personel detay modal, bakiye sifirla, odeme istegi olustur, admin onay/red | done (slice 9): `BakiyePage` legacy etiketleriyle; `tests/playwright/bakiye-parity.spec.ts` | done: migration 015 `balance_movements` + `payment_requests` ledger; komisyon/iptal/iade/geri alma kurallari siparis olusturma ve durum degisiminde idempotent uygulanir (kargo operatoru kesinti yazmaz); `GET /api/balances/summary` (rol kapsamli), `/api/balances/staff`, `/staff/{id}/orders`, `/staff/{id}/reset`, `/movements`, `/payment-requests` (+ approve/reject admin). Deferred: migrator legacy `bakiye_hareketleri`/`odeme_istekleri` eslemesi; siparis silme sirasinda kargo hakedis koruma (073) silme akisi gelince | M |
| `/sms` `SmsGonderPage` | admin, calisan, kargo_operatoru | Manuel coklu alici SMS, degisken butonlari, karakter/sms sayaci, sablon sec, gecmis filtre/sayfalama, sablon CRUD, otomatik PTT/Sürat takip SMS cron tetikleme | partial: one selected shipment SMS send, hardcoded template variables | partial: `POST /api/sms/send`; missing history/templates/bulk/manual recipient list/cron endpoints | M |
| `/sesli-asistan` `AramaPage` | admin | Arama modul girisi | partial: calls panel with SIP settings save | partial: `/api/webphone/config`; live softphone UI missing | S |
| `/sesli-asistan/vapi` `VapiAramalarPage` | admin | Istatistik, kargo almayan listesi, kuyruga ekle, kuyruk filtre/liste, tek/toplu arama baslat, kuyruk sil, aramalar liste/filtre, detay modal, TestAramaPaneli | partial: dry-run test call only | partial: `POST /api/webphone/test-call`; missing `/api/vapi/*` queue/call/list/stats | L |
| Unrouted `/sesli-asistan/gorusmeler` `GorusmeDetayPage` | constants only | NetGSM gorusme raporu, filtreler, ses kaydi oynat/durdur/ileri sar | no | missing: NetGSM calls/report/audio endpoints | M |
| Unrouted `/sesli-asistan/sesli-mesajlar` `SesliMesajlarPage` | constants only | Sesli mesaj gonder formu, rapor sorgula, filtreler, liste, kayit oynat/indir | no | missing: NetGSM voice message endpoints | M |
| Unrouted `/sesli-asistan/rehber` `RehberPage` | constants only | Rehber kisileri/gruplari listele, arama/grup filtre, yenile, edit/delete ikonlari | no | missing: NetGSM directory endpoints | S |
| `/raporlar` `RaporlarPage` | admin | Tarih presetleri, kargo firmasi filtresi, KPI kartlari, iade/subede/ciro/teyit metrikleri, gunluk_istatistikler RPC fallback | partial: report summary only | partial: `GET /api/reports/summary`; missing date/provider filters and detailed metrics | M |
| `/instagram/yayinla` `YayinlaPage` | admin, calisan | Foto URL/caption gir, Instagram publish, sonuc goster | partial: admin-only publish preview with hardcoded image/caption | partial: `POST /admin/integrations/instagram-publish-previews`; live/user form missing | S |
| `/instagram/analitik` `AnalitikPage` | admin, calisan | days sec, account insights fetch, yenile, metric toplamlar | partial: first integration account analytics summary admin-only | partial: `GET /admin/integrations/accounts/:id/analytics-summary`; days/account selection missing | S |
| `/ayarlar` `AyarlarPage` | admin, calisan, kargo_operatoru | Entegrasyon durum kartlari, WhatsApp/Messenger/Instagram/NetGSM/Santral/VAPI/Kargo pipeline ayarlari, loglar, kullanici yonetimi linkleri, log yenile | partial: admin settings/integrations overview, provider catalog/audit | partial: settings/integrations exist; legacy per-provider config pages mostly missing | L |
| `/ayarlar/whatsapp-debug` | admin | WhatsApp debug, auto refresh, test send, webhook test, kopyala | no | missing: `/api/whatsapp/debug*` | S |
| `/ayarlar/instagram-debug` | admin | Instagram debug/test flows | partial via integration attempts | missing/partial: provider-specific debug endpoints yok | S |
| `/ayarlar/ai-debug` | admin | AI debug log/auto refresh | no | missing | S |
| `/ayarlar/ai-egitim` | admin | AI egitim verisi liste, format sec, indir, sayfalama | no | missing | S |
| Legacy settings subpages not routed in App (`InstagramAyarlar`, `MessengerAyarlar`, `WhatsAppAyarlar`, `NetgsmAyarlar`, `SantralAyarlar`, `KullanicilarPage`, `LoglarPage`, `KargoPipelineAyarlar`, `VapiAyarlar`) | mostly admin | Provider token/config kaydet, webhook copy, QR/status, kullanici SIP bilgisi, log görüntüleme | partial/no by page | partial: admin settings generic exists; typed provider/user/log endpoints missing | M |
| Legacy `MusteriListPage`, `MusteriDetayPage` | not in App routes | Musteri liste/detay/not/siparis baglantilari | partial: new nav has `/musteriler`, customer list/summary only | partial: `GET /api/customers`, summary; detail/update missing | M |
| Legacy `FaturaListPage`, `FaturaOlusturPage`, `CariHesaplarPage` | not in App routes | Fatura liste, PDF/HTML/print, barkod uygula, tahsilat, fatura olustur, cari liste/arama/create/update, KolayBi sync | no | missing: invoice/current-account/KolayBi endpoints | L |
| Layout/components | protected shell | Sidebar role filtering, profile menu, language switch, logout, online toggle, header notifications, softphone init/widget/incoming-call modal, searchable select, inline note, virtual table, pagination, kargo takip modal | partial: nav/presence/logout/realtime status; no header/profile/lang/softphone/incoming modal/legacy components | partial: auth presence/webphone config exists; softphone call control missing | M |

## Oncelikli Slice Plani

1. **Mesajlar temel parity (L)**  
   Files: `apps/web/src/ui/App.tsx` split to `flows/messages/*`, `apps/web/src/api/domain-client.ts`, `apps/api/src/http/domain-routes.ts`, repository.  
   Tests: login as `calisan`, open `/mesajlar`, filter channel/status, select conversation, send text, mark read, human-agent toggle, pool take/release, Socket.IO new message refresh.

2. **Mesajlar medya + kisayol + notlar (L)**  
   Files: `flows/messages`, `apps/web/src/api/file-client.ts`, domain API for notes/shortcuts/media binding.  
   Tests: upload image/PDF, send media, create/edit/delete/download shortcut with media, autosave customer/conversation note, reload preserves state.

3. **Siparisler liste/filtre/secim/export (M)**  
   Files: `flows/orders`, `domain-client.ts`, `domain-routes.ts`.  
   Tests: role access for admin/calisan/kargo, search/date/status/cargo/person filters, select one/all, pagination, Excel export content.

4. **Siparis olusturma formu legacy parity (L)**  
   Files: `flows/orders/OrderForm`, backend order detail/create line items, product lookup.  
   Tests: create order with customer/address/products/extra lines/cargo, duplicate warning, Sürat AT warning override, stock deduction visible.

5. **Siparis aksiyonlari ve KolayBi boundary (L)**  
   Files: orders flow, `apps/api/src/http/integration-routes.ts`, domain repository/provider job layer.  
   Tests: invoice create/view/e-invoice send, status change, cancel, restore, permanent delete, bulk KolayBi transfer, provider dry-run audit.

6. **Kargo operasyon listesi (L)**  
   Files: `flows/shipments`, domain shipments routes/repository.  
   Tests: `/kargo` filters match legacy, edit shipment/order customer fields, tracking update, detail/takip modal, realtime update.

7. **Kargo olusturma + barkod/fatura print (L)**  
   Files: shipment provider endpoints, label/download helpers, print views.  
   Tests: single and bulk PTT/Sürat create, missing tracking guard, barcode/PDF/ZPL/EPL print/download, popup marks printed.

8. **SMS merkezi (M)**  
   Files: `flows/sms`, domain SMS routes, templates/history tables.  
   Tests: manual multi-recipient send, variable insertion/counter, template CRUD, history filter/pagination, PTT/Sürat cron trigger buttons.

9. **Bakiye ve odeme istekleri (M)**  
   Files: `flows/balances`, balance routes/repository.  
   Tests: admin sees all personnel balances, staff sees own balance, payment request modal, admin approve/reject, reset balance, detail modal.

10. **Stok CRUD ve hareketler (M)**  
    Files: `flows/inventory`, product routes/repository, KolayBi product adapter.  
    Tests: category/search/status filters, create/edit/delete product, stock in/out writes movement, KolayBi match dropdown loads.

11. **Yorum moderasyonu (M)**  
    Files: `flows/comments`, comments routes/provider integration.  
    Tests: control/stat panels, platform/status filters, reply modal, hide/delete/approve/reprocess, settings save.

12. **Ayarlar/debug/provider admin (L)**  
    Files: `flows/settings`, admin/settings/integration routes.  
    Tests: provider config save, token masking, webhook copy, logs/audit, WhatsApp/Instagram/Sürat/Cron/VAPI debug smoke.

13. **VAPI/NetGSM sesli akislari (L)**  
    Files: `flows/voice`, `webphone-client.ts`, new VAPI/NetGSM routes.  
    Tests: VAPI stats/list/queue/add/delete/single/bulk call, call detail modal, NetGSM reports/audio/voice-message/directory.

14. **Raporlar ve Instagram (M)**  
    Files: `flows/reports`, `flows/instagram`, reports/integration routes.  
    Tests: date/provider filters, all KPI formulas, Instagram publish form and days analytics with role parity.

15. **Layout visual parity and route split (M)**  
    Files: `apps/web/src/ui/App.tsx`, `ui/styles.css`, new route modules/components.  
    Tests: Playwright screenshot parity for desktop/mobile nav, header/profile/lang/logout/presence, protected route redirects, no text overlap.

## Top 3 Slice

1. Mesajlar temel parity: staff daily-use entrypoint; unlocks support response, assignment, read state, and realtime confidence.
2. Mesajlar medya + kisayol + notlar: high-frequency operator workflow; without it customer replies are materially weaker than legacy.
3. Siparisler liste/filtre/secim/export: second daily-use surface; gives staff operational control before deeper create/provider actions.
