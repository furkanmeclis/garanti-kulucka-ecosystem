/**
 * Legacy PrivacyPolicyPage.jsx and TermsOfServicePage.jsx text, shared by the web and beta panels.
 * The Turkish text follows the legacy pages; infrastructure lines name the self-hosted stack that
 * replaced Supabase. The English text is a translation for the EN panel language.
 */

export type LegalLanguage = "tr" | "en";
export type LegalDocumentKey = "privacy" | "terms";

export interface LegalItem {
  label?: string;
  text: string;
}

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: LegalItem[];
  after?: string[];
  /** Renders "<before><link to path>label</link><after>" (e.g. the data deletion page). */
  link?: { before: string; label: string; path: string; after: string };
}

export interface LegalDocument {
  title: string;
  subtitle: string;
  updated: string;
  sections: LegalSection[];
  footer: string;
}

const contactTr: LegalItem[] = [
  { text: "Garanti Kuluçka" },
  { label: "E-posta", text: "info@garantikulucka.com" },
  { label: "Telefon", text: "+90 322 911 03 70" },
  { label: "Adres", text: "Adana, Türkiye" },
];

const contactEn: LegalItem[] = [
  { text: "Garanti Kuluçka" },
  { label: "Email", text: "info@garantikulucka.com" },
  { label: "Phone", text: "+90 322 911 03 70" },
  { label: "Address", text: "Adana, Türkiye" },
];

