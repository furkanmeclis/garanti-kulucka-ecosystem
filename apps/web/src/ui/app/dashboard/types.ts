import type { Dispatch, SetStateAction } from "react";
import type { createAdminClient } from "../../../api/admin-client.js";
import type { LoginResponse, createAuthClient } from "../../../api/auth-client.js";
import type { createDomainClient } from "../../../api/domain-client.js";
import type { createFileClient } from "../../../api/file-client.js";
import type { createBackendHttpClient } from "../../../api/http-client.js";
import type { createWebphoneClient } from "../../../api/webphone-client.js";
import type { UiMessage } from "../../i18n/messages/status.js";
import { defaultBalanceSummary, defaultCommentModerationSummary, defaultConversationSummary, defaultCustomerSummary, defaultInstagramAnalyticsSummary, defaultOrderSummary, defaultProductSummary, defaultProviderDebugSummary, defaultReportSummary, defaultShipmentPipelineSummary, defaultShipmentSummary, type DashboardData } from "../shared.js";

/** Backend clients plus the cross-flow state every dashboard flow hook reads or writes. */
export interface DashboardCore {
  user: LoginResponse["user"] | null;
  http: ReturnType<typeof createBackendHttpClient>;
  auth: ReturnType<typeof createAuthClient>;
  domain: ReturnType<typeof createDomainClient>;
  admin: ReturnType<typeof createAdminClient>;
  files: ReturnType<typeof createFileClient>;
  webphone: ReturnType<typeof createWebphoneClient>;
  data: DashboardData;
  setData: Dispatch<SetStateAction<DashboardData>>;
  setStatus: Dispatch<SetStateAction<UiMessage>>;
}

/** Dashboard data before load and after logout. */
export function emptyDashboardData(): DashboardData {
  return {
      conversations: [],
      customers: [],
      messages: [],
      orders: [],
      products: [],
      shipments: [],
      settings: [],
      integrationAccounts: [],
      settingsAudit: [],
      settingsAuditSummary: { total_count: 0 },
      integrationAudit: [],
      integrationAuditSummary: { total_count: 0 },
      providerCatalog: [],
      providerAttempts: [],
      providerDebugSummary: defaultProviderDebugSummary,
      fileOrphans: [],
      fileOrphanSummary: { total_count: 0 },
      instagramAnalytics: defaultInstagramAnalyticsSummary,
      conversationSummary: defaultConversationSummary,
      customerSummary: defaultCustomerSummary,
      orderSummary: defaultOrderSummary,
      productSummary: defaultProductSummary,
      reportSummary: defaultReportSummary,
      balanceSummary: defaultBalanceSummary,
      shipmentSummary: defaultShipmentSummary,
      shipmentPipeline: defaultShipmentPipelineSummary,
      commentModeration: defaultCommentModerationSummary,
      webphone: null,
  };
}
