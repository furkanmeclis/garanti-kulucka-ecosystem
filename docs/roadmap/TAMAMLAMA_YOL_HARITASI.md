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

### Faz B kararları (sahibiyle, 2026-10-17)

- **Medya taşınmaz.** Gömülü base64 dosyalar (1.394 mesaj, ~1,88 GB) ve bridge `s3://` nesneleri hedef storage'a yazılmaz. Mesajın metni, tarihi ve medya türü taşınır; mesajda "taşınmadı" notu görünür. Bu yüzden B.3 ve performans maddelerinin medya kısmı düşer, apply için Garage gerekmez.
- **Yalnız taşıma kapsamında.** Yeni sistem kendi dosyaları (ekler, Instagram yayını, faturalar) için Garage'ı kullanmaya devam eder.
- **Meta CDN linkleri** (4.104 mesaj) metin olarak kalır, indirilmez.
- **Satırlar kesilmez.** Tarih sınırı yok; tüm müşteri, konuşma, mesaj metni, sipariş ve kargo taşınır.
- **Boş legacy tablolar** (faturalar, cari hesaplar, sosyal/Instagram yorumları, stok hareketleri, teyit aramaları, VAPI kuyruğu) için iş yok.
- **Taşınmayanlar:** `bakiye_hareketleri` ve `odeme_istekleri` (bakiye sıfırdan başlar; legacy'de 7 personelde toplam 4.400 TL güncel bakiye vardı, sahibi bilerek kabul etti), `stocks` (Ocak'ta bir kez doldurulmuş terk edilmiş tablo; gerçek stok `urunler`'den zaten taşınıyor), `ayarlar`/`settings` (admin panelden elle girilir), `kargo_pipeline_kuyrugu`, `islem_kayitlari`/`islem_loglari`.
- **Kısayollar migrator ile taşınır, medyasıyla birlikte** (medya kuralına tek istisna): 53 kısayol → `message_shortcuts`; 10 medya → `message_shortcut_attachments` + Garage. 7'si dump'taki gömülü base64'ten (~2,9 MB), 3'ü legacy public storage URL'sinden (`db.garantikulucka.com/storage/v1/object/public/...`) indirilir. Bu yüzden apply'da yalnız kısayol medyası için storage yapılandırması gerekir.
- **Müşterisi olmayan siparişler (B, 2026-10-17):** legacy'de yalnız 12 siparişte `musteri_id` var; 2.304 sipariş telefonun son 10 hanesiyle mevcut müşteriye bağlanır. Kalan 2.379 sipariş için **telefon başına tek sentetik müşteri** açılır (2.260 telefon + 11 telefonsuz sipariş için ayrı ayrı = 2.271 müşteri). Ad en son siparişteki ad olur; farklı adlar (48 telefonda) müşteri notuna yazılır; adres siparişteki adresten `customer_addresses`'a gider. Müşteriyi boş bırakmak reddedildi: `orders` tablosunda müşteri adı/telefon/adres alanı olmadığı için veri kaybı olurdu. Messenger/Instagram müşterilerinin `telefon` alanı gerçek telefon değil (`fb_…`/`ig_…` kimliği); bu yüzden onlarla otomatik telefon eşleşmesi olmaz, gerekirse geçiş sonrası elle birleştirme.
- **Kullanıcılar (2026-10-17):** 16 legacy kullanıcının hepsi apply'dan önce bir betikle planlanan `usr_` public id'leriyle oluşturulur (liste repo dışında). Fiilen çalışan **4 kişi aktif**, diğer 12'si **pasif** (giriş yok, geçmiş kayıtlardaki "kim yaptı" bilgisi korunur). Owner: proje sahibi. Şifreler taşınamaz (Supabase auth dump'ta yok); betik aktif kullanıcılar için **geçici şifre** üretir, admin dağıtır, kullanıcı ilk girişte değiştirir. SIP bilgisi olan 2 kullanıcının SIP kullanıcı adı/şifresi de taşınır; yeni `users` tablosunda dahili numarası alanı yok, arama kayıtları işiyle eklenecek.
- **Geçmiş kayıtlar taşınır:** `sms_gonderimler` (270) → `sms_messages`, `vapi_aramalar` (21) → `vapi_calls`, `arama_kayitlari` (192) → hedef tablo henüz yok (açık konu).

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

