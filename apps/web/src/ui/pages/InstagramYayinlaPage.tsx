import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, ExternalLink, Image as ImageIcon, Instagram, Loader2, Send, Upload } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createFileClient } from "../../api/file-client.js";
import { createInstagramClient, type InstagramPublication } from "../../api/instagram-client.js";

/**
 * Legacy frontend/src/pages/instagram/YayinlaPage.jsx parity (admin, calisan). Publishing goes
 * through `POST /api/instagram/publications` -> worker `instagram.media.publish`; Garage uploads
 * use the presigned upload flow with a browser SHA-256 checksum.
 */

const CAPTION_LIMIT = 2200;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX = 5;

type Mesaj = { tip: "basari" | "hata" | "bilgi"; metin: string };

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function newIdempotencyKey() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : Math.random().toString(36).slice(2);
  return `instagram_yayinla_${Date.now()}_${random.slice(0, 12)}`;
}

export function InstagramYayinlaPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createInstagramClient(props.http), [props.http]);
  const files = useMemo(() => createFileClient(props.http), [props.http]);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [dosyaYukleniyor, setDosyaYukleniyor] = useState(false);
  const [dosya, setDosya] = useState<{ publicId: string; ad: string; onizleme: string; video: boolean } | null>(null);
  const [sonuc, setSonuc] = useState<InstagramPublication | null>(null);
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const aktif = useRef(true);

  useEffect(() => {
    aktif.current = true;
    return () => {
      aktif.current = false;
    };
  }, []);

  useEffect(() => {
    const onizleme = dosya?.onizleme;
    return () => {
      if (onizleme) URL.revokeObjectURL(onizleme);
    };
  }, [dosya]);

  const medyaVar = imageUrl.trim().length > 0 || dosya !== null;
  const onizlemeUrl = dosya?.onizleme ?? imageUrl;

  const dosyaSec = async (secilen: File | undefined) => {
    if (!secilen) return;
    setMesaj(null);
    setDosyaYukleniyor(true);
    try {
      const yuklenen = await files.uploadBrowserFile(secilen);
      setDosya({
        publicId: yuklenen.public_id,
        ad: secilen.name,
        onizleme: URL.createObjectURL(secilen),
        video: secilen.type.startsWith("video/"),
      });
      setImageUrl("");
      idempotencyKey.current = null;
    } catch (error) {
      setMesaj({ tip: "hata", metin: errorMessage(error, "Dosya yüklenemedi") });
    } finally {
      setDosyaYukleniyor(false);
    }
  };

  const sonucuBekle = async (publicId: string) => {
    for (let deneme = 0; deneme < POLL_MAX; deneme += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (!aktif.current) return;
      try {
        const yayin = await client.getPublication(publicId);
        if (!aktif.current) return;
        if (yayin.status === "published") {
          setSonuc(yayin);
          setMesaj({ tip: "basari", metin: "Instagram gönderisi yayınlandı!" });
          return;
        }
        if (yayin.status === "failed") {
          setMesaj({ tip: "hata", metin: yayin.error_message || "Yayınlama başarısız" });
          return;
        }
        if (yayin.status === "dry_run") {
          setMesaj({ tip: "bilgi", metin: "Yayın isteği işlendi (canlı mod kapalı: providers.instagram.live_mode)" });
          return;
        }
      } catch {
        return;
      }
    }
  };

  const yayinla = async () => {
    if (!medyaVar) {
      setMesaj({ tip: "hata", metin: "Fotoğraf URL'si girin" });
      return;
    }
    if (caption.length > CAPTION_LIMIT) {
      setMesaj({ tip: "hata", metin: "Başlık 2200 karakterden uzun olamaz" });
      return;
    }
    setYukleniyor(true);
    setMesaj(null);
    setSonuc(null);
    idempotencyKey.current ??= newIdempotencyKey();
    try {
      const yanit = await client.publish({
        ...(dosya ? { file_public_id: dosya.publicId } : { image_url: imageUrl.trim() }),
        caption: caption.trim(),
        idempotency_key: idempotencyKey.current,
      });
      idempotencyKey.current = null;
      setImageUrl("");
      setCaption("");
      setDosya(null);
      if (yanit.publication.status === "published") {
        setSonuc(yanit.publication);
        setMesaj({ tip: "basari", metin: "Instagram gönderisi yayınlandı!" });
      } else {
        setMesaj({ tip: "bilgi", metin: "Yayın isteği kuyruğa alındı" });
        void sonucuBekle(yanit.publication.public_id);
      }
    } catch (error) {
      setMesaj({ tip: "hata", metin: errorMessage(error, "Yayınlama başarısız") });
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <div className="ig-sayfa ig-sayfa-dar" data-testid="instagram-yayinla-page">
      <div className="ig-baslik">
        <div className="ig-baslik-ikon">
          <Send size={28} />
        </div>
        <div>
          <h1>Instagram Gönderi Yayınla</h1>
          <p>Foto ve açıklama ile Instagram hesabınıza doğrudan gönderi yayınlayın</p>
        </div>
      </div>

      {mesaj && (
        <div className={`ig-mesaj ig-mesaj-${mesaj.tip}`} role={mesaj.tip === "hata" ? "alert" : "status"}>
          {mesaj.tip === "hata" ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
          <p>{mesaj.metin}</p>
        </div>
      )}

      <div className="ig-yayinla-grid">
        <div className="ig-kart ig-form">
          <div>
            <label className="ig-etiket" htmlFor="ig-image-url">
              Fotoğraf URL'si <span className="ig-zorunlu">*</span>
            </label>
            <input
              id="ig-image-url"
              type="url"
              value={imageUrl}
              onChange={(event) => {
                setImageUrl(event.target.value);
                if (event.target.value) setDosya(null);
                idempotencyKey.current = null;
              }}
              placeholder="https://example.com/photo.jpg"
              className="ig-input ig-mono"
            />
            <p className="ig-yardim">JPEG, public erişilebilir URL. Oran: 4:5 ile 1.91:1 arası.</p>
            <label className="ig-dosya">
              {dosyaYukleniyor ? <Loader2 size={14} className="ig-spin" /> : <Upload size={14} />}
              <span>{dosya ? dosya.ad : "veya dosya yükle (JPEG / MP4)"}</span>
              <input
                type="file"
                accept="image/jpeg,video/mp4"
                disabled={dosyaYukleniyor || yukleniyor}
                data-testid="instagram-file-input"
                onChange={(event) => {
                  void dosyaSec(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <div>
            <label className="ig-etiket" htmlFor="ig-caption">
              Başlık (Caption)
            </label>
            <textarea
              id="ig-caption"
              value={caption}
              onChange={(event) => {
                setCaption(event.target.value);
                idempotencyKey.current = null;
              }}
              placeholder="Gönderinizin açıklamasını yazın..."
              rows={8}
              maxLength={CAPTION_LIMIT}
              className="ig-input ig-textarea"
            />
            <p className={`ig-sayac ${caption.length > 2000 ? "ig-sayac-uyari" : ""}`}>
              {caption.length} / 2200 karakter
            </p>
          </div>

          <button type="button" className="ig-yayinla-buton" onClick={() => void yayinla()} disabled={yukleniyor || dosyaYukleniyor || !medyaVar}>
            {yukleniyor ? <Loader2 size={16} className="ig-spin" /> : <Send size={16} />}
            {yukleniyor ? "Yayınlanıyor..." : "Instagram'a Yayınla"}
          </button>
        </div>

        <div className="ig-kart">
          <h2 className="ig-onizleme-baslik">Önizleme</h2>
          <div className="ig-onizleme" data-testid="instagram-preview">
            <div className="ig-onizleme-hesap">
              <div className="ig-onizleme-avatar" />
              <span>garantikulucka</span>
            </div>
            {onizlemeUrl ? (
              dosya?.video ? (
                <video src={onizlemeUrl} className="ig-onizleme-medya" muted controls />
              ) : (
                <img
                  src={onizlemeUrl}
                  alt="preview"
                  className="ig-onizleme-medya"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )
            ) : (
              <div className="ig-onizleme-bos">
                <ImageIcon size={48} />
              </div>
            )}
            {caption && (
              <div className="ig-onizleme-caption">
                <span>garantikulucka</span> {caption}
              </div>
            )}
          </div>
        </div>
      </div>

      {sonuc?.media_id && (
        <div className="ig-sonuc" data-testid="instagram-publish-result">
          <div>
            <p className="ig-sonuc-baslik">Yayınlandı</p>
            <p className="ig-sonuc-alt">Media ID: {sonuc.media_id}</p>
          </div>
          <a href={`https://www.instagram.com/p/${sonuc.media_id}`} target="_blank" rel="noopener noreferrer">
            Instagram'da Gör <ExternalLink size={12} />
          </a>
        </div>
      )}

      <div className="ig-gereksinimler">
        <Instagram size={16} />
        <div>
          <p>Teknik Gereksinimler (Instagram Graph API)</p>
          <ul>
            <li>Fotoğraf formatı: JPEG</li>
            <li>Boyut oranı: 4:5 - 1.91:1 (kare veya dikey)</li>
            <li>Başlık: Maksimum 2200 karakter</li>
            <li>URL herkese açık olmalı (Instagram sunucuları indirecek)</li>
            <li>Günlük limit: 100 post / 24 saat</li>
            <li>Gerekli izin: instagram_business_content_publish</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
