-- Local-only demo data for the beta panel (Mesajlar, Siparişler, Kargolar, Pano).
-- Re-runnable: every row it creates carries "demo" in public_id and is removed first.
-- Never run against staging/production.
--   docker compose exec -T postgres psql -U garanti -d garanti -v ON_ERROR_STOP=1 < tools/dev/seed-demo.sql

BEGIN;

DELETE FROM invoices WHERE public_id LIKE 'inv_demo%';
DELETE FROM accounting_contacts WHERE public_id LIKE 'acc_demo%';
DELETE FROM shipments WHERE public_id LIKE 'shp_demo%';
DELETE FROM order_items WHERE public_id LIKE 'oit_demo%';
DELETE FROM orders WHERE public_id LIKE 'ord_demo%';
DELETE FROM messages WHERE public_id LIKE 'msg_demo%';
DELETE FROM conversations WHERE public_id LIKE 'cnv_demo%';
DELETE FROM customer_addresses WHERE public_id LIKE 'adr_demo%';
DELETE FROM customers WHERE public_id LIKE 'cus_demo%';
DELETE FROM products WHERE public_id LIKE 'prd_demo%';
DELETE FROM users WHERE public_id LIKE 'usr_demo%';

-- Two online agents (cannot log in: the hash is not a valid password hash).
INSERT INTO users (public_id, role_id, email, password_hash, first_name, last_name, is_online, last_seen_at)
SELECT 'usr_demo_' || v.slug, r.id, v.slug || '@garanti.test', 'demo-no-login', v.first, v.last, true, now()
FROM (VALUES ('elif', 'Elif', 'Kaya'), ('mert', 'Mert', 'Arslan'), ('selin', 'Selin', 'Doğan'), ('burak', 'Burak', 'Yıldız')) AS v(slug, first, last)
JOIN roles r ON r.name = 'agent';

INSERT INTO products (public_id, sku, name, category, unit_price, stock_quantity, description) VALUES
  ('prd_demo_1', 'GK-EL-96', 'El Yapımı Kuluçka Makinesi 96''lık', 'incubator', 3500, 14, 'Tam otomatik, nem kontrollü'),
  ('prd_demo_2', 'GK-EL-50', 'El Yapımı Kuluçka Makinesi 50''lik', 'incubator', 2550, 6, 'Kompakt model'),
  ('prd_demo_3', 'GK-TERM', 'Dijital Termostat', 'spare_part', 450, 40, NULL),
  ('prd_demo_4', 'GK-NEM', 'Nem Ölçer', 'spare_part', 180, 3, NULL),
  ('prd_demo_5', 'GK-MOTOR', 'Viyol Çevirme Motoru', 'spare_part', 650, 12, NULL),
  ('prd_demo_6', 'GK-MINI-24', 'Mini Kuluçka Makinesi 24''lük', 'incubator', 1450, 9, 'Başlangıç modeli');

