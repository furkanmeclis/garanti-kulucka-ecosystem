# Meta Uygulaması: Kurulum, İzinler ve App Review Planı

Durum: taslak (2026-10-10). Amaç, Garanti Kuluçka için **tek ve yeni** bir Meta for Developers uygulaması açıp
WhatsApp, Instagram ve Messenger entegrasyonlarını bu uygulamada toplamak ve App Review'a hangi izinlerle,
hangi gerekçe ve videolarla gideceğimizi netleştirmektir.

Kaynaklar: yeni repo (`apps/worker/src/providers/{whatsapp,meta-message,instagram-graph}.ts`,
`apps/api/src/webhooks/*`, `apps/api/src/http/{instagram,comment,integration,privacy}-routes.ts`) ve eski panel
(`MrBoos/garanti` `server.js`, `routes/commentAiRouter.js`). Meta izin adları ve kuralları zamanla değişir;
başvurudan önce App Dashboard'daki güncel listeyle karşılaştırılmalıdır (bkz. "Doğrulanacaklar").

## 1. Bugünkü durum (neden yeni uygulama)

- Canlıdaki kimlik bilgileri **en az üç farklı Meta uygulamasına** dağılmış durumda:
  WhatsApp token'ı, env'deki Instagram (`INSTAGRAM_APP_ID`) ve Messenger (`MESSENGER_APP_ID`) uygulamalarından
  farklı bir uygulamaya ait (`debug_token` "App_id did not match" döndü).
- Eski panelde Instagram ve Messenger token'ları env'de boş; OAuth ile alınıp Supabase'de saklanıyor.
- Instagram iki ayrı API yoluyla kullanılıyor: **Instagram API with Instagram Login** (asıl, `graph.instagram.com`,
  `IGAA…` token) ve **Facebook Login / Sayfa üzerinden** (yedek, `graph.facebook.com`).
- Kodda istenen izinlerle, gerçekten kullanılan özellikler arasında boşluklar var (yorum yönetimi izinleri hiç istenmiyor).
- WhatsApp numarası (+90 322 911 03 70) sağlıklı: isim onaylı, kalite GREEN; `code_verification_status` EXPIRED (numara
  taşıma/yeniden kayıtta tekrar doğrulama gerekir).

## 2. Uygulama yapısı

