# Tamamlama Yol Haritası

Tarih: 2026-10-17. Bu belge, projeyi "canlıya geçti, eski Supabase paneli kapatıldı" noktasına götüren kalan işleri sıralar. Ayrıntılı tarihçe ve teknik kabul kapıları `CONTINUATION_HANDOFF.md` ve `MASTER_ROADMAP.md` içinde kalır; burası çalışma sırasıdır.

## "Bitti" tanımı

Proje şu dört koşul birlikte sağlandığında tamamlanmış sayılır:

1. Legacy veritabanındaki veriler `migrate --apply` ile yeni canonical PostgreSQL'e kayıpsız taşındı ve doğrulandı.
2. Tüm sağlayıcılar (PTT, Sürat, KolayBi, WhatsApp, Instagram, Messenger, NetGSM, VAPI, SMTP) canlı modda çalışıyor.
3. Personel günlük işini yeni panelden yapıyor; eski panel salt okunur ya da kapalı.
4. Yedekleme, izleme ve geri dönüş planı canlı ortamda tatbik edildi.

## Bugünkü durum (özet)

| Alan | Durum |
| --- | --- |
| Altyapı (API, worker, migrator, compose, CI/tag) | Tamam. CI `ubuntu-24.04` üzerinde sabit; main yeşil |
| Veritabanı şeması | Migration `001`–`028` yayımlandı |
| Frontend (`apps/web` + `apps/web-beta`) | Koordinatör listesindeki 1–9s parçaları tamam; legacy sayfaların neredeyse tamamı her iki panelde var |
| Sağlayıcı adapterları | Kod hazır (`apps/worker/src/providers/*`), hepsi `live_mode` kapısı arkasında, canlı çağrı kapalı |
| Migrator | Dry-run tüm ana tablolar için çalışıyor; **apply kapalı** (`migrationApplyDisabledMessage`) |
| Gözlemlenebilirlik | `/metrics`, health, alert runbook, monitoring profili tamam |
| Canlı ortam | Yok. Public URL olmadığı için Meta webhook'ları ve Live mode bekliyor |

Kritik yol: **Migrator apply → Staging ortamı → Canlı sağlayıcılar → Prova taşıma → Geçiş.** Frontend işleri bu yolun yanında paralel ilerler.

## Faz A — Açık uçları kapat (1–2 gün)

Tespit tarihi 2026-10-17.

Git / branch:

- [x] Yerel `main`'i `origin/main`'e çek (4 commit geride: PR #7 migrator düzeltmeleri).
- [x] Birleşmiş branch'leri sil: `fix/migrator-tracking-events`, `worktree-agent-a92c526c293629118` (yerel), `origin/fix/pipeline-review-followups` (içeriği #6 ile main'de, fark yok).
- [ ] `feat/meta-review-videos`: main üzerine rebase edildi, push edildi, PR #8 açıldı. Birleştirilmesi bekleniyor. Videolar `tmp/meta-review-videos/` altında.
- [x] PR #2 (`docs/operations/META_APP_PERMISSIONS.md`) birleştirildi.
- [ ] `wip/migrator-order-customers` (`1424356`): yalnız `syntheticOrderCustomerDraft` yardımcı fonksiyonu var, apply'a bağlanmamış, testi yok → Faz B'nin ilk işi olarak devral.

Doküman:

- [x] Migrator dokümanları kodun gerisindeydi, düzeltildi: `docs/migration/MIGRATOR_DESIGN.md` "apply devre dışı, dry-run yalnız satır sayar" diyordu; `MASTER_ROADMAP.md` başına güncel durum notu eklendi. Gerçek durum: tüm ana tablolar için apply yazıcıları ve gerçek PostgreSQL E2E testleri var.
- [x] Yalnız `tmp/` altında duran kritik bilgiler sırsız şekilde `docs/migration/LEGACY_DRYRUN_2026-10-11.md` dosyasına taşındı: dump kontrolü, gerçek veri dry-run sonuçları, eşleme kararları (9a–9f), hazırlık bulguları.
- [x] `P5_PARITY_GAPS.md` içindeki tekrar eden satırlar temizlendi (Raporlar, Instagram, Ayarlar hem "partial" hem "done").
- [x] Bu belgeyi commit'le.

## Faz B — Migrator apply aktivasyonu (kritik yol, ~1–2 hafta)

Mevcut durum: customer (adres + dış kimlik fan-out), conversation, message, product, order, order item, shipment ve kargo hareketi için apply yazıcıları var. Gerçek legacy kopyası (yerel Postgres `127.0.0.1:5440`, 4,1 GB) üzerinde dry-run 2026-10-11'de **geçti**: 617.905 satır, blokaj 0, uyarı 0, kullanıcı eşlemesi tamam. Apply hiç gerçek veriye karşı çalıştırılmadı.

1. [ ] Sentetik sipariş müşterisini apply yolunda yaz (wip branch; 2.379 sipariş).
2. [ ] Yeni sistemde 16 kullanıcıyı planlanan `usr_` public id'leriyle oluşturan betik (migrator kullanıcı taşımıyor).
3. [ ] Medya: 1.394 inline base64 (~1,88 GB) Garage'a, 4.104 süreli Meta CDN linki için karar (indir ya da yalnız URL).
4. [ ] Performans: akışlı row-content checksum (OOM riski), keyset sayfalama, toplu hedef yazımı (readiness O1–O3).
5. [ ] Rapor eksikliği: tekilleştirilen 2,35 M kargo hareketi kopyası raporda sayılmıyor.
6. [ ] Kapsam kararı: migrator'ın okumadığı tablolar (`ayarlar`, `bakiye_hareketleri`, `cari_hesaplar`, `faturalar`, `stok_hareketleri`, `sosyal_yorumlar`, `vapi_*`, `teyit_aramalari`, `odeme_istekleri`, `kargo_pipeline_kuyrugu`, `kisayollar`, log tabloları) ilk geçişe dahil mi, sıfırdan mı başlıyor?
7. [ ] Geçiş stratejisi: tek seferlik donma penceresi mi, delta senkron mu? (Migrator bugün yalnız tam snapshot yapıyor.)
8. [ ] Yerel kopyada boş bir hedefe tam apply → verify → ikinci apply sıfır duplicate.

