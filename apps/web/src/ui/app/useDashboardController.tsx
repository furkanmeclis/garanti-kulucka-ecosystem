import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { createAdminClient, toProviderAttemptViewModel } from "../../api/admin-client.js";
import { createAuthClient } from "../../api/auth-client.js";
import { createDomainClient } from "../../api/domain-client.js";
import { createFileClient } from "../../api/file-client.js";
import { createBackendHttpClient } from "../../api/http-client.js";
import { createWebphoneClient } from "../../api/webphone-client.js";
import { backendBaseUrl, tokenStorageKey, type DashboardData, navigationItems, navigationRole, flowFromPath, readStoredToken, defaultBalanceSummary, defaultCustomerSummary, defaultProviderDebugSummary, defaultShipmentPipelineSummary, defaultCommentModerationSummary, defaultInstagramAnalyticsSummary, defaultReportSummary } from "./shared.js";
import { publicPageFromPath } from "../pages/AuthScreens.js";
import { useNotifications } from "./notifications.js";
import { uiMessage, type UiMessage } from "../i18n/messages/status.js";
import { emptyDashboardData, type DashboardCore } from "./dashboard/types.js";
import { useSession } from "./dashboard/useSession.js";
import { useInboxFlow } from "./dashboard/useInboxFlow.js";
import { useOrdersFlow } from "./dashboard/useOrdersFlow.js";
import { useShipmentsFlow } from "./dashboard/useShipmentsFlow.js";
import { useAdminFlow } from "./dashboard/useAdminFlow.js";
import { useRealtimeSync } from "./dashboard/useRealtimeSync.js";

/**
 * Composes the per-flow dashboard hooks (session, inbox, orders, shipments, admin, realtime) into the flat
 * controller object the routed pages consume as `ctx`. Cross-flow work lives here: the initial dashboard
 * load, logout reset and navigation derived from the current route and role.
 */