| Ayar | Değer |
|---|---|
| Uygulama türü | **Business** |
| Business Portfolio | Garanti Kuluçka işletme hesabı (WhatsApp WABA ve Facebook Sayfası bu portföyde olmalı) |
| İşletme doğrulaması | **Zorunlu** (Advanced Access ve WhatsApp limitleri için) |
| Use case'ler | 1) WhatsApp ile müşterilerle bağlantı kur · 2) Instagram'da mesaj ve içerik yönet (Instagram Login) · 3) Messenger'da müşterilerle etkileşim · 4) Sayfanızdaki her şeyi yönetin (yorumlar) |
| Ürünler | WhatsApp, Instagram (Instagram Login), Messenger, Webhooks, Facebook Login for Business (yalnız Sayfa token'ı için) |
| Sistem kullanıcısı | Business Settings → System Users: "garanti-panel" (Admin), kalıcı token; WABA + Sayfa + IG hesabı varlık olarak atanır |
| Graph API sürümü | Kodda **v26.0**; eski kalıntılar (v21.0/v18.0) temizlenmeli |
| Gizlilik / Koşullar / Veri silme | `https://panel.garantikulucka.com/gizlilik-politikasi`, `/kullanim-kosullari`, veri silme callback `/veri-silme` (yeni API: `privacy-routes.ts`) |

## 3. İstenecek izinler

"Kullanım" sütunu kodda karşılığı olan özelliği, "Gerekçe" App Review formuna yazılacak metnin özünü gösterir.

### WhatsApp

| İzin | Erişim | Kullanım | Gerekçe |
|---|---|---|---|
| `whatsapp_business_messaging` | Advanced | Metin/medya gönderme, okundu bilgisi, gelen mesaj webhook'u (`whatsapp.ts`) | Müşteri sorularını ve sipariş/kargo bilgilendirmelerini paneldeki temsilciler WhatsApp üzerinden yanıtlar. |
| `whatsapp_business_management` | Advanced | Numara/profil okuma, şablon yönetimi (planlı), WABA webhook aboneliği | Numara kalitesi ve iş profili panelde izlenir; onaylı şablonlarla 24 saat dışı bilgilendirme yapılır. |

### Instagram (Instagram API with Instagram Login)

| İzin | Erişim | Kullanım | Gerekçe |
|---|---|---|---|
| `instagram_business_basic` | Advanced | Hesap bilgisi, profil, medya listesi | Bağlı işletme hesabını ve müşteri adlarını panelde göstermek. |
| `instagram_business_manage_messages` | Advanced | DM alma/gönderme, HUMAN_AGENT etiketi, gizli yanıt | Instagram'dan gelen ürün/sipariş sorularını temsilcilerin panelden yanıtlaması. |
| `instagram_business_manage_comments` | Advanced | Yorumları okuma, yanıtlama, gizleme, silme; `comments`/`live_comments` webhook | **Şu an kullanılıyor ama hiç istenmiyor.** Yorumlar sekmesi müşteri yorumlarını yanıtlar ve uygunsuzları gizler. |
| `instagram_business_content_publish` | Advanced | Görsel ve Reels yayınlama (`instagram-routes.ts`) | Ürün tanıtım içeriklerinin panelden planlanıp yayınlanması. |
| `instagram_business_manage_insights` | Advanced | Hesap ve gönderi analitiği (insights worker) | Pazarlama raporları için erişim/etkileşim metrikleri. |

### Messenger ve Facebook Sayfası

| İzin | Erişim | Kullanım | Gerekçe |
|---|---|---|---|
| `pages_messaging` | Advanced | Messenger mesajlaşma, HUMAN_AGENT | Facebook Sayfası'na gelen müşteri mesajlarını panelden yanıtlamak. |
| `pages_manage_metadata` | Advanced | Sayfa webhook aboneliği (`subscribed_apps`), Handover Protocol | Gelen mesaj/yorum bildirimlerini almak; AI ile temsilci arasında konuşma devri. |
| `pages_show_list` | Advanced | Bağlanacak Sayfa'yı seçmek | Kurulumda doğru Sayfa'nın seçilmesi. |
| `pages_read_engagement` | Advanced | Sayfa içeriği ve yorumları okuma | Yorumlar sekmesinde Sayfa yorumlarını listelemek. |
| `pages_manage_engagement` | Advanced | Sayfa yorumlarına yanıt, gizleme, silme | **Eski panelde kullanılıyor ama istenmiyor.** |
| `pages_read_user_content` | Advanced | Ziyaretçi gönderi/yorumlarını okuma | Sayfa'ya kullanıcıların yazdığı yorumları görmek (yorum yönetimiyle birlikte). |
| `business_management` | Advanced | Portföydeki varlıkları (Sayfa, IG, WABA) okumak/atamak | Sistem kullanıcısı token'ının varlıklara erişimi. |
| **Human Agent** özelliği | Feature | `MESSAGE_TAG: HUMAN_AGENT` (7 günlük pencere) | Müşteri 24 saat sonra dönüş beklediğinde temsilcinin yanıt verebilmesi. |

### İstenmeyecekler (bilerek)

- `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` (Facebook Login yolu): yalnızca Instagram
  Login'e tamamen geçilmezse gerekir. Öneri: Instagram Login'e geçip bu yolu kaldırmak; Handover Protocol IG için
  hâlâ Sayfa üzerinden çalışıyorsa bu karar App Review'dan önce test edilmeli.
- `ads_*`, `leads_retrieval`, `catalog_management`, `pages_manage_posts`: kodda kullanım yok. Gereksiz izin review'ı zorlaştırır.

## 4. Webhook abonelikleri

| Nesne | Alanlar | Yeni API yolu |
|---|---|---|
| `whatsapp_business_account` | `messages` (gelen mesaj + `statuses`), `message_template_status_update` (şablon kullanılınca) | `/webhooks/whatsapp` |
| `instagram` | `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`, `message_echoes`, `comments`, `live_comments`, `mentions` | `/webhooks/instagram` |
| `page` | `messages`, `messaging_postbacks`, `messaging_referrals`, `message_deliveries`, `message_reads`, `message_echoes`, `messaging_handovers`, `standby`, `feed` | `/webhooks/messenger` |

Not: Eski panel `message_echoes` olaylarını işliyor ama abone olmuyor; `standby` hiç işlenmiyor (Handover kullanılıyorsa gerekli).
Yeni API'de imza doğrulaması (`X-Hub-Signature-256`) `webhook.app_secret` ayarlanınca `enforce` moduna alınmalı.

## 5. App Review videoları (Playwright ile)

Her izin için ayrı, 1–3 dakikalık ekran kaydı; tarayıcı arayüzü İngilizce, gerçek test hesaplarıyla. Plan: `tests/meta-review/`
altında Playwright senaryoları, `video: "on"` ve sabit viewport (1440×900) ile; çıktı `test-results/meta-review/<izin>.webm`.
Videolarda "Meta'daki uç nokta → paneldeki sonuç" zinciri görünmeli (ör. Instagram'dan DM gönder → panelde belirir → yanıtla → Instagram'da görünür).

| Senaryo | Kapsadığı izinler |
|---|---|
| Instagram hesabını bağlama (Instagram Login onay ekranı dahil) | `instagram_business_basic` |
| Instagram DM al → panelde yanıtla → 24 saat dışı HUMAN_AGENT ile yanıt | `instagram_business_manage_messages`, Human Agent |
| Yorumlar sekmesi: yorum gör, yanıtla, gizle, gizli yanıt gönder | `instagram_business_manage_comments` |
| Panelden görsel ve Reels yayınla → Instagram'da görünür | `instagram_business_content_publish` |
| Instagram analitik ekranı | `instagram_business_manage_insights` |
| Facebook Sayfa'yı bağla, Messenger mesajı al/yanıtla | `pages_show_list`, `pages_messaging`, `pages_manage_metadata` |
| Sayfa yorumunu yanıtla/gizle | `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement` |
| AI → temsilci devri (Handover) | `pages_manage_metadata` |
| WhatsApp mesajı al/yanıtla, medya gönder, sipariş bilgilendirmesi | `whatsapp_business_messaging` |
| Numara/profil bilgisi ve şablon listesi | `whatsapp_business_management` |

## 6. Kodda yapılması gerekenler (review'dan önce)

1. **Inbound webhook işleme**: yeni API webhook'ları kaydediyor ama mesaj/yorum oluşturmuyor (`handleProviderWebhookJob` fixture).
   Review videoları bu olmadan çekilemez.
2. **OAuth bağlantı akışları** (Instagram Login, Facebook Login for Business) yeni API'de yok; şu an token elle giriliyor.
3. IG/Messenger **medya gönderimi**, `mark_seen`, profil (isim/kullanıcı adı) okuma yeni API'de yok.
4. **Facebook Sayfa yorumları** yeni API'de yok (yalnız Instagram).
5. Instagram insights: `impressions`/`video_views` metrikleri yeni Graph sürümlerinde kaldırıldı/değişti; `views` vb. ile güncellenmeli.
6. Ayarlar formu yalnız `external_account_id` kaydediyor; worker `page_id`/`ig_user_id` ayarını okuyor (eşleşme hatası riski).
7. Veri silme callback'inde `signed_request` imzası doğrulanmıyor (her iki repoda da).
8. Graph sürümü kalıntıları (v21.0, v18.0) temizlenmeli.

## 7. WhatsApp Cloud API güncellemeleri

Bilinen değişiklikler (başvurudan önce Meta changelog ile teyit edilecek): On-Premises API'nin kapatılması (yalnız Cloud API),
1 Temmuz 2025'ten itibaren konuşma bazlı yerine **mesaj (şablon) bazlı fiyatlandırma** ve hizmet (service) mesajlarının
ücretsiz olması, şablon kategorisi kurallarının sıkılaşması (marketing/utility), Graph sürümlerinin yıllık kullanımdan kaldırılması.
Etkisi: sipariş/kargo bilgilendirmeleri **utility şablonu** olarak onaylatılmalı; 24 saat penceresi dışındaki tüm gönderimler şablonla yapılmalı.

## 8. Doğrulanacaklar

- İzin adlarının App Dashboard'daki güncel karşılıkları (Meta, Instagram izinlerini 2025'te `instagram_business_*` adlarına taşıdı).
- Human Agent'ın hâlâ ayrı bir "feature" başvurusu olup olmadığı.
- Handover Protocol'ün Instagram Login token'larıyla çalışıp çalışmadığı.
- WhatsApp Cloud API ve Graph v26+ için son changelog maddeleri.