- [x] **Karar (2026-10-17): canlıya yalnız `apps/web-beta` çıkar.** `apps/web` kabul kapısı değildir; yeni özellikler ve eksik kapatmaları betaya yapılır, `apps/web` yalnız kırılmayacak kadar korunur. "Tamam" işaretli her iş betada ayrıca doğrulanmalıdır.
- [ ] **Beta softphone:** betada hiç softphone yok (`apps/web/src/ui/softphone/` yalnız eski panelde). JsSIP motoru betaya taşınacak, gelen arama modalıyla birlikte.
- [ ] **Arama kayıtları (eksik bulundu, 2026-10-17):** legacy softphone her aramayı `arama_kayitlari`'na yazıyordu; yeni sistemde tablo, API ve kayıt yok (eski P6 "call-log persistence" maddesi hiç yapılmamış). Tasarım ve kararlar:
  - **Ana kaynak NetGSM santral webhook'u** ("URL'e yönlendirme", [netsantraldokuman](https://www.netgsm.com.tr/netsantraldokuman/)): olaylar (Inbound/Outbound/Answer/Hangup/Queue/DTMF/Context) ve nihai `cdr` kaydı. Tüm alanlar saklanır: unique_id/kimlik/ortakkimlik/asteriskId, arayan, aranan, clid, internal_num (dahili), customer_num, yon, sondurum (1 cevaplandı, 2 cevapsız, 3 meşgul, 4 timeout, 5 failed), sure/talktime, holdtime, queue_name, context, digit, trunk, callInitiated/Queued/Connected/EndedTime, ses kaydı; ham payload da tutulur. Public URL gerektirir (Faz C).
  - **Gece tamamlama:** `netsantral/report` ile önceki gün 24 saatlik dilimlerle çekilir, kaçan kayıtlar eklenir (sınır: aralık ≤ 24 saat, dakikada ≤ 2 sorgu).
  - **Eşleme:** dahili → kullanıcının SIP dahilisi; dış numara → müşteri telefonu; sipariş bağı yalnız beta softphone'dan sipariş üzerinden başlatılan aramada.
  - **Ses kayıtları Garage'a indirilir** (kalıcı arşiv), panelde oradan dinlenir.
  - **Cevapsız gelen arama** betada bildirim zili ile personele bildirilir.
  - **Yetki:** personel yalnız kendi aramalarını, yönetici hepsini görür (ses kaydı dahil).
  - Betada: "Arama Geçmişi" sayfası (yön/durum/personel/tarih filtresi), müşteri ve sipariş detayında arama sekmesi.
  - 192 legacy kayıt migrator ile taşınır (daha az alan; eksikler boş).
  - **Hata:** mevcut `callReportRequest` varsayılan 7 günlük aralık istiyor; NetGSM 24 saatten uzununu hata 60 ile reddeder. Düzeltilecek.
- [ ] **Müşteri birleştirme** (yeni sistemde yok): Messenger/Instagram müşterisi ile telefonla oluşan müşteri kaydını betada elle birleştirme; konuşma, sipariş, adres ve dış kimlikler taşınır.
- [ ] Beta eşitlik taraması: koordinatör listesinde "tamam" olan işleri legacy davranışıyla betada tek tek karşılaştır.
- [ ] Mesajlar: satır içi medya önizleme ve kalan küçük ekstralar.
- [ ] Barkod yazdır sayfası ve NetGSM görüşme raporu ekranlarının son kontrolü.
- [ ] Personelle kullanıcı kabul testi (UAT): her rol için gerçek bir iş günü senaryosu.

## Faz F — Güvenlik sertleştirme (Faz D ile paralel)

- [ ] Meta webhook imza doğrulaması (`X-Hub-Signature-256`) tüm Meta uçlarında; `POST /api/facebook/data-deletion` şu an imzayı doğrulamıyor.
- [ ] Webhook replay koruması, rate limit testleri.
- [ ] RBAC izin matrisi testi (owner/admin/calisan/kargo_operatoru).
- [ ] Secret rotation runbook'u ve bir tatbikat.

## Faz G — Prova ve geçiş (acil)

**Karar (2026-10-17):** legacy sunucu disk dolu (%96, ~187 GB) ve sürekli kırılıyor; geçiş acil. Yeni sistem **aynı sunucuya** kurulacak: legacy veriler yerele alınır, sunucu sıfırlanıp Dokploy kurulur, migrator yereldeki veriyle yeni sunucuya çalışır. Sunucu sıfırlandığı an legacy'ye geri dönüş yolu kapanır; bu yüzden prova ikinci bir sunucuda yapılır ve sıfırlamadan önce aşağıdaki kontrol listesi eksiksiz tamamlanır. Canlıya yalnız beta panel çıkar (`web` servisi compose'dan kaldırıldı).

