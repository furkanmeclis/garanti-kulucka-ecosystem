# Migrator performans ve arama geçmişi doğrulaması — 2026-10-17

| Sürüm | Dry-run süresi | CLI tepe RSS | Planlanan satır |
| --- | ---: | ---: | ---: |
| `origin/main` (`14ed1f3`) | 584.075 sn | 909.7 MiB | 618,249 |
| Bu PR (`53328b3`) | 426.737 sn | 605.2 MiB | 618,441 |

Tepe CLI RSS değişimi: %33.5 azalma.

## Yöntem ve kapsam

Dal güncel main `623c301` üzerine taşındı. `14ed1f3..623c301` aralığında `apps/migrator` değişmedi; ölçülen migrator kaynak dosyaları rebase sonrası aynı kaldı. Son build/typecheck ve 16 PostgreSQL testi güncel şemayla tekrar geçti.

Ölçüm, yerel legacy kopyada yalnız `REPEATABLE READ READ ONLY` bağlantısıyla alındı; uzak/production veritabanına bağlantı veya legacy veriye yazma yapılmadı. Aynı `SOURCE_DATABASE_URL`, conversation-account ve user-public-id snapshot'ları ile batch size 500 kullanıldı. Süre komut raporunun `durationMs` alanıdır. Tepe RSS, aynı geçici Node preload'unun process çıkışında aldığı `process.resourceUsage().maxRSS` (KiB) değeridir; PostgreSQL sunucusunun belleğini içermez. macOS sandbox'ında `/usr/bin/time -l` kaynak istatistikleri için gereken `sysctl` engellendiğinden bu yöntem kullanıldı.

Makine paylaşımlıydı; başka bir yerel migration okuması ve yeni sürümün ilk bölümünde PostgreSQL fixture testleri eşzamanlı çalıştı. Cache sıfırlanmadı. Bunlar gözlenen tam dry-run değerleridir; izole hızlanma oranı veya tam apply süresi olarak yorumlanmamalıdır. Main'de snapshot keyset devamı ve tek SCROLL tracking cursor'u zaten vardı; bu PR bunları tipli/açık batch cursor'larıyla tamamlar. CLI checksum canlı satır belleği O(parti), sıralama dosyası metadata'sı sabittir; mevcut iş planı indeksleri ve plan/batch metadata'sı ayrıca ölçeklenir.

## Gerçek veri sayıları

| Sayaç | Sonuç |
| --- | ---: |
| Sentetik müşteri | 2.271 (2.260 telefon + 11 telefonsuz) |
| Çözülen dış kimlik | 48.494; çözümsüz 0 |
| Tekil kargo olayı | 44.704; gelecek tarihli marker 19 |
| Kısayol / SMS / VAPI | 53 / 270 / 21 |
| Yeni arama kaydı | 192 (74 answered, 118 failed) |
| Arama kullanıcı bağı: bağlı / çözümsüz | 192 / 0 |
| Arama sipariş bağı: bağlı / çözümsüz | 125 / 0 |
| Arama müşteri bağı: bağlı / çözümsüz | 173 / 19 |
| Blokaj | 0 |

## Fingerprint eşitliği

Yeni `call_logs` entity'si çıkarılıp aynı 11 entity kapsamı için manifest yeniden kuruldu: row-content checksum'ları, plan fingerprint ve JSON manifest baytları main ile birebir aynı. Tam yeni manifest 192 arama nedeniyle kapsamını genişletir. Birim regresyonu boş veri, parti sınırları, sayısal/metin sırası farkı, sırasız/Unicode/JSON kaçışlı kimlikler ve ilk checksum'ı koruyan tekrar okumayı eski checksum fonksiyonuyla karşılaştırır. İlk okuma sonrasında apply'ın kaynağı tekrar sorgulamadığı da test edilir.

## Test kanıtı

- `npm run build -w @garanti-kulucka/shared && npm run build -w @garanti-kulucka/database`: geçti.
- `npm test -w @garanti-kulucka/migrator`: 28 dosya, 569 test geçti.
- `npm run typecheck`: tüm workspaces geçti.
- `npx vitest run tests/migration --maxWorkers=2`: 11 dosya, 16 test geçti; test seçimi daraltılmadı.
- Gerçek PostgreSQL: call_logs apply, ham notlar/timestamp/kullanıcı/müşteri koruması, opsiyonel sipariş id-map çözümü, verify, tamamlanmış batch tekrarı ve marker silinerek gerçek writer rerun'ı geçti.
- Yerel `EXPLAIN`: UUID koşulu `mesajlar_pkey` üzerinde `Index Scan` / `Index Cond: id > ...::uuid` kullanıyor.

## Apply geçici diski

Kaynak manifest’i hedef satırları yazılmadan önce doğrulanır. İlk kaynak okumalarının ham JSON partileri özel `migrator-snapshot-*` dizinlerinde tutulur ve apply bunları kullanır. Bu disk ihtiyacı inline mesaj medyasını da içerir; dosyalar başarı/yakalanan hatada silinir, process/host kesintisi sonrası kalanlar elle temizlenir. Kaynak snapshot transaction'ı mevcut davranıştaki gibi run boyunca açık kalır. Gerçek legacy veri üzerinde bu çalışma yalnız dry-run yaptı; apply kanıtı ayrı yerel PostgreSQL fixture hedeflerinden gelir.

Rapor/snapshot dosyaları ve kişisel veri commit edilmedi; bu belge yalnız aggregate sonuçları içerir.
