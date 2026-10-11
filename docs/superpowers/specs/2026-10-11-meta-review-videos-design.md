# Meta App Review kanıt videoları: tasarım

Tarih: 2026-10-11. Durum: onaylandı (sohbette), uygulama planı bekliyor.

## Amaç

Yeni Meta uygulaması "Garanti Kuluçka Panel" (App ID 1413725227640949) için istenen her izin ve
özelliğe Advanced access başvurusunda kullanılacak İngilizce ekran kayıtlarını üretmek. Kayıtlar
web-beta panelinde (`apps/web-beta`) Playwright ile, taklit backend'e karşı, tekrarlanabilir biçimde
alınır. Meta inceleyicisi her videoda hangi izinle hangi işin yapıldığını adım adım görür.

Kullanıcı kararı: Standard access kendi işletme varlıkları için yeterli olsa da "garanti olsun" diye
tüm izinlere Advanced başvurusu yapılacak; videolar bunun kanıtı. Ortam olarak gerçek uçtan uca
değil **panel + taklit backend** seçildi. Bilinen risk: mesajlaşma izinlerinde Meta gerçek
Instagram/WhatsApp tarafını göremediği için ret gelebilir; bu durumda ikinci tur için gerçek ortam
gerekir (ayrı iş).

## Kapsam dışı

- Ürün kodunda (apps/api, apps/worker, apps/web-beta) değişiklik yok.
- Gerçek Meta API'lerine bağlanma, webhook, Instagram Login.
- Video kurgu/seslendirme; yalnız ekran içi İngilizce altyazı şeridi.
- App Review formunun doldurulup gönderilmesi (gerekçe metinleri `tmp/meta-app/KURULUM_OZETI.md`
  9. bölümde hazır; gönderim kullanıcıya ait).

## Yapı

```
tests/meta-review/
  playwright.config.ts     # ayrı proje; *.review.ts; video on; 1440x900; workers 1
  recording.ts             # startScenario, caption, pause, endScenario
  fixtures.ts              # İngilizce taklit veri ve ortak ExtraRoute parçaları
  whatsapp-messaging.review.ts
  whatsapp-management.review.ts
  instagram-basic.review.ts
  instagram-messages.review.ts
  instagram-comments.review.ts
  instagram-publish.review.ts
  instagram-insights.review.ts
  messenger.review.ts
  page-comments.review.ts
  business-management.review.ts
tools/meta-review-collect.mjs   # test-results/meta-review/** → tmp/meta-review-videos/<izin>.webm
```

Kök `package.json`:

- `review:videos`: `npm run build -w @garanti-kulucka/shared && npm run build:e2e -w @garanti-kulucka/web-beta && playwright test -c tests/meta-review/playwright.config.ts && node tools/meta-review-collect.mjs`

`verify:structure` (tools/verify-repo-structure.mjs) yeni dizini kabul etmeli; gerekiyorsa izin listesine
eklenir.

## Playwright yapılandırması

`tests/playwright-beta/playwright.config.ts` ile aynı `webServer` komutu (`vite preview --outDir dist-e2e`),
port 4320 (beta 4319 ile çakışmasın). Farklar:

- `testMatch: "**/*.review.ts"`, `outputDir: "../../test-results/meta-review"`.
- `use.video: { mode: "on", size: { width: 1440, height: 900 } }`, `viewport: { width: 1440, height: 900 }`,
  `screenshot: "off"`, `trace: "off"`.
- `workers: 1`, `fullyParallel: false`, `retries: 0`, `timeout: 180_000`.
- `launchOptions.slowMo: 150` (PW_CHROMIUM_EXECUTABLE desteği korunur).
- `locale: "en-GB"`, `timezoneId: "Europe/Istanbul"`.
- `reporter: [["list"]]`.

## Kayıt yardımcıları (`recording.ts`)