export function useDashboardController() {
  const location = useLocation();
  const publicPage = publicPageFromPath(location.pathname);
  const [data, setData] = useState<DashboardData>(() => emptyDashboardData());
  const [status, setStatus] = useState<UiMessage>(() => uiMessage("ready"));
  const dashboardLoadKeyRef = useRef<string | null>(null);

  const http = useMemo(
    () =>
      createBackendHttpClient({
        baseUrl: backendBaseUrl,
        getAccessToken: () => readStoredToken(),
      }),
    [],
  );
  const auth = useMemo(() => createAuthClient(http), [http]);
  const domain = useMemo(() => createDomainClient(http), [http]);
  const admin = useMemo(() => createAdminClient(http), [http]);
  const files = useMemo(() => createFileClient(http), [http]);
  const webphone = useMemo(() => createWebphoneClient(http), [http]);

  const session = useSession(auth, setStatus);
  const { token, setToken, user, setUser, authChecked, setAuthChecked } = session;
  const notifications = useNotifications(user?.public_id ?? null);
  const pushNotification = notifications.pushEnvelope;
  const core: DashboardCore = { user, http, auth, domain, admin, files, webphone, data, setData, setStatus };
  const inbox = useInboxFlow(core);
  const orders = useOrdersFlow(core, inbox.selectedConversation);
  const shipments = useShipmentsFlow(core);
  const adminFlow = useAdminFlow(core);
  const realtime = useRealtimeSync({
    token,
    authChecked,
    user,
    setStatus,
    pushNotification,
    refreshConversations: inbox.refreshConversations,
    refreshMessages: inbox.refreshMessages,
    refreshShipments: shipments.refreshShipments,
    selectedConversationId: inbox.selectedConversationId,
    selectedConversationIdRef: inbox.selectedConversationIdRef,
  });
  const { setMessageShortcuts, setSelectedConversationId } = inbox;
  const { setSelectedOrderId, setOrderTotalCount } = orders;
  const { setSelectedShipmentId, setShipmentTotalCount } = shipments;

  useEffect(() => {
    if (!token || !authChecked || !user) return;
    const loadKey = `${token}:${user.public_id}`;
    if (dashboardLoadKeyRef.current === loadKey) return;
    dashboardLoadKeyRef.current = loadKey;
    void loadDashboard();
  }, [authChecked, token, user]);

  async function loadDashboard() {
    setStatus(uiMessage("flowsLoading"));
    const canReadCustomers = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadComments = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadBalances = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadInventory = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadShipmentPipeline = ["admin", "owner", "calisan", "kargo_operatoru"].includes(user?.role ?? "");
    const optional = async <T,>(label: string, request: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await request;
      } catch (error) {
        console.warn(`[Dashboard] Optional ${label} request failed`, error);
        return fallback;
      }
    };
    const [conversations, conversationSummary, customers, customerSummary, commentModeration, balanceSummary, orderSummary, productSummary, shipmentSummary, shipmentPipeline, reportSummary, orders, products, shipments, shortcuts, settings, webphoneConfig] = await Promise.all([
      domain.listConversations({ limit: 20 }),
      domain.getConversationSummary(),
      canReadCustomers ? domain.listCustomers(50) : Promise.resolve({ data: [] }),
      canReadCustomers ? domain.getCustomerSummary() : Promise.resolve(defaultCustomerSummary),
      canReadComments ? domain.getCommentModerationSummary() : Promise.resolve(defaultCommentModerationSummary),
      canReadBalances ? domain.getBalanceSummary() : Promise.resolve(defaultBalanceSummary),
      domain.getOrderSummary(),
      domain.getProductSummary(),
      domain.getShipmentSummary(),
      canReadShipmentPipeline ? domain.getShipmentPipelineSummary() : Promise.resolve(defaultShipmentPipelineSummary),
      user?.role === "admin" ? domain.getReportSummary() : Promise.resolve(defaultReportSummary),
      domain.listOrders(20),
      canReadInventory ? domain.listProducts(50) : domain.listOrderProductOptions(50),
      domain.listShipments(20),
      canReadCustomers ? optional("message shortcuts", domain.listMessageShortcuts(), { data: [] }) : Promise.resolve({ data: [] }),
      user?.role === "admin" ? admin.listSettings("global") : Promise.resolve({ data: [] }),
      webphone.getConfig(),
    ]);
    const [integrationAccounts, providerCatalog, providerAttempts, providerDebugSummary, settingsAudit, integrationAudit, fileOrphans] = user?.role === "admin"
      ? await Promise.all([
          admin.listIntegrationAccounts(),
          admin.listProviderCatalog(),
          admin.listProviderAttempts({ limit: 10 }),
          admin.getProviderDebugSummary(),
          admin.listSettingsAudit({ limit: 10 }),
          admin.listIntegrationAudit({ limit: 10 }),
          files.listOrphanCandidates({ limit: 10 }),
        ])
      : [
          { data: [] },
          { data: [] },
          { data: [] },
          defaultProviderDebugSummary,
          { data: [], summary: { total_count: 0 } },
          { data: [], summary: { total_count: 0 } },
          { data: [], summary: { total_count: 0 } },
        ];
    const firstConversation = conversations.data[0]?.public_id;
    const messages = firstConversation
      ? await domain.listMessages(firstConversation, 50)
      : { data: [] };
    const firstIntegrationAccountPublicId = integrationAccounts.data[0]?.public_id;
    const instagramAnalytics = user?.role === "admin" && firstIntegrationAccountPublicId
      ? await admin.getInstagramAnalyticsSummary(firstIntegrationAccountPublicId)
      : defaultInstagramAnalyticsSummary;

    setData({
      conversations: conversations.data,
      customers: customers.data,
      messages: messages.data,
      orders: orders.data,
      products: products.data,
      shipments: shipments.data,
      settings: settings.data,
      integrationAccounts: integrationAccounts.data,
      settingsAudit: settingsAudit.data,
      settingsAuditSummary: settingsAudit.summary ?? { total_count: settingsAudit.data.length },
      integrationAudit: integrationAudit.data,
      integrationAuditSummary: integrationAudit.summary ?? { total_count: integrationAudit.data.length },
      providerCatalog: providerCatalog.data,
      providerAttempts: providerAttempts.data.map(toProviderAttemptViewModel),
      providerDebugSummary,
      fileOrphans: fileOrphans.data,
      fileOrphanSummary: fileOrphans.summary ?? { total_count: fileOrphans.data.length },
      instagramAnalytics,
      conversationSummary,
      customerSummary,
      orderSummary,
      productSummary,
      reportSummary,
      balanceSummary,
      shipmentSummary,
      shipmentPipeline,
      commentModeration,
      webphone: webphoneConfig,
    });
    setMessageShortcuts(shortcuts.data);
    setSelectedConversationId((current) => current ?? firstConversation ?? null);
    setSelectedOrderId((current) => current ?? orders.data[0]?.public_id ?? null);
    setSelectedShipmentId((current) => current ?? shipments.data[0]?.public_id ?? null);
    setOrderTotalCount(orders.meta?.total_count ?? orders.data.length);
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setStatus(uiMessage("boundariesActive"));
  }

  async function handleLogout() {
    setStatus(uiMessage("signingOut"));
    try {
      await auth.logout();
    } finally {
      window.localStorage.removeItem(tokenStorageKey);
      dashboardLoadKeyRef.current = null;
      setToken(null);
      setUser(null);
      setData(emptyDashboardData());
      adminFlow.setIntegrationSnapshot(null);
      inbox.resetInbox();
      orders.setSelectedOrderId(null);
      shipments.resetShipments();
      setAuthChecked(true);
      setStatus(uiMessage("signedOut"));
    }
  }

  const visibleNavigation = navigationItems.filter((item) => item.roles.includes(navigationRole(user?.role)));
  const requestedFlow = flowFromPath(location.pathname);
  const activeFlow = visibleNavigation.some((item) => item.key === requestedFlow)
    ? requestedFlow
    : visibleNavigation[0]?.key ?? "inbox";

  return {
    ...session,
    ...inbox,
    ...orders,
    ...shipments,
    ...adminFlow,
    ...realtime,
    location,
    publicPage,
    data,
    setData,
    status,
    setStatus,
    dashboardLoadKeyRef,
    http,
    auth,
    domain,
    admin,
    files,
    webphone,
    loadDashboard,
    handleLogout,
    notifications,
    visibleNavigation,
    requestedFlow,
    activeFlow,
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;
