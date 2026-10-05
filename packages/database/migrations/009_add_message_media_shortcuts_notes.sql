ALTER TABLE conversations
  ADD COLUMN notes TEXT;

CREATE TABLE message_shortcuts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  message TEXT,
  type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('default', 'custom')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order BIGINT NOT NULL DEFAULT 999,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_shortcuts_code_not_blank CHECK (length(trim(code)) > 0)
);
CREATE UNIQUE INDEX message_shortcuts_code_idx ON message_shortcuts(code);
CREATE INDEX message_shortcuts_active_sort_idx ON message_shortcuts(is_active, sort_order, created_at);
CREATE INDEX message_shortcuts_created_by_user_id_idx ON message_shortcuts(created_by_user_id);

CREATE TABLE message_shortcut_attachments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  shortcut_id BIGINT NOT NULL REFERENCES message_shortcuts(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('image', 'video', 'document', 'file')),
  sort_order BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shortcut_id, file_id)
);
CREATE INDEX message_shortcut_attachments_shortcut_id_idx ON message_shortcut_attachments(shortcut_id);
CREATE INDEX message_shortcut_attachments_file_id_idx ON message_shortcut_attachments(file_id);

INSERT INTO message_shortcuts (public_id, code, message, type, sort_order) VALUES
  ('msc_default_ss', 'ss', 'https://www.instagram.com/garantikulucka/ yukarıdaki linkten ürün fotoğraf, video ve kullanıcı yorumlarına bakabilirsiniz efendim.', 'default', 1),
  ('msc_default_y', 'y', 'yardımcı olmamı istediğiniz başka bir konu var mı efendim?', 'default', 2),
  ('msc_default_5', '5', 'makinamız 50 yumurta kapasitelidir efendim.', 'default', 3),
  ('msc_default_k', 'k', 'tüm makinalarımızı kullanım kılavuzu ile birlikte göndermekteyiz efendim, ayrıca 0 322 911 03 70 nolu çağrı merkezimizden her zaman teknik destek alabilirsiniz.', 'default', 4),
  ('msc_default_t', 't', 'tabi efendim, ürünün gönderileceği kişinin isim, telefon ve adres bilgilerini iletirseniz siparişinizi oluşturabilirim.', 'default', 5),
  ('msc_default_r', 'r', 'rica ederiz efendim.', 'default', 6),
  ('msc_default_pt', 'pt', 'PTT kargo ve Sürat kargo ile kapıda ödemeli olarak gönderim sağlamaktayız efendim.', 'default', 8),
  ('msc_default_e', 'e', 'merhaba efendim', 'default', 16),
  ('msc_default_f', 'f', 'fiyatı 2550 tl, ÜCRETSİZ kargo ve kapıda ödemeli dir efendim.', 'default', 18),
  ('msc_default_1', '1', '2550 tl kapıda ödemeli olarak siparişinizi oluşturdum, hayırlı uğurlu olsun efendim, Garanti Kuluçkayı tercih ettiğiniz için teşekkür ederiz.', 'default', 15)
ON CONFLICT (code) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS message_shortcut_attachments;
DROP TABLE IF EXISTS message_shortcuts;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS notes;
