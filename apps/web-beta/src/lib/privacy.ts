/** Legacy DataDeletionPage shapes: public `/api/veri-silme-talebi` and admin `/admin/data-deletion-requests`. */
export type DataDeletionStatus = "pending" | "in_progress" | "completed" | "rejected";
export const dataDeletionStatuses: DataDeletionStatus[] = ["pending", "in_progress", "completed", "rejected"];

export interface DataDeletionInput {
  ad: string;
  email: string | null;
  telefon: string | null;
  instagram_kullanici_adi: string | null;
  messenger_psid: string | null;
  aciklama: string | null;
  tarih: string;
}

export interface DataDeletionStatusLookup {
  reference: string;
  status: DataDeletionStatus;
  requested_at: string;
  resolved_at: string | null;
}

export interface DataDeletionRequest {
  public_id: string;
  reference: string;
  source: "form" | "facebook";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  instagram_username: string | null;
  messenger_psid: string | null;
  description: string | null;
  status: DataDeletionStatus;
  resolution_note: string | null;
  requested_at: string;
  resolved_at: string | null;
  created_at: string;
}
