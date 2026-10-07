import { sql, type AppDatabase } from "@garanti-kulucka/database";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";

/**
 * Legacy GET /api/kolaybi/urunler (StokPage KolayBi eşleştirme listesi). The API queues `kolaybi.product.list`;
 * a live result is stored as `integration_accounts.metadata.kolaybi_products`, the snapshot the API serves.
 * Dry runs never reach the write-back (only results with `live_call_performed: true`).
 */

export interface KolaybiProduct {
  id: string;
  name: string | null;
  sale_price: string | number | null;
  stock_quantity: string | number | null;
  unit: string | null;
  category: string | null;
}

export interface KolaybiProductsSnapshot {
  products: KolaybiProduct[];
  total: number;
  synced_at: string;
  request_id: string;
}

export interface KolaybiProductRepository {
  store: (accountPublicId: string | null, snapshot: KolaybiProductsSnapshot) => Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export function kolaybiProductsFrom(envelope: ProviderRequestEnvelope, responsePayload: unknown): { accountPublicId: string | null; snapshot: KolaybiProductsSnapshot } | null {
  if (envelope.provider !== "kolaybi" || envelope.operation !== "product.list") return null;
  if (!isRecord(responsePayload) || responsePayload.success !== true || !Array.isArray(responsePayload.urunler)) return null;
  const products = responsePayload.urunler.filter(isRecord).flatMap((product) => {
    const id = scalar(product.id);
    if (id === null) return [];
    return [{
      id: String(id),
      name: typeof product.name === "string" ? product.name : null,
      sale_price: scalar(product.sale_price),
      stock_quantity: scalar(product.stock_quantity),
      unit: typeof product.unit === "string" ? product.unit : null,
      category: typeof product.category === "string" ? product.category : null,
    }];
  });
  return {
    accountPublicId: envelope.account_public_id ?? null,
    snapshot: { products, total: products.length, synced_at: new Date().toISOString(), request_id: envelope.request_id },
  };
}

export class DatabaseKolaybiProductRepository implements KolaybiProductRepository {
  constructor(private readonly db: AppDatabase) {}

  async store(accountPublicId: string | null, snapshot: KolaybiProductsSnapshot): Promise<boolean> {
    const account = accountPublicId
      ? { public_id: accountPublicId }
      : await this.db
          .selectFrom("integration_accounts")
          .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
          .select("integration_accounts.public_id as public_id")
          .where("integration_providers.key", "=", "kolaybi")
          .where("integration_accounts.status", "=", "active")
          .orderBy("integration_accounts.id", "asc")
          .executeTakeFirst();
    if (!account) return false;
    const result = await this.db
      .updateTable("integration_accounts")
      .set({
        metadata: sql`jsonb_set(coalesce(metadata, '{}'::jsonb), '{kolaybi_products}', ${JSON.stringify(snapshot)}::jsonb)`,
        updated_at: new Date(),
      })
      .where("public_id", "=", account.public_id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }
}