Hazırlık (legacy sunucuya dokunmadan):

1. [ ] Faz B kod işleri bitmiş, yerel legacy kopyasıyla tam apply + beta panelde kontrol yapılmış.
2. [ ] Prova sunucusunda Dokploy kurulumu + deploy + migrator apply, süre ölçümü.
3. [ ] Dokploy ayarları (compose, env, alan adları, Garage) hazır ve yazılı.

Sıfırlamadan önce legacy'den alınacaklar (geri dönüşü olmayan adım):

4. [ ] Veritabanı dump'ı **sunucuya yazmadan** doğrudan yerele akıtılır (disk dolu: `ssh ... pg_dump -Fc | > yerel dosya`), iki ayrı yerde saklanır, SHA-256 ve `pg_restore --list` ile doğrulanır.
5. [ ] Legacy sırlar ve sağlayıcı ayarları: sunucu `.env` dosyaları + veritabanındaki ayar/token kayıtları (WhatsApp, Instagram, Messenger, NetGSM, PTT, Sürat, KolayBi, VAPI, SIP). Yeni admin paneline girilecek.
6. [ ] Supabase storage: en az kısayol medyası (3 dosya); mümkünse tüm bucket'ların yedeği.
7. [ ] Sunucu envanteri: çalışan servisler, cron'lar, alan adları/DNS, sertifikalar, webhook adresleri (Meta, NetGSM IVR/santral).

Geçiş günü:

8. [ ] Legacy panel kapatılır, son dump (4–6 tekrar).
9. [ ] Sunucu sıfırlanır, Dokploy kurulur, yeni sistem deploy edilir.
10. [ ] Kullanıcılar betikle oluşturulur, 3 entegrasyon hesabı girilir, migrator apply (yerel dump → SSH tüneli ile yeni DB, ya da dump sunucuda).
11. [ ] Webhook adresleri (Meta, NetGSM) yeni sisteme çevrilir.
12. [ ] Duman testi: gerçek mesaj, sipariş, kargo; personele geçici şifreler.
13. [ ] Geçiş sonrası 2 hafta yakın takip (hata, kuyruk, sağlayıcı hataları).

Tahmini kesinti: 3–5 saat (prova ile kesinleşecek).

### Legacy sunucu envanteri (salt okunur inceleme, 2026-10-17)

Ubuntu 24.04, 4 çekirdek, 15 GB RAM, 193 GB disk (%96 dolu), Coolify 4.3.23 + Traefik. Sahibinin kararıyla geçişe kadar sunucuya dokunulmayacak.

- **Disk:** 152 GB Docker volume'lerinde. Bunun ~135 GB'ı iş verisi değil, Supabase'in kendi log tablosu (`_supabase` veritabanı, `_analytics.log_events_*`): üretim Supabase'inde 71 GB, ikinci Supabase'te 64 GB. Üretimdeki iş verisi (`postgres` veritabanı) yalnız ~5 GB. Kırılmaların sebebi bu log şişmesi; yeni sistemde Supabase olmadığı için tekrarlamaz.
- **Üretim Supabase:** `kc00sgwkko0wsog40oo8w44k`, `db.garantikulucka.com`. Dump bundan alınır.
- **İkinci Supabase:** `ouv4no088zjeouarigxb74an`, sslip alan adı; `public` şemasında hiç tablo yok, kullanılmıyor.
- **Coolify uygulamaları:** `panel.garantikulucka.com` (legacy panel), `garantikulucka.com` (web sitesi), `account.asistzone.com` (**garanti dışı başka bir ürün**), legacy worker'lar (`worker`, `2mesaj-worker`, `voice-worker`) ve bir Redis.
- **Kullanılmayan volume'ler:** n8n, ayrı bir PostgreSQL ve iki eski Supabase veritabanı (bağlı container yok).
- **Sıfırlamadan önce karar gerekenler:** `garantikulucka.com` ve `account.asistzone.com` nereye taşınacak (aynı sunucuda Dokploy'a mı, başka yere mi); bunların kaynak kodu ve verisi yedeklenmeli.

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