Kabul: legacy kopyadan temiz hedefe tam taşıma, doğrulama raporu temiz.

## Faz C — Staging / canlı ortam (~3–5 gün, Faz B ile paralel başlayabilir)

- [ ] Dokploy üzerinde ortam: API, worker, web, web-beta, PostgreSQL, Redis, Garage.
- [ ] Public alan adı + TLS (Meta webhook'ları ve Live mode buna bağlı).
- [ ] Secret'lar ortam değişkeni değil, admin UI'dan girilecek şekilde; yalnız DB/çekirdek sırlar env'de.
- [ ] PostgreSQL otomatik yedek + PITR, ilk restore tatbikatı.
- [ ] Garage yedek/replication kararı ve tatbikatı.
- [ ] `monitoring` profili (Prometheus/Alertmanager/Grafana) ve alarm kanalı.
- [ ] Image vulnerability taraması CI'a.

## Faz D — Canlı sağlayıcı aktivasyonu (~1 hafta, Faz C'den sonra)

Her sağlayıcı için aynı adımlar: staging'de hesap gir → `live_mode` aç → tek gerçek işlem → provider attempt kaydını doğrula → hata/retry senaryosunu gözle.

| Sıra | Sağlayıcı | Ön koşul |
| --- | --- | --- |
| 1 | SMTP | E-posta hesabı (şifre sıfırlama) |
| 2 | NetGSM (SMS, IVR teyit, sesli mesaj) | IVR webhook adresi public olmalı |
| 3 | PTT, Sürat | Test gönderisi + etiket basımı |
| 4 | KolayBi | Test cari/fatura; e-fatura dikkatli |
| 5 | WhatsApp Cloud API | Güncel Cloud API değişikliklerine uyum kontrolü, WABA ödeme yöntemi, webhook |
| 6 | Instagram / Messenger | Instagram Login ile IGAA token, webhook aboneliği, Live mode |
| 7 | VAPI + SIP | Santral bilgileri, gerçek test araması |

Not: Meta uygulaması (`1413725227640949`) hazır; kalanlar memory notunda ve `tmp/meta-app/KURULUM_OZETI.md` içinde.

## Faz E — Frontend son eksikler ve panel kararı (paralel)

- [ ] **Karar:** canlıya hangi panel çıkıyor — `apps/web` (legacy görünüm), `apps/web-beta` (yeni tasarım) ya da ikisi birlikte?
- [ ] Softphone widget'ı ve gelen arama modalı (P5 Layout/components satırı).
- [ ] Mesajlar: satır içi medya önizleme ve kalan küçük ekstralar.
- [ ] Barkod yazdır sayfası ve NetGSM görüşme raporu ekranlarının son kontrolü.
- [ ] Personelle kullanıcı kabul testi (UAT): her rol için gerçek bir iş günü senaryosu.

## Faz F — Güvenlik sertleştirme (Faz D ile paralel)

- [ ] Meta webhook imza doğrulaması (`X-Hub-Signature-256`) tüm Meta uçlarında; `POST /api/facebook/data-deletion` şu an imzayı doğrulamıyor.
- [ ] Webhook replay koruması, rate limit testleri.
- [ ] RBAC izin matrisi testi (owner/admin/calisan/kargo_operatoru).
- [ ] Secret rotation runbook'u ve bir tatbikat.

## Faz G — Prova ve geçiş (~1 hafta)

1. [ ] Staging'de legacy kopyasıyla tam prova taşıma, süre ölçümü.
2. [ ] Geçiş günü planı: duyuru, legacy'yi yazmaya kapatma, son yedek, `migrate --apply`, doğrulama, DNS/yönlendirme.
3. [ ] Geri dönüş planı: yeni sistem başarısız olursa legacy'yi yeniden yazılabilir açma adımları.
4. [ ] Geçiş sonrası 2 hafta yakın takip (hata, kuyruk, sağlayıcı hataları).
5. [ ] Legacy Supabase'i salt okunur bırak, sonra kapat.

## Kabaca takvim

| Hafta | İş |
| --- | --- |
| 1 | Faz A + Faz B başlangıcı + Faz C kurulum |
| 2 | Faz B tamamlanır, staging ayakta |
| 3 | Faz D (canlı sağlayıcılar) + Faz F |
| 4 | Faz E UAT + Faz G prova |
| 5 | Geçiş + yakın takip |

Takvim, legacy veritabanı kopyasına erişim ve sağlayıcı hesaplarının ne kadar hızlı hazırlanacağına bağlıdır.

## Senin karar vermen / sağlaman gerekenler

- Canlıya çıkacak panel (web, beta ya da ikisi).
- Sunucu ve alan adı (Dokploy hedefi).
- Legacy veritabanının bir kopyası (prova taşıma için).
- Sağlayıcı hesapları: SMTP, NetGSM, PTT, Sürat, KolayBi test erişimi, WABA ödeme yöntemi, Instagram Login.
- Geçiş için uygun tarih aralığı (iş yoğunluğunun düşük olduğu gün).
