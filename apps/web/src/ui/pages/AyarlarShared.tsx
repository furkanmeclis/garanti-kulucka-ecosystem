import { useCallback, useState } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";

/** Ayarlar sekmeleri için ortak yardımcılar (legacy mesaj bandı, tarih biçimi). */

export type AyarlarMesaj = { tip: "basari" | "hata"; metin: string } | null;

export function MesajBanner({ mesaj }: { mesaj: AyarlarMesaj }) {
  if (!mesaj) return null;
  return (
    <div className={`ayarlar-mesaj ${mesaj.tip}`} role="status" data-testid="ayarlar-mesaj">
      {mesaj.tip === "basari" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <p>{mesaj.metin}</p>
    </div>
  );
}

export function hataMetni(error: unknown) {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { error?: { message?: string } } }).body;
    if (body?.error?.message) return body.error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function tarihSaatFormatla(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function useMesaj() {
  const [mesaj, setMesaj] = useState<AyarlarMesaj>(null);
  const mesajGoster = useCallback((tip: "basari" | "hata", metin: string) => {
    setMesaj({ tip, metin });
    window.setTimeout(() => setMesaj((current) => (current?.metin === metin ? null : current)), 4000);
  }, []);
  return { mesaj, setMesaj, mesajGoster };
}