- `startScenario(page, { permission, title })`: `localStorage["garanti-beta-lang"] = "en"` (addInitScript),
  `mockBackend` + `login` (helpers'tan), `/` yüklenince başlık şeridi: `"<title> — permission: <permission>"`.
  Döner: `{ caption, pause, end }`.
- `caption(text)`: sayfanın üstüne sabit, yarı saydam koyu şerit (`#meta-review-caption`, z-index en üst,
  16px, İngilizce). Her çağrı metni değiştirir ve 1,5 sn bekler. Şerit `addInitScript` ile her
  navigasyonda yeniden oluşur.
- `pause(ms = 1500)`: `page.waitForTimeout`.
- `end()`: son ekranı 3 sn tutar, şeridi "End of demonstration" yapar.
- `recordTag(testInfo, permission)`: test başlığı ve `testInfo.annotations` ile izin adını işaretler;
  collect script video dosyasını bu ada göre adlandırır.

Kullanıcı: `mockUser("admin", { first_name: "Support", last_name: "Agent", email: "agent@garantikulucka.com" })`.

## Taklit veri (`fixtures.ts`)

`tests/playwright-beta/helpers.ts` değişmez; oradaki `mockBackend`/`login`/`chooseOption` kullanılır.
`fixtures.ts` İngilizce içerikli konuşmalar, mesajlar, yorumlar, sağlayıcı ayarları ve Instagram
analitik/yayın cevaplarını `ExtraRoute` olarak üretir. "Gelen mesaj" etkisi: route içinde bir sayaç
tutulur; senaryo `caption("A customer sends a new WhatsApp message…")` dedikten sonra route yeni
konuşma/mesajı döndürmeye başlar ve panel listeyi yenileyince mesaj belirir (web-beta'nın mevcut
yenileme/polling davranışı neyse o kullanılır; yoksa sayfa navigasyonu ile tetiklenir).

Standart kişiler: müşteriler "Emma Clarke" (WhatsApp), "Liam Walker" (Instagram), "Olivia Bennett"
(Messenger); ürünler "Incubator Model A", "Spare Motor"; sipariş "GK-1042" ve kargo takip "TRK900042".

## Senaryo → izin eşlemesi

| Dosya | İzin/özellik | Adımlar (altyazılarla) |
|---|---|---|
| whatsapp-messaging | whatsapp_business_messaging | Mesajlar açılır → WhatsApp konuşması gelir → metin yanıtı → görsel + PDF ekle ve gönder → sipariş GK-1042 kargo bilgisini gönder |
| whatsapp-management | whatsapp_business_management | Ayarlar → WhatsApp sekmesi: numara, kalite, iş profili, şablon listesi, webhook adresi, kaydet |
| instagram-basic | instagram_business_basic | Ayarlar → Instagram: hesabı bağla → profil adı, kullanıcı adı, medya sayısı görünür |
| instagram-messages | instagram_business_manage_messages, Human Agent | Instagram DM gelir → yanıt → 24 saati geçmiş konuşmada Human Agent anahtarı açılır → yanıt gönderilir |
| instagram-comments | instagram_business_manage_comments | Yorumlar, platform=Instagram: listele → yanıtla → gizle → sil |
| instagram-publish | instagram_business_content_publish | Instagram Yayınla: görsel URL + açıklama → yayınla → sonuç kartı |
| instagram-insights | instagram_business_manage_insights | Instagram Analitik: metrik kartları, gün aralığı değişimi, günlük grafik, yenile |
| messenger | pages_messaging, pages_show_list, pages_manage_metadata, Human Agent | Ayarlar → Messenger: Sayfa listesinden seç, bağla, webhook aboneliği → Mesajlar: Messenger konuşması yanıtlanır, Human Agent |
| page-comments | pages_read_engagement, pages_read_user_content, pages_manage_engagement | Yorumlar, platform=Facebook: listele → yanıtla → gizle → sil |
| business-management | business_management | Ayarlar → Entegrasyonlar: portföye bağlı Sayfa/IG/WABA varlıkları listelenir ve seçilir |

Handover Protocol için ayrı video yok (panelde arayüzü yok); pages_manage_metadata webhook aboneliğiyle
gösterilir. Her video 1–3 dakika.

## Çıktı

`tools/meta-review-collect.mjs`: `test-results/meta-review/**/video.webm` dosyalarını, aynı klasördeki
test adı (Playwright klasör adı `<spec>-<test>-<proje>`) üzerinden izin adına çevirip
`tmp/meta-review-videos/<permission>.webm` olarak kopyalar; `ffmpeg` PATH'te varsa `.mp4` de üretir,
yoksa uyarı yazar. Sonunda tabloyu (izin → dosya → süre) stdout'a basar.

## Hata yönetimi

Senaryolar `expect` ile ilerler; adım başarısız olursa Playwright videoyu yine yazar, koşu kırmızı
biter ve collect script eksik izinleri "MISSING" olarak listeler. `retries: 0`, çünkü tekrar koşum
videoyu bozar.

## Doğrulama

- `npm run review:videos` 10 videoyu üretir; collect tablosunda MISSING yok.
- Her videonun ilk karesi İngilizce başlık şeridini, son karesi "End of demonstration" şeridini
  gösterir (collect script ffmpeg varsa ilk/son kareyi PNG olarak da çıkarır; yoksa elle kontrol).
- `npm run verify:structure` ve `npm run lint` geçer; mevcut `test:e2e:beta` etkilenmez.