CREATE TEMP TABLE demo_people (n int, full_name text, phone text, username text, city text, district text, address text, channel text) ON COMMIT DROP;
INSERT INTO demo_people VALUES
  (1, 'Ayşe Yılmaz', '905551000001', NULL, 'Adana', 'Seyhan', 'Atatürk Cd. No:12', 'whatsapp'),
  (2, 'Mehmet Demir', '905551000002', NULL, 'Konya', 'Selçuklu', 'Mevlana Mh. 45. Sk. No:3', 'whatsapp'),
  (3, 'Zeynep Kaya', NULL, 'zeynepkaya', 'İzmir', 'Bornova', 'Kazımdirik Mh. No:8', 'instagram'),
  (4, 'Hasan Çelik', '905551000004', NULL, 'Ankara', 'Polatlı', 'Cumhuriyet Mh. 12. Sk. No:5', 'whatsapp'),
  (5, 'Ali Vural', NULL, 'alivural_ciftlik', 'Bursa', 'İnegöl', 'Yeni Mh. No:21', 'instagram'),
  (6, 'Emine Şahin', '905551000006', NULL, 'Samsun', 'Bafra', 'Çarşı Cd. No:2', 'whatsapp'),
  (7, 'Fatma Öztürk', NULL, NULL, 'Kayseri', 'Melikgazi', 'Erciyes Mh. No:17', 'messenger'),
  (8, 'Davut Aydın', '905551000008', NULL, 'Hatay', 'İskenderun', 'Sahil Yolu No:40', 'whatsapp'),
  (9, 'Fırat Öztekin', '905551000009', NULL, 'Elazığ', 'Merkez', 'Sürsürü Mh. No:9', 'whatsapp'),
  (10, 'Yakup Demir', '905551000010', NULL, 'Erzurum', 'Yakutiye', 'Lalapaşa Cd. No:11', 'whatsapp'),
  (11, 'Kadir Polat', NULL, 'kadirpolat', 'Manisa', 'Akhisar', 'Hürriyet Mh. No:4', 'instagram'),
  (12, 'Memet Hoca', '905551000012', NULL, 'Şanlıurfa', 'Siverek', 'Köy Yolu No:1', 'whatsapp'),
  (13, 'Dursun Ali Akman', '905551000013', NULL, 'Trabzon', 'Of', 'Merkez Mh. No:6', 'whatsapp'),
  (14, 'Ayhan Koç', NULL, NULL, 'Denizli', 'Merkezefendi', 'Sırakapılar Mh. No:30', 'messenger'),
  (15, 'Hülya Er', '905551000015', NULL, 'Eskişehir', 'Odunpazarı', 'Arifiye Mh. No:14', 'whatsapp'),
  (16, 'Zahit Yılmaz', '905551000016', NULL, 'Van', 'İpekyolu', 'Cumhuriyet Cd. No:50', 'whatsapp'),
  (17, 'Cansu Arı', NULL, 'cinarsavas00', 'Muğla', 'Fethiye', 'Karagözler Mh. No:2', 'instagram'),
  (18, 'Hidayet Akkaya', '905551000018', NULL, 'Sivas', 'Merkez', 'Kızılırmak Mh. No:7', 'whatsapp'),
  (19, 'Selim Uçar', '905551000019', NULL, 'Antalya', 'Manavgat', 'Side Yolu No:19', 'whatsapp'),
  (20, 'Gülsüm Tan', NULL, 'gulsumciftligi', 'Aydın', 'Nazilli', 'Yeşil Mh. No:3', 'instagram'),
  (21, 'Recep Bulut', '905551000021', NULL, 'Kahramanmaraş', 'Onikişubat', 'Trabzon Cd. No:22', 'whatsapp'),
  (22, 'Nuri Er', '905551000022', NULL, 'Malatya', 'Battalgazi', 'Bahçe Sk. No:8', 'whatsapp');

INSERT INTO customers (public_id, full_name, phone, username, notes, created_at)
SELECT 'cus_demo_' || n, full_name, phone, username,
       CASE WHEN n IN (2, 9) THEN 'Kapıda ödeme tercih ediyor' END,
       now() - (n || ' days')::interval
FROM demo_people;

INSERT INTO customer_addresses (public_id, customer_id, label, address_line, district, city, country, is_default)
SELECT 'adr_demo_' || p.n, c.id, 'Ev', p.address, p.district, p.city, 'TR', true
FROM demo_people p JOIN customers c ON c.public_id = 'cus_demo_' || p.n;

-- Conversations: newest first, a few unread, two in the pool, mixed channels.
INSERT INTO conversations (public_id, customer_id, channel, external_thread_id, status, is_in_pool, unread_count,
                           last_message_text, last_message_sender_type, last_message_at, created_at, updated_at)
SELECT 'cnv_demo_' || p.n, c.id, p.channel, 'demo-thread-' || p.n,
       CASE WHEN p.n % 9 = 0 THEN 'closed' ELSE 'open' END,
       p.n IN (4, 15),
       CASE WHEN p.n IN (1, 2, 3, 4, 6, 8, 11, 17) THEN 1 + p.n % 3 ELSE 0 END,
       NULL, NULL, now() - (p.n * 7 || ' minutes')::interval,
       now() - (p.n || ' days')::interval, now() - (p.n * 7 || ' minutes')::interval