export const legalDocuments: Record<LegalLanguage, Record<LegalDocumentKey, LegalDocument>> = {
  tr: {
    privacy: {
      title: "Gizlilik Politikası",
      subtitle: "Privacy Policy",
      updated: "Son güncelleme: 7 Ekim 2026",
      footer: "© 2026 Garanti Kuluçka. Tüm hakları saklıdır.",
      sections: [
        {
          heading: "1. Giriş",
          paragraphs: [
            'Garanti Kuluçka ("biz", "bizim" veya "şirket") olarak, kullanıcılarımızın gizliliğini korumayı taahhüt ediyoruz. Bu Gizlilik Politikası, Garanti Kuluçka Panel ("Platform") aracılığıyla topladığımız, kullandığımız ve koruduğumuz kişisel verileri açıklamaktadır.',
          ],
        },
        {
          heading: "2. Toplanan Veriler",
          paragraphs: ["Platformumuz aracılığıyla aşağıdaki verileri toplayabiliriz:"],
          items: [
            { label: "Kimlik Bilgileri", text: "Ad, soyad, e-posta adresi, telefon numarası" },
            { label: "İletişim Verileri", text: "WhatsApp, Instagram ve Messenger üzerinden gönderilen/alınan mesajlar" },
            { label: "Sipariş Bilgileri", text: "Adres, ürün tercihleri, ödeme bilgileri" },
            { label: "Sosyal Medya Verileri", text: "Instagram kullanıcı adı, profil bilgileri (Instagram Messaging API aracılığıyla)" },
            { label: "Teknik Veriler", text: "IP adresi, tarayıcı türü, oturum bilgileri" },
          ],
        },
        {
          heading: "3. Verilerin Kullanım Amaçları",
          paragraphs: ["Topladığımız verileri aşağıdaki amaçlarla kullanıyoruz:"],
          items: [
            { text: "Müşteri siparişlerinin işlenmesi ve kargo takibi" },
            { text: "Müşteri hizmetleri ve destek sağlanması (WhatsApp, Instagram, Messenger)" },
            { text: "Yapay zeka destekli otomatik yanıt sistemi ile hızlı müşteri iletişimi" },
            { text: "Fatura ve muhasebe işlemlerinin yürütülmesi" },
            { text: "Platform güvenliğinin sağlanması ve iyileştirilmesi" },
          ],
        },
        {
          heading: "4. Facebook Messenger Verileri",
          paragraphs: ["Platformumuz, Facebook Messenger API (Graph API) aracılığıyla aşağıdaki verilere erişir:"],
          items: [
            { label: "PSID (Page-Scoped User ID)", text: "Messenger üzerinden bize mesaj gönderen kullanıcılara Facebook tarafından atanan benzersiz kimlik" },
            { label: "Mesaj içerikleri", text: "Müşterinin Messenger üzerinden gönderdiği ve aldığı mesajlar (yalnızca müşteri hizmetleri amacıyla)" },
            { label: "Kullanıcı profil bilgileri", text: "Facebook'un sağladığı ad ve soyad bilgisi" },
            { label: "Mesaj zaman damgaları", text: "Mesajların gönderilme zamanı" },
          ],
          after: [
            "Bu veriler yalnızca müşteri hizmetleri ve sipariş yönetimi amacıyla kullanılır, üçüncü taraflarla paylaşılmaz ve yalnızca kullanıcıların sayfamıza başlattığı konuşmalar için işlenir. Facebook/Meta platformlarının Gizlilik Politikası ile uyumlu hareket etmekteyiz.",
          ],
        },
        {
          heading: "5. Instagram Verileri",
          paragraphs: ["Platformumuz, Instagram Graph API aracılığıyla aşağıdaki verilere erişir:"],
          items: [
            { text: "Instagram Direct mesajları (müşteri ile iletişim amacıyla)" },
            { text: "Instagram kullanıcı adı ve profil adı" },
            { text: "Mesaj geçmişi (müşteri hizmetleri kalitesini artırmak için)" },
          ],
          after: ["Bu veriler yalnızca müşteri hizmetleri amacıyla kullanılır ve üçüncü taraflarla paylaşılmaz."],
        },
        {
          heading: "6. Veri Saklama ve Güvenlik",
          paragraphs: [
            "Verileriniz, kendi sunucularımızda çalışan PostgreSQL veritabanında ve nesne depolamada saklanmaktadır; entegrasyon anahtarları şifrelenmiş olarak tutulur. Endüstri standartlarına uygun güvenlik önlemleri (SSL/TLS şifreleme, erişim kontrolü, düzenli yedekleme) uygulanmaktadır. Veriler yalnızca gerekli süre boyunca saklanır.",
          ],
        },
        {
          heading: "7. Veri Paylaşımı",
          paragraphs: ["Verileriniz aşağıdaki durumlar dışında üçüncü taraflarla paylaşılmaz:"],
          items: [
            { text: "Kargo hizmeti sağlayıcıları (PTT Kargo, Sürat Kargo) - teslimat için gerekli bilgiler" },
            { text: "Fatura hizmeti sağlayıcıları (KolayBi) - muhasebe işlemleri için" },
            { text: "Yasal yükümlülükler gereği yetkili makamlar" },
          ],
        },
        {
          heading: "8. Haklarınız",
          paragraphs: ["KVKK (6698 sayılı Kişisel Verilerin Korunması Kanunu) kapsamında aşağıdaki haklara sahipsiniz:"],
          items: [
            { text: "Kişisel verilerinizin işlenip işlenmediğini öğrenme" },
            { text: "Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme" },
            { text: "Kişisel verilerinizin düzeltilmesini isteme" },
            { text: "Kişisel verilerinizin silinmesini veya yok edilmesini isteme" },
            { text: "İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle kişinin kendisi aleyhine bir sonucun ortaya çıkmasına itiraz etme" },
          ],
        },
        {
          heading: "9. Veri Silme Talebi",
          link: { before: "Kişisel verilerinizin silinmesini talep etmek için ", label: "Veri Silme Talebi", path: "/veri-silme", after: " sayfamızı ziyaret edebilirsiniz." },
        },
        {
          heading: "10. İletişim",
          paragraphs: ["Gizlilik politikamızla ilgili sorularınız için bizimle iletişime geçebilirsiniz:"],
          items: contactTr,
        },
        {
          heading: "11. Değişiklikler",
          paragraphs: [
            "Bu gizlilik politikası zaman zaman güncellenebilir. Önemli değişiklikler yapıldığında kullanıcılarımızı bilgilendireceğiz. Platformu kullanmaya devam etmeniz, güncellenmiş politikayı kabul ettiğiniz anlamına gelir.",
          ],
        },
      ],
    },
    terms: {
      title: "Kullanım Koşulları",
      subtitle: "Terms of Service",
      updated: "Son güncelleme: 7 Ekim 2026",
      footer: "© 2026 Garanti Kuluçka. Tüm hakları saklıdır.",
      sections: [
        {
          heading: "1. Genel Bilgiler",
          paragraphs: [
            'Bu Kullanım Koşulları ("Koşullar"), Garanti Kuluçka Panel ("Platform") kullanımınızı düzenlemektedir. Platformu kullanarak bu koşulları kabul etmiş sayılırsınız.',
            "Platform, Garanti Kuluçka tarafından sipariş yönetimi, müşteri iletişimi, kargo takibi ve muhasebe işlemlerinin yürütülmesi amacıyla sunulmaktadır.",
          ],
        },
        {
          heading: "2. Hizmet Tanımı",
          paragraphs: ["Garanti Kuluçka Panel aşağıdaki hizmetleri sunar:"],
          items: [
            { label: "Mesajlaşma", text: "WhatsApp, Instagram ve Messenger üzerinden müşteri iletişimi" },
            { label: "Sipariş Yönetimi", text: "Sipariş oluşturma, takip ve durum güncelleme" },
            { label: "Kargo Yönetimi", text: "PTT Kargo ve Sürat Kargo entegrasyonu ile gönderi oluşturma ve takip" },
            { label: "Muhasebe", text: "Fatura oluşturma ve cari hesap yönetimi (KolayBi entegrasyonu)" },
            { label: "Stok Yönetimi", text: "Ürün stok takibi" },
            { label: "Yapay Zeka Asistanı", text: "Otomatik müşteri yanıtlama sistemi" },
          ],
        },
        {
          heading: "3. Kullanıcı Hesapları",
          items: [
            { text: "Platform erişimi yetkilendirilmiş kullanıcılarla sınırlıdır." },
            { text: "Kullanıcı hesapları admin tarafından oluşturulur ve yönetilir." },
            { text: "Hesap bilgilerinizi (e-posta ve şifre) gizli tutmakla yükümlüsünüz." },
            { text: "Hesabınız üzerinden gerçekleştirilen tüm işlemlerden siz sorumlusunuz." },
            { text: "Şüpheli bir etkinlik fark ettiğinizde derhal yöneticinize bildirmelisiniz." },
          ],
        },
        {
          heading: "4. Kullanıcı Rolleri",
          paragraphs: ["Platform üzerinde üç farklı kullanıcı rolü bulunmaktadır:"],
          items: [
            { label: "Admin", text: "Tüm platform özelliklerine tam erişim" },
            { label: "Çalışan (Satış Personeli)", text: "Mesajlar, siparişler, stok, müşteriler ve bakiye yönetimi" },
            { label: "Kargo Operatörü", text: "Kargo işlemleri, fatura ve muhasebe" },
          ],
        },
        {
          heading: "5. Kabul Edilebilir Kullanım",
          paragraphs: ["Platform kullanımında aşağıdaki kurallara uymalısınız:"],
          items: [
            { text: "Platformu yalnızca iş amaçlı kullanacaksınız" },
            { text: "Müşteri verilerini yetkisiz kişilerle paylaşmayacaksınız" },
            { text: "Platformun güvenliğini tehlikeye atacak eylemlerden kaçınacaksınız" },
            { text: "Instagram ve WhatsApp üzerinden müşterilere spam mesaj göndermeyeceksiniz" },
            { text: "Müşteri bilgilerini ticari amaçlarla üçüncü taraflara satmayacaksınız" },
          ],
        },
        {
          heading: "6. Üçüncü Taraf Hizmetleri",
          paragraphs: ["Platform, aşağıdaki üçüncü taraf hizmetlerini kullanmaktadır:"],
          items: [
            { label: "Meta/Facebook", text: "Instagram Messaging API, WhatsApp Business API" },
            { label: "PTT Kargo & Sürat Kargo", text: "Kargo hizmetleri" },
            { label: "KolayBi", text: "Fatura ve muhasebe hizmetleri" },
            { label: "Net GSM", text: "Sesli arama ve SMS hizmetleri" },
            { label: "Vapi", text: "Yapay zeka destekli sesli arama" },
            { label: "Anthropic (Claude)", text: "Yapay zeka destekli müşteri yanıtlama" },
          ],
          after: ["Bu hizmetlerin kullanımı, ilgili hizmet sağlayıcılarının kendi kullanım koşullarına tabidir."],
        },
        {
          heading: "7. Fikri Mülkiyet",
          paragraphs: [
            "Platform ve içeriği (tasarım, kod, logolar) Garanti Kuluçka'nın mülkiyetindedir. Platform içeriğini kopyalama, dağıtma veya değiştirme hakkınız bulunmamaktadır.",
          ],
        },
        {
          heading: "8. Sorumluluk Sınırlaması",
          paragraphs: [
            "Garanti Kuluçka, platformun kesintisiz veya hatasız çalışacağını garanti etmez. Üçüncü taraf hizmetlerinden kaynaklanan kesinti veya hatalardan sorumlu tutulamaz.",
            'Platform "olduğu gibi" sunulmaktadır. Platformun kullanımından doğabilecek doğrudan veya dolaylı zararlardan sorumluluk kabul edilmez.',
          ],
        },
        {
          heading: "9. Hesap Sonlandırma",
          paragraphs: [
            "Garanti Kuluçka, herhangi bir nedenle ve önceden bildirimde bulunmaksızın kullanıcı hesaplarını askıya alma veya sonlandırma hakkını saklı tutar. Kullanım koşullarının ihlali durumunda hesabınız derhal kapatılabilir.",
          ],
        },
        {
          heading: "10. Uygulanacak Hukuk",
          paragraphs: ["Bu koşullar Türkiye Cumhuriyeti kanunlarına tabidir. Uyuşmazlıkların çözümünde Adana Mahkemeleri ve İcra Daireleri yetkilidir."],
        },
        { heading: "11. İletişim", paragraphs: ["Kullanım koşullarıyla ilgili sorularınız için:"], items: contactTr },
        {
          heading: "12. Değişiklikler",
          paragraphs: [
            "Bu kullanım koşulları önceden bildirimde bulunarak güncellenebilir. Güncelleme sonrasında platformu kullanmaya devam etmeniz, yeni koşulları kabul ettiğiniz anlamına gelir.",
          ],
        },
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy Policy",
      subtitle: "Gizlilik Politikası",
      updated: "Last updated: 7 October 2026",
      footer: "© 2026 Garanti Kuluçka. All rights reserved.",
      sections: [
        {
          heading: "1. Introduction",
          paragraphs: [
            'Garanti Kuluçka ("we", "our" or "the company") is committed to protecting the privacy of its users. This Privacy Policy explains the personal data we collect, use and protect through the Garanti Kuluçka Panel ("Platform").',
          ],
        },
        {
          heading: "2. Data we collect",
          paragraphs: ["We may collect the following data through the Platform:"],
          items: [
            { label: "Identity", text: "First name, last name, email address, phone number" },
            { label: "Communication", text: "Messages sent and received through WhatsApp, Instagram and Messenger" },
            { label: "Orders", text: "Address, product preferences, payment details" },
            { label: "Social media", text: "Instagram username and profile details (through the Instagram Messaging API)" },
            { label: "Technical", text: "IP address, browser type, session details" },
          ],
        },
        {
          heading: "3. How we use data",
          paragraphs: ["We use the data we collect to:"],
          items: [
            { text: "Process customer orders and track shipments" },
            { text: "Provide customer service and support (WhatsApp, Instagram, Messenger)" },
            { text: "Answer customers quickly with an AI-assisted automatic reply system" },
            { text: "Run invoicing and accounting" },
            { text: "Keep the Platform secure and improve it" },
          ],
        },
        {
          heading: "4. Facebook Messenger data",
          paragraphs: ["The Platform accesses the following data through the Facebook Messenger API (Graph API):"],
          items: [
            { label: "PSID (Page-Scoped User ID)", text: "The unique id Facebook assigns to users who message us on Messenger" },
            { label: "Message content", text: "Messages the customer sends and receives on Messenger (for customer service only)" },
            { label: "Profile details", text: "The first and last name provided by Facebook" },
            { label: "Timestamps", text: "When messages were sent" },
          ],
          after: [
            "This data is used only for customer service and order management, is not shared with third parties, and is processed only for conversations users start with our page. We act in line with the Facebook/Meta Privacy Policy.",
          ],
        },
        {
          heading: "5. Instagram data",
          paragraphs: ["The Platform accesses the following data through the Instagram Graph API:"],
          items: [
            { text: "Instagram Direct messages (to communicate with customers)" },
            { text: "Instagram username and profile name" },
            { text: "Message history (to improve customer service quality)" },
          ],
          after: ["This data is used only for customer service and is not shared with third parties."],
        },
        {
          heading: "6. Storage and security",
          paragraphs: [
            "Your data is stored in a PostgreSQL database and object storage running on our own servers; integration keys are kept encrypted. Industry-standard safeguards (SSL/TLS encryption, access control, regular backups) are in place. Data is kept only as long as needed.",
          ],
        },
        {
          heading: "7. Data sharing",
          paragraphs: ["Your data is not shared with third parties except:"],
          items: [
            { text: "Cargo providers (PTT Kargo, Sürat Kargo) - details needed for delivery" },
            { text: "Invoicing provider (KolayBi) - for accounting" },
            { text: "Competent authorities where the law requires it" },
          ],
        },
        {
          heading: "8. Your rights",
          paragraphs: ["Under the Turkish Personal Data Protection Law (KVKK, No. 6698) you have the right to:"],
          items: [
            { text: "Learn whether your personal data is processed" },
            { text: "Request information if it has been processed" },
            { text: "Ask for your personal data to be corrected" },
            { text: "Ask for your personal data to be deleted or destroyed" },
            { text: "Object to a result against you that arises solely from automated analysis of the processed data" },
          ],
        },
        {
          heading: "9. Data deletion request",
          link: { before: "To request the deletion of your personal data, visit our ", label: "Data Deletion Request", path: "/veri-silme", after: " page." },
        },
        { heading: "10. Contact", paragraphs: ["For questions about this privacy policy, contact us:"], items: contactEn },
        {
          heading: "11. Changes",
          paragraphs: [
            "This privacy policy may be updated from time to time. We will inform our users about important changes. Continuing to use the Platform means you accept the updated policy.",
          ],
        },
      ],
    },
    terms: {
      title: "Terms of Service",
      subtitle: "Kullanım Koşulları",
      updated: "Last updated: 7 October 2026",
      footer: "© 2026 Garanti Kuluçka. All rights reserved.",
      sections: [
        {
          heading: "1. General",
          paragraphs: [
            'These Terms of Service ("Terms") govern your use of the Garanti Kuluçka Panel ("Platform"). By using the Platform you accept these Terms.',
            "Garanti Kuluçka provides the Platform for order management, customer communication, shipment tracking and accounting.",
          ],
        },
        {
          heading: "2. Services",
          paragraphs: ["The Garanti Kuluçka Panel offers:"],
          items: [
            { label: "Messaging", text: "Customer communication through WhatsApp, Instagram and Messenger" },
            { label: "Orders", text: "Creating, tracking and updating orders" },
            { label: "Shipping", text: "Creating and tracking shipments through the PTT Kargo and Sürat Kargo integrations" },
            { label: "Accounting", text: "Invoices and current accounts (KolayBi integration)" },
            { label: "Stock", text: "Product stock tracking" },
            { label: "AI assistant", text: "Automatic customer replies" },
          ],
        },
        {
          heading: "3. User accounts",
          items: [
            { text: "Access is limited to authorized users." },
            { text: "User accounts are created and managed by an admin." },
            { text: "You must keep your account details (email and password) confidential." },
            { text: "You are responsible for everything done through your account." },
            { text: "Report any suspicious activity to your manager immediately." },
          ],
        },
        {
          heading: "4. User roles",
          paragraphs: ["The Platform has three user roles:"],
          items: [
            { label: "Admin", text: "Full access to every feature" },
            { label: "Employee (sales staff)", text: "Messages, orders, stock, customers and balances" },
            { label: "Shipping operator", text: "Shipping, invoices and accounting" },
          ],
        },
        {
          heading: "5. Acceptable use",
          paragraphs: ["When using the Platform you must:"],
          items: [
            { text: "Use the Platform for business purposes only" },
            { text: "Not share customer data with unauthorized people" },
            { text: "Avoid anything that endangers the Platform's security" },
            { text: "Not send spam to customers through Instagram or WhatsApp" },
            { text: "Not sell customer details to third parties" },
          ],
        },
        {
          heading: "6. Third-party services",
          paragraphs: ["The Platform uses the following third-party services:"],
          items: [
            { label: "Meta/Facebook", text: "Instagram Messaging API, WhatsApp Business API" },
            { label: "PTT Kargo & Sürat Kargo", text: "Shipping" },
            { label: "KolayBi", text: "Invoicing and accounting" },
            { label: "Net GSM", text: "Voice calls and SMS" },
            { label: "Vapi", text: "AI-assisted voice calls" },
            { label: "Anthropic (Claude)", text: "AI-assisted customer replies" },
          ],
          after: ["Use of these services is subject to each provider's own terms."],
        },
        {
          heading: "7. Intellectual property",
          paragraphs: ["The Platform and its content (design, code, logos) belong to Garanti Kuluçka. You may not copy, distribute or modify Platform content."],
        },
        {
          heading: "8. Limitation of liability",
          paragraphs: [
            "Garanti Kuluçka does not guarantee that the Platform will run without interruption or errors, and is not liable for outages or errors caused by third-party services.",
            'The Platform is provided "as is". No liability is accepted for direct or indirect damage arising from its use.',
          ],
        },
        {
          heading: "9. Account termination",
          paragraphs: [
            "Garanti Kuluçka may suspend or close user accounts for any reason without prior notice. Accounts that breach these Terms may be closed immediately.",
          ],
        },
        { heading: "10. Governing law", paragraphs: ["These Terms are governed by the laws of the Republic of Türkiye. Adana Courts and Enforcement Offices have jurisdiction over disputes."] },
        { heading: "11. Contact", paragraphs: ["For questions about these Terms:"], items: contactEn },
        {
          heading: "12. Changes",
          paragraphs: ["These Terms may be updated with prior notice. Continuing to use the Platform after an update means you accept the new Terms."],
        },
      ],
    },
  },
};
