# Legacy kullanıcılarını migration apply öncesinde hazırlama

Bu işlem migrator'dan ayrıdır. Migrator kullanıcı oluşturmaz. Migration 029 önce uygulanır;
16 kullanıcı mapping dosyasındaki public ID ile bootstrap edilir, sonra migration apply çalışır.
Legacy şifreler taşınmaz. 4 aktif hesap geçici şifre alır, 12 pasif hesap giriş yapamaz.
SIP bilgisi bulunan 2 hesabın SIP şifresi hedef uygulamanın encryptor/key ayarıyla şifrelenir.

Komutları repo kökünde çalıştırın. Kişisel verileri terminale yazdırmayın; dosyaları commit etmeyin.
Çıktı dosyaları repo dışında, yeni bir dosya adıyla oluşturulmalıdır (symlink ve mevcut dosyalar reddedilir).

```sh
npm ci
# Gerekirse yerel legacy kopyasını başlatın:
LC_ALL=en_US.UTF-8 ~/Library/FlyEnv/env/postgresql/bin/pg_ctl -D ~/Documents/GarantiLegacyData/pgdata start

export SOURCE_DATABASE_URL='postgresql://postgres@127.0.0.1:5440/garanti_legacy'
export PGOPTIONS='-c default_transaction_read_only=on'
export MIGRATION_USER_PUBLIC_IDS_FILE='/Volumes/DockerRuns/Projects/garanti-kulucka-ecosystem/tmp/dryrun-reports/user_public_ids.local.json'
# Owner e-postasını ekrana yazmadan alın:
read -r -s OWNER_EMAIL
node tools/legacy-users-export.mjs --owner-email "$OWNER_EMAIL" --output "$HOME/legacy-users.bootstrap.json"
unset OWNER_EMAIL PGOPTIONS SOURCE_DATABASE_URL

# Hedef DB ve çalışan API ile aynı APP_ENCRYPTION_KEY / APP_ENCRYPTION_KEY_ID değerlerini
# güvenli ortamınızdan yükleyin. Değerleri terminal çıktısına veya shell history'ye yazmayın.
# DATABASE_URL, APP_ENCRYPTION_KEY ve APP_ENCRYPTION_KEY_ID artık tanımlı olmalı.
npm run db:migrate:up
export LEGACY_USERS_FILE="$HOME/legacy-users.bootstrap.json"
export LEGACY_USERS_PASSWORDS_FILE="$HOME/legacy-users.temporary-passwords.json"
npm run build -w @garanti-kulucka/shared
npm run build -w @garanti-kulucka/database
npm run bootstrap:legacy-users -w @garanti-kulucka/api
# Derlenmiş dağıtımda alternatif:
# npm run bootstrap:legacy-users:prod -w @garanti-kulucka/api
```

Export yalnız loopback adresine bağlanır ve read-only transaction kullanır. Gerçek legacy kopyasında
roller `admin` (2), `calisan` (13), `kargo_operatoru` (1) olarak kontrol edilmiştir.
Bilinmeyen rol, eksik mapping, tekrar eden kimlik veya eşleşmeyen owner export'u durdurur.

Bootstrap tek transaction çalışır. Mevcut public ID atlanır; başka public ID'ye ait e-posta tüm işlemi
iptal eder. Yeniden çalıştırma için **yeni çıktı dosyası** seçin: önceki geçici şifre dosyasını koruyun,
çünkü atlanan hesapların şifreleri yeniden üretilmez. Başarısız bootstrap sonrası çıktı kısmen yazılmış
olabilir; başarısız çalışmanın dosyasını güvenli şekilde silip yeni adla tekrar deneyin. Şifre dosyası
committen önce diske yazılır; DB commit hatası oluşursa bu dosyadaki şifreleri dağıtmayın.

Başarılı bootstrap sonrası yalnız oluşturulan aktif kullanıcıların e-posta → geçici şifre JSON'u
600 izinli dosyada bulunur. Yönetici bunları güvenli kanaldan dağıtır. İlk girişte kullanıcı yalnız
`GET /auth/me`, `POST /auth/logout`, `POST /auth/account/password` çağrılarını kullanabilir;
diğer authenticated HTTP rotaları `403 password_change_required` döndürür ve realtime bağlantısı
reddedilir. Başarılı şifre değişimi bayrağı kaldırır. Admin şifre sıfırlaması bayrağı tekrar açar.

Hedef DB'de kişisel veri döndürmeden doğrulama:

```sql
SELECT count(*) AS users, count(*) FILTER (WHERE is_active) AS active,
       count(*) FILTER (WHERE must_change_password) AS temporary,
       count(*) FILTER (WHERE sip_password_encrypted IS NOT NULL) AS sip
FROM users;
```

Yeni ve boş hedefte beklenen: 16 / 4 / 4 / 2. Var olan hedefte toplamlar farklı olabilir;
mapping'deki tüm public ID'lerin varlığını migrator dry-run ile ayrıca doğrulayın. Sonrasında mevcut
migrator runbook'undaki aynı mapping dosyasıyla dry-run ve apply adımlarını izleyin. Export dosyası
SIP sırları ve kişisel veri içerir; geçiş tamamlanınca güvenli saklama/silme politikanızı uygulayın.