FROM demo_people p JOIN customers c ON c.public_id = 'cus_demo_' || p.n;

CREATE TEMP TABLE demo_script (step int, sender text, body text) ON COMMIT DROP;
INSERT INTO demo_script VALUES
  (1, 'customer', 'Merhaba, kuluçka makinesi hakkında bilgi alabilir miyim?'),
  (2, 'ai', 'Merhaba! El yapımı kuluçka makinelerimiz %90''a varan çıkım oranı sunar. 96''lık model 3.500 TL, 50''lik model 2.550 TL, kargo ücretsiz.'),
  (3, 'customer', 'Kapıda ödeme yapabilir miyim?'),
  (4, 'user', 'Evet efendim, kapıda nakit veya kart ile ödeyebilirsiniz. Adresinizi paylaşır mısınız?'),
  (5, 'customer', 'Tamam, adresimi yazıyorum.'),
  (6, 'user', 'Teşekkürler, siparişinizi oluşturuyoruz 🙏'),
  (7, 'customer', 'Kargom ne zaman gelir?');

-- Conversation n gets the first (2 + n % 6) script lines.
INSERT INTO messages (public_id, conversation_id, sender_type, sender_name, body, is_read, sent_at)
SELECT 'msg_demo_' || p.n || '_' || s.step, cv.id, s.sender,
       CASE s.sender WHEN 'user' THEN (CASE WHEN p.n % 2 = 0 THEN 'Elif' ELSE 'Mert' END) WHEN 'ai' THEN 'Yapay Zeka' END,
       CASE WHEN s.step = 5 THEN p.address || ' ' || p.district || ' / ' || p.city ELSE s.body END,
       NOT (cv.unread_count > 0 AND s.step = 2 + p.n % 6),
       cv.last_message_at - ((2 + p.n % 6 - s.step) * 3 || ' minutes')::interval
FROM demo_people p
JOIN conversations cv ON cv.public_id = 'cnv_demo_' || p.n
JOIN demo_script s ON s.step <= 2 + p.n % 6;

UPDATE conversations cv
SET last_message_text = m.body, last_message_sender_type = m.sender_type, last_message_at = m.sent_at
FROM (SELECT DISTINCT ON (conversation_id) conversation_id, body, sender_type, sent_at
      FROM messages WHERE public_id LIKE 'msg_demo%' ORDER BY conversation_id, sent_at DESC) m
WHERE m.conversation_id = cv.id;

-- Orders for every other customer, some today (Günlük Satış), various statuses, with shipments.
INSERT INTO orders (public_id, customer_id, conversation_id, order_number, status, source, total_amount, cargo_provider, notes, created_at, updated_at)
SELECT 'ord_demo_' || p.n, c.id, cv.id, 'GK-DEMO-' || lpad(p.n::text, 4, '0'),
       (ARRAY['pending_confirmation', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'])[1 + p.n % 6],
       'conversation',
       CASE WHEN p.n % 3 = 0 THEN 2550 ELSE 3500 END,
       CASE WHEN p.n % 4 = 0 THEN 'surat' ELSE 'ptt' END,
       CASE WHEN p.n = 6 THEN 'Akşam teslim olsun' END,
       now() - ((p.n / 2) * 9 || ' hours')::interval, now()
FROM demo_people p
JOIN customers c ON c.public_id = 'cus_demo_' || p.n
JOIN conversations cv ON cv.public_id = 'cnv_demo_' || p.n
WHERE p.n % 2 = 0 OR p.n IN (1, 3);

INSERT INTO order_items (public_id, order_id, product_id, name, quantity, unit_price, total_amount)
SELECT 'oit_demo_' || o.public_id, o.id, pr.id, pr.name, 1, pr.unit_price, pr.unit_price
FROM orders o
JOIN products pr ON pr.public_id = CASE WHEN o.total_amount = 2550 THEN 'prd_demo_2' ELSE 'prd_demo_1' END
WHERE o.public_id LIKE 'ord_demo%';

INSERT INTO shipments (public_id, order_id, customer_id, provider, tracking_number, status, recipient_name, recipient_phone,
                       recipient_address, recipient_city, recipient_district, last_event_text, shipped_at, delivered_at, payment_type)
SELECT 'shp_demo_' || p.n, o.id, o.customer_id, o.cargo_provider,
       CASE o.cargo_provider WHEN 'ptt' THEN 'KP' || lpad((24000000 + p.n)::text, 11, '0') ELSE '7' || lpad((5000000 + p.n)::text, 11, '0') END,
       CASE o.status WHEN 'delivered' THEN 'delivered' ELSE 'in_transit' END,
       p.full_name, p.phone, p.address, p.city, p.district,
       CASE o.status WHEN 'delivered' THEN 'Teslim edildi' ELSE 'Transfer merkezinden çıkış yaptı' END,
       o.created_at + interval '6 hours',
       CASE WHEN o.status = 'delivered' THEN o.created_at + interval '2 days' END,
       'cash_on_delivery'
FROM demo_people p JOIN orders o ON o.public_id = 'ord_demo_' || p.n
WHERE o.status IN ('shipped', 'delivered');

-- ~90 days of history for Pano / İş Analizi charts (deterministic: setseed). Every row keeps the "demo" prefix.
SELECT setseed(0.2026);

CREATE TEMP TABLE demo_cities (i int, city text, district text) ON COMMIT DROP;
INSERT INTO demo_cities VALUES
  (0, 'İstanbul', 'Esenyurt'), (1, 'İstanbul', 'Pendik'), (2, 'İstanbul', 'Silivri'), (3, 'Ankara', 'Polatlı'), (4, 'Ankara', 'Çankaya'),
  (5, 'İzmir', 'Ödemiş'), (6, 'İzmir', 'Bergama'), (7, 'Konya', 'Ereğli'), (8, 'Konya', 'Selçuklu'), (9, 'Bursa', 'İnegöl'),
  (10, 'Antalya', 'Manavgat'), (11, 'Adana', 'Ceyhan'), (12, 'Şanlıurfa', 'Siverek'), (13, 'Kayseri', 'Develi'), (14, 'Samsun', 'Bafra'),
  (15, 'Erzurum', 'Yakutiye'), (16, 'Diyarbakır', 'Bismil'), (17, 'Van', 'Erciş'), (18, 'Hatay', 'İskenderun'), (19, 'Manisa', 'Akhisar'),
  (20, 'Balıkesir', 'Bandırma'), (21, 'Aydın', 'Nazilli'), (22, 'Denizli', 'Çivril'), (23, 'Sivas', 'Merkez'), (24, 'Malatya', 'Battalgazi'),
  (25, 'Trabzon', 'Of'), (26, 'Kahramanmaraş', 'Elbistan'), (27, 'Eskişehir', 'Odunpazarı'), (28, 'Tokat', 'Turhal'), (29, 'Çorum', 'Sungurlu');

-- 320 customers created over the last 95 days, each with an address and a conversation.
CREATE TEMP TABLE demo_hist ON COMMIT DROP AS
SELECT g,
       (ARRAY['Ahmet','Mustafa','Ayşe','Fatma','Hüseyin','Emine','İbrahim','Hatice','Ramazan','Zeynep','Osman','Elif','Yusuf','Meryem','Murat','Şerife','Ömer','Sultan','Halil','Hacer'])[1 + (g * 7) % 20]
         || ' ' || (ARRAY['Yılmaz','Kaya','Demir','Şahin','Çelik','Yıldız','Öztürk','Aydın','Özdemir','Arslan','Doğan','Kılıç','Aslan','Çetin','Kara','Koç','Kurt','Özkan','Şimşek','Polat'])[1 + (g * 11) % 20] AS full_name,
       '9055520' || lpad(g::text, 5, '0') AS phone,
       floor(power(random(), 1.6) * 30)::int AS city_i,
       CASE WHEN r < 0.55 THEN 'whatsapp' WHEN r < 0.85 THEN 'instagram' ELSE 'messenger' END AS channel,
       ((date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') - make_interval(days => floor(power(random(), 0.85) * 95)::int)
         + make_interval(hours => (ARRAY[8,9,10,10,11,11,12,13,14,14,15,16,17,19,20,20,21,21,22,23])[1 + floor(random() * 20)::int], mins => floor(random() * 60)::int))
         AT TIME ZONE 'Europe/Istanbul') AS created_at
FROM (SELECT g, random() AS r FROM generate_series(1, 320) AS g) seeds;
UPDATE demo_hist SET created_at = now() - make_interval(mins => g) WHERE created_at > now();

INSERT INTO customers (public_id, full_name, phone, created_at, updated_at)
SELECT 'cus_demo_h' || g, full_name, CASE WHEN channel = 'whatsapp' OR g % 3 = 0 THEN phone END, created_at, created_at FROM demo_hist;

INSERT INTO customer_addresses (public_id, customer_id, label, address_line, district, city, country, is_default)
SELECT 'adr_demo_h' || h.g, c.id, 'Ev', 'Cumhuriyet Mh. ' || (h.g % 40 + 1) || '. Sk. No:' || (h.g % 25 + 1), dc.district, dc.city, 'TR', true
FROM demo_hist h JOIN customers c ON c.public_id = 'cus_demo_h' || h.g JOIN demo_cities dc ON dc.i = h.city_i;

INSERT INTO conversations (public_id, customer_id, channel, external_thread_id, status, is_in_pool, unread_count, created_at, updated_at, last_message_at)
SELECT 'cnv_demo_h' || h.g, c.id, h.channel, 'demo-hist-' || h.g,
       CASE WHEN h.created_at < now() - interval '10 days' THEN 'closed' ELSE 'open' END,
       false,
       CASE WHEN h.created_at > now() - interval '2 days' AND h.g % 2 = 0 THEN 1 + h.g % 3 ELSE 0 END,
       h.created_at, h.created_at, h.created_at
FROM demo_hist h JOIN customers c ON c.public_id = 'cus_demo_h' || h.g;

-- 3–8 messages per conversation, a few minutes apart (customer lines dominate the weekday × hour heatmap).
INSERT INTO messages (public_id, conversation_id, sender_type, sender_name, body, is_read, sent_at, created_at, updated_at)
SELECT 'msg_demo_h' || h.g || '_' || s.step, cv.id, s.sender,
       CASE s.sender WHEN 'user' THEN 'Elif' WHEN 'ai' THEN 'Yapay Zeka' END,
       s.body, NOT (cv.unread_count > 0 AND s.step = 3 + h.g % 5), m.at, m.at, m.at
FROM demo_hist h
JOIN conversations cv ON cv.public_id = 'cnv_demo_h' || h.g
JOIN demo_script s ON s.step <= 3 + h.g % 5
CROSS JOIN LATERAL (SELECT least(now() - interval '1 minute', h.created_at + make_interval(mins => s.step * (2 + h.g % 7))) AS at) m;

UPDATE conversations cv
SET last_message_text = m.body, last_message_sender_type = m.sender_type, last_message_at = m.sent_at, updated_at = m.sent_at
FROM (SELECT DISTINCT ON (conversation_id) conversation_id, body, sender_type, sent_at
      FROM messages WHERE public_id LIKE 'msg_demo_h%' ORDER BY conversation_id, sent_at DESC) m
WHERE m.conversation_id = cv.id;

-- Orders: ~65% of conversations convert, a quarter of buyers re-order later, plus manual (phone/panel) orders.
CREATE TEMP TABLE demo_hist_orders ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY at, g, k) AS n, g, k, manual, at
FROM (
  SELECT g, 1 AS k, false AS manual, created_at + make_interval(mins => 20 + floor(random() * 600)::int) AS at FROM demo_hist WHERE random() < 0.65
  UNION ALL
  SELECT g, 2, false, created_at + make_interval(days => 5 + floor(random() * 40)::int, hours => floor(random() * 10)::int) FROM demo_hist WHERE random() < 0.25
  UNION ALL
  SELECT g, 3, true, created_at + make_interval(days => 1 + floor(random() * 20)::int, hours => floor(random() * 8)::int) FROM demo_hist WHERE random() < 0.18
) o
WHERE at < now();

INSERT INTO orders (public_id, customer_id, conversation_id, created_by_user_id, order_number, status, source, total_amount, cargo_provider,
                    confirmation_status, confirmation_call_status, confirmation_pressed_key, confirmation_listen_seconds, confirmation_call_count,
                    external_order_id, notes, created_at, updated_at)
SELECT 'ord_demo_h' || d.n, c.id, CASE WHEN d.manual THEN NULL ELSE cv.id END,
       (SELECT u.id FROM users u WHERE u.public_id = (ARRAY['usr_demo_elif','usr_demo_mert','usr_demo_selin','usr_demo_burak','usr_demo_elif'])[1 + (d.n % 5)::int]),
       'GK-H' || lpad(d.n::text, 5, '0'), st.status,
       CASE WHEN d.manual THEN 'manual' ELSE 'conversation' END,
       0, CASE WHEN random() < 0.6 THEN 'ptt' ELSE 'surat' END,
       CASE WHEN st.status IN ('pending_confirmation') THEN NULL
            WHEN st.status = 'cancelled' THEN (ARRAY[NULL, 'iptal_istegi', 'ulasilamadi', 'confirmed'])[1 + (d.n % 4)::int]
            ELSE (ARRAY['confirmed','confirmed','confirmed','confirmed','confirmed','confirmed','ulasilamadi'])[1 + (d.n % 7)::int] END,
       call.status, CASE WHEN call.status = 'cevaplandi' THEN CASE WHEN st.status = 'cancelled' THEN '9' ELSE '1' END END,
       CASE WHEN call.status = 'cevaplandi' THEN 6 + (d.n % 30)::int END,
       CASE WHEN call.status IS NULL THEN 0 ELSE 1 + (d.n % 3)::int END,
       CASE WHEN st.status IN ('shipped','in_transit','delivered','returned') THEN 'KB-DEMO-' || d.n END,
       CASE st.status
         WHEN 'cancelled' THEN (ARRAY['Müşteri vazgeçti','Fiyatı yüksek buldu','Telefonla ulaşılamadı','Yanlış ürün seçmiş','Başka yerden aldı','Teslimat süresi uzun bulundu', NULL])[1 + (d.n % 7)::int]
         WHEN 'returned' THEN (ARRAY['Ürün hasarlı geldi','Müşteri teslim almadı', NULL, NULL])[1 + (d.n % 4)::int]
       END,
       d.at, d.at
FROM demo_hist_orders d
JOIN customers c ON c.public_id = 'cus_demo_h' || d.g
JOIN conversations cv ON cv.public_id = 'cnv_demo_h' || d.g
CROSS JOIN LATERAL (SELECT extract(epoch FROM now() - d.at) / 86400 AS age, random() AS r) a
CROSS JOIN LATERAL (SELECT CASE
    WHEN a.age < 0.6 THEN CASE WHEN a.r < 0.6 THEN 'pending_confirmation' WHEN a.r < 0.85 THEN 'confirmed' ELSE 'preparing' END
    WHEN a.age < 2 THEN CASE WHEN a.r < 0.15 THEN 'pending_confirmation' WHEN a.r < 0.35 THEN 'confirmed' WHEN a.r < 0.6 THEN 'preparing' WHEN a.r < 0.92 THEN 'shipped' ELSE 'cancelled' END
    WHEN a.age < 6 THEN CASE WHEN a.r < 0.25 THEN 'shipped' WHEN a.r < 0.6 THEN 'in_transit' WHEN a.r < 0.9 THEN 'delivered' ELSE 'cancelled' END
    ELSE CASE WHEN a.r < 0.76 THEN 'delivered' WHEN a.r < 0.85 THEN 'cancelled' WHEN a.r < 0.93 THEN 'returned' ELSE 'in_transit' END
  END AS status) st
CROSS JOIN LATERAL (SELECT CASE WHEN st.status = 'pending_confirmation' AND a.r < 0.3 THEN NULL
    WHEN (d.n % 10) < 7 THEN (ARRAY['cevaplandi','cevaplandi','cevaplandi','cevaplandi','cevaplandi','cevaplanmadi','ulasilamadi','mesgul'])[1 + (d.n % 8)::int]
  END AS status) call;

-- Items: one machine (96'lık / 50'lik / 24'lük) and sometimes a spare part.
INSERT INTO order_items (public_id, order_id, product_id, name, quantity, unit_price, total_amount, created_at, updated_at)
SELECT 'oit_demo_' || o.public_id || '_1', o.id, p.id, p.name, 1, p.unit_price, p.unit_price, o.created_at, o.created_at
FROM orders o
JOIN products p ON p.public_id = (ARRAY['prd_demo_1','prd_demo_1','prd_demo_2','prd_demo_2','prd_demo_6','prd_demo_1','prd_demo_2'])[1 + (o.id % 7)::int]
WHERE o.public_id LIKE 'ord_demo_h%';
INSERT INTO order_items (public_id, order_id, product_id, name, quantity, unit_price, total_amount, created_at, updated_at)
SELECT 'oit_demo_' || o.public_id || '_2', o.id, p.id, p.name, 1 + (o.id % 2)::int, p.unit_price, p.unit_price * (1 + (o.id % 2)), o.created_at, o.created_at
FROM orders o
JOIN products p ON p.public_id = (ARRAY['prd_demo_3','prd_demo_4','prd_demo_5'])[1 + (o.id % 3)::int]
WHERE o.public_id LIKE 'ord_demo_h%' AND o.id % 5 IN (0, 2);
UPDATE orders o SET total_amount = t.total
FROM (SELECT order_id, sum(total_amount) AS total FROM order_items GROUP BY order_id) t
WHERE t.order_id = o.id AND o.public_id LIKE 'ord_demo_h%';

-- Shipments for everything that left the warehouse; a few recent ones still miss a tracking number, some wait at the branch.
INSERT INTO shipments (public_id, order_id, customer_id, provider, tracking_number, status, recipient_name, recipient_phone,
                       recipient_address, recipient_city, recipient_district, last_event_text, shipped_at, delivered_at, payment_type, created_at, updated_at)
SELECT 'shp_demo_' || o.public_id, o.id, o.customer_id, o.cargo_provider,
       CASE WHEN o.status = 'shipped' AND o.id % 4 = 0 THEN NULL
            WHEN o.cargo_provider = 'ptt' THEN 'KP' || lpad((25000000 + o.id)::text, 11, '0') ELSE '7' || lpad((6000000 + o.id)::text, 11, '0') END,
       CASE o.status WHEN 'delivered' THEN 'delivered' WHEN 'returned' THEN 'returned' WHEN 'shipped' THEN 'created' ELSE 'in_transit' END,
       cu.full_name, cu.phone, ca.address_line, ca.city, ca.district,
       CASE o.status
         WHEN 'delivered' THEN 'Teslim edildi'
         WHEN 'returned' THEN CASE WHEN o.id % 2 = 0 THEN 'Dağıtımdan İade' ELSE 'Alıcı Kabul Etmedi - göndericiye iade' END
         WHEN 'in_transit' THEN CASE
           WHEN o.id % 5 = 0 AND o.cargo_provider = 'ptt' THEN 'Adreste Yok - Haber Kağıdı Bırakıldı'
           WHEN o.id % 5 = 0 THEN 'AliciSubede'
           ELSE 'Transfer merkezinden çıkış yaptı' END
         ELSE 'Kargo kaydı oluşturuldu' END,
       o.created_at + interval '18 hours',
       CASE WHEN o.status = 'delivered' THEN o.created_at + make_interval(days => 2 + (o.id % 3)::int) END,
       'cash_on_delivery', least(now(), o.created_at + interval '12 hours'), least(now(), o.created_at + interval '12 hours')
FROM orders o
JOIN customers cu ON cu.id = o.customer_id
JOIN customer_addresses ca ON ca.customer_id = cu.id
WHERE o.public_id LIKE 'ord_demo_h%' AND o.status IN ('shipped', 'in_transit', 'delivered', 'returned');
UPDATE shipments SET delivered_at = least(delivered_at, now() - interval '5 minutes') WHERE public_id LIKE 'shp_demo_ord_demo_h%' AND delivered_at IS NOT NULL;

-- KolayBi-style invoices (Fatura Analizi): most delivered orders are invoiced, returns get a sale_return.
INSERT INTO accounting_contacts (public_id, customer_id, name, phone, city, district, created_at, updated_at)
SELECT 'acc_demo_h' || h.g, c.id, h.full_name, c.phone, dc.city, dc.district, h.created_at, h.created_at
FROM demo_hist h JOIN customers c ON c.public_id = 'cus_demo_h' || h.g JOIN demo_cities dc ON dc.i = h.city_i;

INSERT INTO invoices (public_id, invoice_number, contact_id, order_id, invoice_type, status, currency, issue_date, subtotal, vat_total, grand_total, paid_total, idempotency_key, created_at, updated_at)
SELECT 'inv_demo_' || o.public_id || '_' || t.kind, 'DMO' || to_char(o.created_at, 'YYYY') || lpad(o.id::text, 6, '0') || CASE t.kind WHEN 'r' THEN 'R' ELSE '' END,
       ac.id, o.id, CASE t.kind WHEN 'r' THEN 'sale_return' ELSE 'sale' END,
       CASE WHEN t.kind = 'r' OR o.id % 6 <> 0 THEN 'paid' ELSE 'issued' END, 'TRY',
       ((o.created_at AT TIME ZONE 'Europe/Istanbul')::date + CASE t.kind WHEN 'r' THEN 6 ELSE 1 END),
       round(o.total_amount / 1.2, 2), o.total_amount - round(o.total_amount / 1.2, 2), o.total_amount,
       CASE WHEN t.kind = 'r' OR o.id % 6 <> 0 THEN o.total_amount ELSE 0 END,
       'demo-invoice-' || o.public_id || '-' || t.kind, o.created_at, o.created_at
FROM orders o
JOIN customers cu ON cu.id = o.customer_id
JOIN accounting_contacts ac ON ac.customer_id = cu.id AND ac.public_id LIKE 'acc_demo_h%'
CROSS JOIN LATERAL (VALUES ('s'), ('r')) t(kind)
WHERE o.public_id LIKE 'ord_demo_h%' AND o.status IN ('delivered', 'returned') AND o.id % 10 <> 3
  AND (t.kind = 's' OR o.status = 'returned')
  AND ((o.created_at AT TIME ZONE 'Europe/Istanbul')::date + CASE t.kind WHEN 'r' THEN 6 ELSE 1 END) <= (now() AT TIME ZONE 'Europe/Istanbul')::date;

COMMIT;

SELECT (SELECT count(*) FROM conversations WHERE public_id LIKE 'cnv_demo%') AS conversations,
       (SELECT count(*) FROM messages WHERE public_id LIKE 'msg_demo%') AS messages,
       (SELECT count(*) FROM orders WHERE public_id LIKE 'ord_demo%') AS orders,
       (SELECT count(*) FROM shipments WHERE public_id LIKE 'shp_demo%') AS shipments,
       (SELECT count(*) FROM invoices WHERE public_id LIKE 'inv_demo%') AS invoices;
