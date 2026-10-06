import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { createAdminClient, type IntegrationAccountSnapshot, toProviderAttemptViewModel } from "../../api/admin-client.js";
import { createAuthClient, type LoginResponse } from "../../api/auth-client.js";
import { createDomainClient, type ConversationSummary, type MessageShortcutSummary, type OrderSummary, type ShipmentSummary } from "../../api/domain-client.js";
import { createFileClient, type DownloadInstruction, type FileMetadata, type FileOrphanCleanupDryRun } from "../../api/file-client.js";
import { BackendRequestError, createBackendHttpClient } from "../../api/http-client.js";
import { createRealtimeClient, type RealtimeClient } from "../../api/realtime-client.js";
import { createWebphoneClient } from "../../api/webphone-client.js";
import { backendBaseUrl, tokenStorageKey, type DashboardData, type PendingAttachment, type ShortcutDraft, type ShipmentPipelineFilter, type ShipmentFilter, type OrderSortBy, type SortDirection, type OrderCargoProvider, type OrderFormItem, type OrderFormState, navigationItems, navigationRole, instagramDraftImageUrl, instagramDraftCaption, shipmentPageSize, flowFromPath, shipmentFilterParams, shipmentMatchesFilter, orderStatusLabel, cargoProviderLabel, readStoredToken, attachmentTypeFromFile, isRecord, defaultOrderForm, parseMoneyInput, orderFormTotals, defaultBalanceSummary, defaultConversationSummary, defaultCustomerSummary, defaultOrderSummary, defaultProductSummary, defaultProviderDebugSummary, defaultShipmentPipelineSummary, defaultShipmentSummary, defaultCommentModerationSummary, defaultInstagramAnalyticsSummary, defaultReportSummary, toInstagramAnalyticsView, sipServerSettingsFrom, operationalPolicyFrom } from "./shared.js";
import { publicPageFromPath } from "../pages/AuthScreens.js";
import { useNotifications } from "./notifications.js";
import { rawMessage, uiMessage, type StatusKey, type UiMessage } from "../i18n/messages/status.js";

export function useDashboardController() {
  const location = useLocation();
  const publicPage = publicPageFromPath(location.pathname);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const notifications = useNotifications(user?.public_id ?? null);
  const pushNotification = notifications.pushEnvelope;
  const [data, setData] = useState<DashboardData>({
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
  });
  const [status, setStatus] = useState<UiMessage>(() => uiMessage("ready"));
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
  const [downloadInstruction, setDownloadInstruction] = useState<DownloadInstruction | null>(null);
  const [orphanCleanupPreview, setOrphanCleanupPreview] = useState<FileOrphanCleanupDryRun | null>(null);
  const [lastInstagramPublishPreview, setLastInstagramPublishPreview] = useState<string | null>(null);
  const [instagramPublishPreviewing, setInstagramPublishPreviewing] = useState(false);
  const [orphanCleanupPreviewing, setOrphanCleanupPreviewing] = useState(false);
  const [presenceUpdating, setPresenceUpdating] = useState(false);
  const [integrationSnapshot, setIntegrationSnapshot] = useState<IntegrationAccountSnapshot | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [conversationChannelFilter, setConversationChannelFilter] = useState("all");
  const [conversationStatusFilter, setConversationStatusFilter] = useState("all");
  const [conversationSearch, setConversationSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [messageShortcuts, setMessageShortcuts] = useState<MessageShortcutSummary[]>([]);
  const [shortcutMenuOpen, setShortcutMenuOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft>({ code: "", message: "", attachments: [] });
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [conversationNoteDraft, setConversationNoteDraft] = useState("");
  const [customerNoteDraft, setCustomerNoteDraft] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSourceFilter, setOrderSourceFilter] = useState("all");
  const [orderCargoFilter, setOrderCargoFilter] = useState("all");
  const [orderPersonnelFilter, setOrderPersonnelFilter] = useState("all");
  const [orderCreatedFrom, setOrderCreatedFrom] = useState("");
  const [orderCreatedTo, setOrderCreatedTo] = useState("");
  const [orderSortBy, setOrderSortBy] = useState<OrderSortBy>("created_at");
  const [orderSortDirection, setOrderSortDirection] = useState<SortDirection>("desc");
  const [orderPage, setOrderPage] = useState(0);
  const [orderTotalCount, setOrderTotalCount] = useState(0);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [printShipmentId, setPrintShipmentId] = useState<string | null>(null);
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [orderFormSubmitting, setOrderFormSubmitting] = useState(false);
  const [orderFormMessage, setOrderFormMessage] = useState<UiMessage | null>(null);
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => defaultOrderForm());
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>("all");
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentPage, setShipmentPage] = useState(0);
  const [shipmentTotalCount, setShipmentTotalCount] = useState(0);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [lastShipmentTrack, setLastShipmentTrack] = useState<string | null>(null);
  const [shipmentPipelineFilter, setShipmentPipelineFilter] = useState<ShipmentPipelineFilter>("all");
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutMediaInputRef = useRef<HTMLInputElement | null>(null);
  const conversationNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const customerNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const conversationFilterRequestSeqRef = useRef(0);
  const orderFilterRequestSeqRef = useRef(0);
  const shipmentFilterRequestSeqRef = useRef(0);
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

  const refreshConversations = useCallback(async () => {
    const conversations = await domain.listConversations({ limit: 20 });
    setData((current) => ({
      ...current,
      conversations: conversations.data,
    }));
  }, [domain]);

  const refreshMessages = useCallback(async (conversationPublicId: string) => {
    const messages = await domain.listMessages(conversationPublicId, 50);
    setData((current) => ({
      ...current,
      messages: selectedConversationIdRef.current === conversationPublicId ? messages.data : current.messages,
    }));
  }, [domain]);

  const refreshShipments = useCallback(async (options: { page?: number; filter?: ShipmentFilter; search?: string } = {}) => {
    const nextPage = options.page ?? shipmentPage;
    const nextFilter = options.filter ?? shipmentFilter;
    const nextSearch = options.search ?? shipmentSearch;
    const trimmedSearch = nextSearch.trim();
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: nextPage * shipmentPageSize,
    });
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId((current) => shipments.data.some((shipment) => shipment.public_id === current)
      ? current
      : shipments.data[0]?.public_id ?? null);
    return shipments;
  }, [domain, shipmentFilter, shipmentPage, shipmentSearch]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!token || !authChecked || !user) {
      setRealtimeClient(null);
      return;
    }

    const realtime = createRealtimeClient({
      baseUrl: backendBaseUrl,
      getAccessToken: () => readStoredToken(),
    });
    const offMessageCreated = realtime.on("message.created", (envelope) => {
      pushNotification(envelope);
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          await refreshMessages(conversationPublicId);
          setStatus(uiMessage("realtimeNewMessage"));
        } else {
          setStatus(uiMessage("realtimeNewConversation"));
        }
      })();
    });
    const offConversationUpdated = realtime.on("conversation.updated", (envelope) => {
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          setStatus(uiMessage("realtimeConversationUpdated"));
        }
      })();
    });
    const offShipmentUpdated = realtime.on("shipment.updated", (envelope) => {
      pushNotification(envelope);
      void (async () => {
        await refreshShipments();
        setStatus(uiMessage("realtimeShipmentUpdated"));
      })();
    });

    realtime.connect();
    setRealtimeClient(realtime);

    return () => {
      offMessageCreated();
      offConversationUpdated();
      offShipmentUpdated();
      realtime.disconnect();
      setRealtimeClient((current) => (current === realtime ? null : current));
    };
  }, [authChecked, pushNotification, refreshConversations, refreshMessages, refreshShipments, token, user]);

  useEffect(() => {
    if (!realtimeClient || !selectedConversationId) return;

    realtimeClient.joinConversation(selectedConversationId);
    return () => realtimeClient.leaveConversation(selectedConversationId);
  }, [realtimeClient, selectedConversationId]);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!token) {
        setAuthChecked(true);
        return;
      }

      try {
        const currentUser = await auth.me();
        if (!cancelled) {
          setUser(currentUser);
          setAuthChecked(true);
        }
      } catch {
        window.localStorage.removeItem(tokenStorageKey);
        if (!cancelled) {
          setToken(null);
          setUser(null);
          setAuthChecked(true);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [auth, token]);

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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setStatus(uiMessage("signingIn"));
    const response = await auth.login(email, password);
    window.localStorage.setItem(tokenStorageKey, response.access_token);
    setToken(response.access_token);
    setUser(response.user);
    setStatus(uiMessage("signedIn"));
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
      setData({
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
      });
      setIntegrationSnapshot(null);
      setSelectedConversationId(null);
      setSelectedOrderId(null);
      setSelectedShipmentId(null);
      setShipmentFilter("all");
      setShipmentSearch("");
      setShipmentPage(0);
      setShipmentTotalCount(0);
      setTrackingShipmentId(null);
      setLastShipmentTrack(null);
      setMessageShortcuts([]);
      setPendingAttachments([]);
      setShortcutMenuOpen(false);
      setShortcutDraft({ code: "", message: "", attachments: [] });
      setEditingShortcutId(null);
      setAiSuggestion(null);
      setAuthChecked(true);
      setStatus(uiMessage("signedOut"));
    }
  }

  async function handleUpload() {
    setStatus(uiMessage("uploadRequesting"));
    const response = await files.createUpload({
      original_name: "kanit.txt",
      mime_type: "text/plain",
      byte_size: 11,
      checksum: "niECqdXA95O1DqUepmPprCpbQW93H7pd34A88B3v5xU=",
    });

    if (response.upload.presigned_url) {
      await fetch(response.upload.presigned_url, {
        method: response.upload.method,
        headers: response.upload.headers,
        body: "frontend-ok",
      });
    }

    const verifiedFile = await files.getFile(response.file.public_id);
    setUploadedFile(verifiedFile);
    const download = await files.createDownload(verifiedFile.public_id);
    if (download.download.presigned_url) {
      await fetch(download.download.presigned_url, {
        method: download.download.method,
        headers: download.download.headers,
      });
    }
    setDownloadInstruction(download.download);
    setStatus(uiMessage("fileFlowPassed"));
  }

  async function handlePrepareOrphanCleanupDryRun() {
    const orphan = data.fileOrphans[0];
    if (!orphan || orphanCleanupPreviewing) return;

    setStatus(uiMessage("orphanPreparing"));
    setOrphanCleanupPreviewing(true);
    try {
      const preview = await files.createOrphanCleanupDryRun(orphan.public_id);
      setOrphanCleanupPreview(preview);
      setStatus(uiMessage("orphanPrepared"));
    } finally {
      setOrphanCleanupPreviewing(false);
    }
  }

  async function handleSendMessage() {
    const conversationId = selectedConversation?.public_id ?? data.conversations[0]?.public_id;
    const body = messageDraft.trim();
    if (!conversationId || (!body && pendingAttachments.length === 0)) return;

    setStatus(uiMessage("messageSending"));
    const uploadedAttachments = await Promise.all(
      pendingAttachments.map(async (attachment) => {
        if (attachment.file_public_id) {
          return {
            file_public_id: attachment.file_public_id,
            attachment_type: attachment.attachment_type,
          };
        }
        const file = await files.uploadBrowserFile(attachment.file);
        return {
          file_public_id: file.public_id,
          attachment_type: attachment.attachment_type,
        };
      }),
    );
    const message = await domain.createMessage(conversationId, {
      sender_type: "user",
      sender_name: user?.email ?? "Admin",
      body: body || null,
      external_message_id: null,
      raw_payload: null,
      attachments: uploadedAttachments,
    });
    setMessageDraft("");
    for (const attachment of pendingAttachments) {
      URL.revokeObjectURL(attachment.preview_url);
    }
    setPendingAttachments([]);
    setData((current) => ({
      ...current,
      messages: [
        ...current.messages.filter((item) => item.public_id !== message.public_id),
        message,
      ],
    }));
    await refreshConversations();
    await refreshMessages(conversationId);
    setStatus(uiMessage("messageSent"));
  }

  function handlePickMessageFiles(filesList: FileList | null) {
    const picked = Array.from(filesList ?? []).map((file) => ({
      file,
      attachment_type: attachmentTypeFromFile(file),
      preview_url: URL.createObjectURL(file),
    }));
    setPendingAttachments((current) => [...current, ...picked].slice(0, 10));
  }

  function handlePickShortcutFiles(filesList: FileList | null) {
    const picked = Array.from(filesList ?? []).map((file) => ({
      file,
      attachment_type: attachmentTypeFromFile(file),
      preview_url: URL.createObjectURL(file),
    }));
    setShortcutDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...picked].slice(0, 10),
    }));
  }

  async function handleSaveShortcut() {
    const code = shortcutDraft.code.trim();
    const message = shortcutDraft.message.trim();
    if (!code || (!message && shortcutDraft.attachments.length === 0)) return;

    setStatus(uiMessage("shortcutSaving"));
    const attachments = await Promise.all(
      shortcutDraft.attachments.map(async (attachment) => {
        if (attachment.file_public_id) {
          return {
            file_public_id: attachment.file_public_id,
            attachment_type: attachment.attachment_type,
          };
        }
        const file = await files.uploadBrowserFile(attachment.file);
        return {
          file_public_id: file.public_id,
          attachment_type: attachment.attachment_type,
        };
      }),
    );
    const shortcut = editingShortcutId
      ? await domain.updateMessageShortcut(editingShortcutId, {
          code,
          message: message || null,
          attachments,
        })
      : await domain.createMessageShortcut({
          code,
          message: message || null,
          type: "custom",
          attachments,
        });
    const shortcutWithLocalAttachmentNames = {
      ...shortcut,
      attachments: shortcut.attachments.map((attachment, index) => {
        const localAttachment = shortcutDraft.attachments[index];
        return {
          ...attachment,
          original_name: attachment.original_name ?? localAttachment?.file.name ?? null,
          mime_type: attachment.mime_type ?? localAttachment?.file.type ?? null,
          byte_size: attachment.byte_size ?? localAttachment?.file.size ?? null,
        };
      }),
    };
    for (const attachment of shortcutDraft.attachments) {
      URL.revokeObjectURL(attachment.preview_url);
    }
    setMessageShortcuts((current) => [
      shortcutWithLocalAttachmentNames,
      ...current.filter((item) => item.public_id !== shortcutWithLocalAttachmentNames.public_id),
    ].sort((first, second) => first.sort_order - second.sort_order || first.code.localeCompare(second.code, "tr")));
    setShortcutDraft({ code: "", message: "", attachments: [] });
    setEditingShortcutId(null);
    setStatus(uiMessage("shortcutSaved"));
  }

  async function handleDeleteShortcut(shortcutPublicId: string) {
    setStatus(uiMessage("shortcutDeleting"));
    await domain.deleteMessageShortcut(shortcutPublicId);
    setMessageShortcuts((current) => current.filter((shortcut) => shortcut.public_id !== shortcutPublicId));
    setStatus(uiMessage("shortcutDeleted"));
  }

  function handleUseShortcut(shortcut: MessageShortcutSummary) {
    setMessageDraft(shortcut.message ?? "");
    setPendingAttachments((current) => {
      for (const attachment of current) {
        URL.revokeObjectURL(attachment.preview_url);
      }
      return shortcut.attachments.map((attachment) => ({
        file: new File([], attachment.original_name ?? attachment.file_public_id, {
          type: attachment.mime_type ?? "application/octet-stream",
        }),
        file_public_id: attachment.file_public_id,
        attachment_type: attachment.attachment_type,
        preview_url: "",
      }));
    });
    setShortcutMenuOpen(false);
  }

  function handleEditShortcut(shortcut: MessageShortcutSummary) {
    setEditingShortcutId(shortcut.public_id);
    setShortcutDraft({
      code: shortcut.code,
      message: shortcut.message ?? "",
      attachments: shortcut.attachments.map((attachment) => ({
        file: new File([], attachment.original_name ?? attachment.file_public_id, {
          type: attachment.mime_type ?? "application/octet-stream",
        }),
        file_public_id: attachment.file_public_id,
        attachment_type: attachment.attachment_type,
        preview_url: "",
      })),
    });
  }

  async function handleDownloadShortcutAttachment(shortcut: MessageShortcutSummary) {
    const first = shortcut.attachments[0];
    if (!first) return;
    setStatus(uiMessage("shortcutMediaDownloading"));
    try {
      const response = await files.createDownload(first.file_public_id);
      if (response.download.presigned_url) {
        const link = document.createElement("a");
        link.href = response.download.presigned_url;
        link.download = first.original_name ?? `${shortcut.code}.${first.attachment_type}`;
        link.click();
      }
    } catch (error) {
      console.warn("[Messages] Shortcut download request failed", error);
    }
  }

  function handleConversationNoteChange(value: string) {
    setConversationNoteDraft(value);
    if (!selectedConversation?.public_id) return;
    if (conversationNoteSaveRef.current) {
      window.clearTimeout(conversationNoteSaveRef.current);
    }
    const conversationPublicId = selectedConversation.public_id;
    conversationNoteSaveRef.current = window.setTimeout(() => {
      void (async () => {
        const conversation = await domain.updateConversationNotes(conversationPublicId, value.trim() || null);
        setData((current) => ({
          ...current,
          conversations: current.conversations.map((item) =>
            item.public_id === conversation.public_id ? conversation : item
          ),
        }));
        setStatus(uiMessage("conversationNoteSaved"));
      })();
    }, 500);
  }

  function handleCustomerNoteChange(value: string) {
    setCustomerNoteDraft(value);
    if (!selectedConversation?.public_id) return;
    if (customerNoteSaveRef.current) {
      window.clearTimeout(customerNoteSaveRef.current);
    }
    const conversationPublicId = selectedConversation.public_id;
    customerNoteSaveRef.current = window.setTimeout(() => {
      void (async () => {
        const customer = await domain.updateCustomerNotes(conversationPublicId, value.trim() || null);
        setData((current) => ({
          ...current,
          customers: [
            customer,
            ...current.customers.filter((item) => item.public_id !== customer.public_id),
          ],
        }));
        setStatus(uiMessage("customerNoteSaved"));
      })();
    }, 500);
  }

  async function handleAiSuggestion() {
    const conversationId = selectedConversation?.public_id;
    if (!conversationId) return;
    setStatus(uiMessage("aiSuggestionPreparing"));
    const response = await domain.createAiReplySuggestion(conversationId);
    setAiSuggestion(response.suggestion);
    setStatus(uiMessage("aiSuggestionPrepared"));
  }

  async function handleUpdateConversationState(input: {
    status?: string;
    unread_count?: number;
    human_agent_enabled?: boolean;
    is_in_pool?: boolean;
    assign_to_me?: boolean;
  }) {
    const conversationId = selectedConversation?.public_id;
    if (!conversationId) return;

    setStatus(uiMessage("conversationStatusUpdating"));
    const conversation = await domain.updateConversationState(conversationId, input);
    setData((current) => ({
      ...current,
      conversations: current.conversations.map((item) =>
        item.public_id === conversation.public_id ? conversation : item
      ),
    }));
    setSelectedConversationId(conversation.public_id);
    selectedConversationIdRef.current = conversation.public_id;
    setStatus(uiMessage("conversationStatusUpdated"));
  }

  async function handleApplyConversationFilters(nextChannel: string, nextStatus: string) {
    const requestSeq = conversationFilterRequestSeqRef.current + 1;
    conversationFilterRequestSeqRef.current = requestSeq;
    setConversationChannelFilter(nextChannel);
    setConversationStatusFilter(nextStatus);
    setStatus(uiMessage("conversationFiltersApplying"));
    const filterParams: { channel?: string; status?: string; limit: number } = { limit: 20 };
    if (nextChannel !== "all") {
      filterParams.channel = nextChannel === "facebook" ? "facebook,messenger" : nextChannel;
    }
    if (nextStatus !== "all") {
      filterParams.status = nextStatus;
    }
    const conversations = await domain.listConversations(filterParams);
    if (conversationFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      conversations: conversations.data,
    }));
    setSelectedConversationId(conversations.data[0]?.public_id ?? null);
    selectedConversationIdRef.current = conversations.data[0]?.public_id ?? null;
    if (conversations.data[0]) {
      await refreshMessages(conversations.data[0].public_id);
      if (conversationFilterRequestSeqRef.current !== requestSeq) return;
    } else {
      setData((current) => ({ ...current, messages: [] }));
    }
    setStatus(uiMessage("conversationFiltersApplied"));
  }

  function orderListParams(overrides: Partial<{
    status: string;
    confirmation_status: string;
    search: string;
    source: string;
    cargo_provider: string;
    created_by_user_public_id: string;
    created_from: string;
    created_to: string;
    sort_by: OrderSortBy;
    sort_direction: SortDirection;
    page: number;
    limit: number;
  }> = {}) {
    const status = overrides.status ?? orderStatusFilter;
    const source = overrides.source ?? orderSourceFilter;
    const cargoProvider = overrides.cargo_provider ?? orderCargoFilter;
    const personnel = overrides.created_by_user_public_id ?? orderPersonnelFilter;
    const search = overrides.search ?? orderSearch;
    const createdFrom = overrides.created_from ?? orderCreatedFrom;
    const createdTo = overrides.created_to ?? orderCreatedTo;
    const sortBy = overrides.sort_by ?? orderSortBy;
    const sortDirection = overrides.sort_direction ?? orderSortDirection;
    const page = overrides.page ?? orderPage;
    const limit = overrides.limit ?? 20;
    const params: Parameters<typeof domain.listOrders>[0] = {
      limit,
      offset: page * limit,
      sort_by: sortBy,
      sort_direction: sortDirection,
    };
    if (status !== "all") params.status = status;
    if (overrides.confirmation_status) params.confirmation_status = overrides.confirmation_status;
    if (source !== "all") params.source = source;
    if (cargoProvider !== "all") params.cargo_provider = cargoProvider;
    if (personnel !== "all") params.created_by_user_public_id = personnel;
    if (search.trim()) params.search = search.trim();
    if (createdFrom) params.created_from = createdFrom;
    if (createdTo) params.created_to = createdTo;
    return params;
  }

  async function refreshOrders(overrides: Parameters<typeof orderListParams>[0] = {}) {
    await refreshOrdersWithParams(orderListParams(overrides));
  }

  async function refreshOrdersWithParams(params: Parameters<typeof domain.listOrders>[0]) {
    const requestSeq = orderFilterRequestSeqRef.current + 1;
    orderFilterRequestSeqRef.current = requestSeq;
    setStatus(uiMessage("orderFiltersApplying"));
    const orders = await domain.listOrders(params);
    if (orderFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      orders: orders.data,
    }));
    setOrderTotalCount(orders.meta?.total_count ?? orders.data.length);
    setSelectedOrderId(orders.data[0]?.public_id ?? null);
    setSelectedOrderIds(new Set());
    setStatus(uiMessage("orderFiltersApplied"));
  }

  async function handleApplyOrderFilter(nextFilter: string) {
    setOrderFilter(nextFilter);
    setOrderPage(0);
    setOrderStatusFilter("all");
    let params: Parameters<typeof domain.listOrders>[0] = { limit: 20 };
    if (nextFilter === "active") {
      setOrderStatusFilter("active");
      params = { status: "active", limit: 20 };
    }
    if (nextFilter === "pending_confirmation") {
      params = { confirmation_status: "pending", limit: 20 };
    }
    if (nextFilter === "delivered") {
      setOrderStatusFilter("delivered");
      params = { status: "delivered", limit: 20 };
    }
    await refreshOrdersWithParams(params);
  }

  async function handleApplyOrderAdvancedFilters() {
    setOrderFilter("custom");
    setOrderPage(0);
    await refreshOrders({ page: 0, confirmation_status: "" });
  }

  async function handleOrderPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    setOrderPage(boundedPage);
    await refreshOrders({ page: boundedPage, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" });
  }

  async function handleOrderSort(nextSortBy: OrderSortBy) {
    const nextDirection: SortDirection = orderSortBy === nextSortBy && orderSortDirection === "desc" ? "asc" : "desc";
    setOrderSortBy(nextSortBy);
    setOrderSortDirection(nextDirection);
    setOrderPage(0);
    await refreshOrders({
      page: 0,
      sort_by: nextSortBy,
      sort_direction: nextDirection,
      confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "",
    });
  }

  async function handleApplyShipmentFilter(nextFilter: ShipmentFilter) {
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentFilter(nextFilter);
    setShipmentPage(0);
    setStatus(uiMessage("shipmentFiltersApplying"));
    const trimmedSearch = shipmentSearch.trim();
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: 0,
    });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentFiltersApplied"));
  }

  async function handleSearchShipments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(0);
    setStatus(uiMessage("shipmentSearchApplying"));
    const shipments = await refreshShipments({ page: 0 });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentSearchApplied"));
  }

  async function handleShipmentPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(boundedPage);
    setStatus(uiMessage("shipmentPageLoading"));
    const shipments = await refreshShipments({ page: boundedPage });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentPageLoaded"));
  }

  async function handleOpenShipmentDetail(shipmentPublicId: string) {
    setSelectedShipmentId(shipmentPublicId);
    setStatus(uiMessage("shipmentDetailLoading"));
    try {
      const shipment = await domain.getShipment(shipmentPublicId);
      setData((current) => ({
        ...current,
        shipments: current.shipments.map((item) => (item.public_id === shipment.public_id ? shipment : item)),
      }));
      setStatus(uiMessage("shipmentDetailLoaded"));
    } catch {
      setStatus(uiMessage("shipmentDetailFromList"));
    }
  }

  function handleApplyShipmentPipelineFilter(nextFilter: ShipmentPipelineFilter) {
    setShipmentPipelineFilter(nextFilter);
    setStatus(uiMessage("pipelineTabApplied"));
  }

  async function handleSelectConversation(conversationPublicId: string) {
    selectedConversationIdRef.current = conversationPublicId;
    setSelectedConversationId(conversationPublicId);
    setStatus(uiMessage("conversationMessagesLoading"));
    await refreshMessages(conversationPublicId);
    setStatus(uiMessage("conversationLoaded"));
  }

  function openOrderForm(source: "orders" | "conversation" = "orders") {
    const conversation = source === "conversation" ? selectedConversation : null;
    setOrderForm({
      ...defaultOrderForm(data.products),
      customer_name: conversation?.customer?.full_name ?? "",
      customer_phone: conversation?.customer?.phone ?? "",
      conversation_public_id: conversation?.public_id ?? null,
      notes: source === "conversation" ? "Konuşmadan oluşturuldu" : "",
    });
    setOrderFormMessage(null);
    setOrderFormOpen(true);
  }

  function updateOrderFormItem(index: number, patch: Partial<OrderFormItem>) {
    setOrderForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
      force_duplicate: false,
      force_surat_at: false,
    }));
  }

  function selectOrderFormProduct(index: number, productPublicId: string) {
    const product = data.products.find((item) => item.public_id === productPublicId);
    updateOrderFormItem(index, {
      product_public_id: productPublicId,
      name: product?.name ?? "",
      unit_price: product?.unit_price ?? "0.00",
      external_product_id: product?.external_product_id ?? null,
    });
  }

  function addOrderFormItem() {
    setOrderForm((current) => ({
      ...current,
      items: [...current.items, { product_public_id: "", name: "", quantity: 1, unit_price: "0.00", external_product_id: null }],
    }));
  }

  function removeOrderFormItem(index: number) {
    setOrderForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function lookupOrderCustomerByPhone() {
    const phone = orderForm.customer_phone.trim();
    if (phone.replace(/\D/g, "").length < 10) return;
    const lookup = await domain.lookupCustomerByPhone(phone);
    if (!lookup.customer) return;
    setOrderForm((current) => ({
      ...current,
      customer_public_id: lookup.customer?.public_id ?? current.customer_public_id,
      customer_name: lookup.customer?.full_name ?? current.customer_name,
      customer_phone: lookup.customer?.phone ?? current.customer_phone,
      address_line: lookup.default_address?.address_line ?? current.address_line,
      city: lookup.default_address?.city ?? current.city,
      district: lookup.default_address?.district ?? current.district,
      country: lookup.default_address?.country ?? current.country,
    }));
    setOrderFormMessage(uiMessage("customerFoundByPhone"));
  }

  async function handleSubmitOrderForm() {
    const validationKey: StatusKey | null = !orderForm.customer_name.trim() ? "customerNameRequired"
      : !orderForm.customer_phone.trim() ? "customerPhoneRequired"
      : !orderForm.city.trim() ? "cityRequired"
      : !orderForm.district.trim() ? "districtRequired"
      : !orderForm.address_line.trim() ? "addressRequired"
      : !orderForm.cargo_provider ? "cargoProviderRequired"
      : null;
    const validationError = validationKey ? uiMessage(validationKey) : null;
    if (validationError) {
      setOrderFormMessage(validationError);
      setStatus(validationError);
      return;
    }
    if (orderFormTotals(orderForm.items).genelToplam <= 0) {
      setOrderFormMessage(uiMessage("orderZeroTotal"));
      setStatus(uiMessage("orderZeroTotal"));
      return;
    }
    if (!orderForm.items.some((item) => item.name.trim())) {
      setOrderFormMessage(uiMessage("productRequired"));
      setStatus(uiMessage("productRequired"));
      return;
    }

    setOrderFormSubmitting(true);
    setStatus(uiMessage("orderCreating"));
    try {
      const order = await domain.createOrder({
        customer_public_id: orderForm.customer_public_id,
        customer: {
          full_name: orderForm.customer_name.trim(),
          phone: orderForm.customer_phone.trim(),
        },
        address: {
          address_line: orderForm.address_line.trim(),
          city: orderForm.city.trim(),
          district: orderForm.district.trim(),
          country: orderForm.country.trim() || "Türkiye",
        },
        conversation_public_id: orderForm.conversation_public_id,
        status: "draft",
        source: orderForm.conversation_public_id ? "conversation" : "manual",
        cargo_provider: orderForm.cargo_provider as OrderCargoProvider,
        notes: orderForm.notes.trim() || null,
        currency: "TRY",
        force_duplicate: orderForm.force_duplicate,
        force_surat_at: orderForm.force_surat_at,
        items: orderForm.items
          .filter((item) => item.name.trim())
          .map((item) => ({
            product_public_id: item.product_public_id || null,
            name: item.name.trim(),
            quantity: Math.max(Number(item.quantity) || 1, 1),
            unit_price: parseMoneyInput(item.unit_price).toFixed(2),
            external_product_id: item.external_product_id,
          })),
      });
      setData((current) => ({
        ...current,
        orders: [order, ...current.orders],
      }));
      setSelectedOrderId(order.public_id);
      setOrderFormOpen(false);
      setOrderFormMessage(null);
      setStatus(uiMessage("orderCreated", { orderNumber: order.order_number }));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 409 && isRecord(error.body)) {
        const bodyError = isRecord(error.body.error) ? error.body.error : null;
        const code = typeof bodyError?.code === "string" ? bodyError.code : "";
        const message = typeof bodyError?.message === "string" ? rawMessage(bodyError.message) : uiMessage("orderCreateWarning");
        setOrderFormMessage(message);
        setStatus(message);
        if (code === "duplicate_phone_warning" || code === "duplicate_name_warning") {
          setOrderForm((current) => ({ ...current, force_duplicate: true }));
        }
        if (code === "surat_at_warning") {
          setOrderForm((current) => ({ ...current, force_surat_at: true }));
        }
        return;
      }
      setOrderFormMessage(error instanceof Error ? uiMessage("orderCreateFailedWith", { message: error.message }) : uiMessage("orderCreateFailed"));
      setStatus(uiMessage("orderCreateFailed"));
    } finally {
      setOrderFormSubmitting(false);
    }
  }

  function toggleOrderSelection(orderPublicId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderPublicId)) next.delete(orderPublicId);
      else next.add(orderPublicId);
      return next;
    });
  }

  function toggleAllVisibleOrders() {
    setSelectedOrderIds((current) => {
      const visibleIds = data.orders.map((order) => order.public_id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      if (allSelected) return new Set([...current].filter((id) => !visibleIds.includes(id)));
      return new Set([...current, ...visibleIds]);
    });
  }

  function downloadOrderExcel(rows: OrderSummary[], format: "liste" | "telefon") {
    const headers = format === "telefon"
      ? ["İsim", "Telefon"]
      : ["Sipariş No", "Müşteri", "Durum", "Kaynak", "Kargo", "Personel", "Tutar", "Tarih"];
    const bodyRows = rows.map((order) => format === "telefon"
      ? [order.customer_full_name ?? order.order_number, ""]
      : [
          order.order_number,
          order.customer_full_name ?? "",
          orderStatusLabel(order.status),
          order.source,
          cargoProviderLabel(order.cargo_provider),
          order.created_by_user_email ?? "",
          `${order.total_amount} ${order.currency}`,
          new Date(order.created_at).toLocaleDateString("tr-TR"),
        ]);
    const escapeCell = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const tableRows = [headers, ...bodyRows]
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(String(cell))}</td>`).join("")}</tr>`)
      .join("");
    const blob = new Blob(
      [`<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `siparisler-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportOrders(scope: "current" | "selected" | "all") {
    const selectedRows = data.orders.filter((order) => selectedOrderIds.has(order.public_id));
    if (scope === "selected") {
      downloadOrderExcel(selectedRows, "liste");
      setStatus(uiMessage("ordersExportedSelected", { count: selectedRows.length }));
      return;
    }
    if (scope === "current") {
      downloadOrderExcel(data.orders, "liste");
      setStatus(uiMessage("ordersExportedVisible", { count: data.orders.length }));
      return;
    }
    const orders = await domain.listOrders(orderListParams({ page: 0, limit: 200, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" }));
    downloadOrderExcel(orders.data, "liste");
    setStatus(uiMessage("ordersExportedFiltered", { count: orders.data.length }));
  }

  async function handleCancelSelectedOrder() {
    const order = selectedOrder;
    if (!order) return;

    setStatus(uiMessage("cancellationUpdating"));
    const updated = await domain.updateOrderStatus(order.public_id, {
      status: "cancelled",
      notes: "Frontend iptal inceleme onayi",
    });
    setData((current) => ({
      ...current,
      orders: current.orders.map((item) => (item.public_id === updated.public_id ? updated : item)),
    }));
    setSelectedOrderId(updated.public_id);
    setStatus(uiMessage("cancellationUpdated"));
  }

  async function handleUpdateShipment() {
    const shipment = selectedShipment;
    if (!shipment) return;

    setStatus(uiMessage("shipmentStatusUpdating"));
    const updated = await domain.updateShipmentStatus(shipment.public_id, {
      status: "delivered",
      last_event_text: "Frontend teslim kaniti",
      raw_payload: null,
    });
    const shipmentPipeline = await domain.getShipmentPipelineSummary();
    if (shipmentFilter !== "all") {
      const trimmedSearch = shipmentSearch.trim();
      const shipments = await domain.listShipments({
        ...shipmentFilterParams(shipmentFilter),
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
        limit: shipmentPageSize,
        offset: shipmentPage * shipmentPageSize,
      });
      const updatedStillVisible = shipmentMatchesFilter(updated, shipmentFilter);
      const refreshedRows = updatedStillVisible
        ? [updated, ...shipments.data.filter((item) => item.public_id !== updated.public_id)]
        : shipments.data;
      setData((current) => ({
        ...current,
        shipments: refreshedRows,
        shipmentPipeline,
      }));
      setShipmentTotalCount(shipments.meta?.total_count ?? refreshedRows.length);
      setSelectedShipmentId(updatedStillVisible ? updated.public_id : refreshedRows[0]?.public_id ?? null);
      setStatus(uiMessage("shipmentStatusUpdated"));
      return;
    }
    setData((current) => ({
      ...current,
      shipments: current.shipments.map((item) => (item.public_id === updated.public_id ? updated : item)),
      shipmentPipeline,
    }));
    setSelectedShipmentId(updated.public_id);
    setStatus(uiMessage("shipmentStatusUpdated"));
  }

  async function handleTrackShipment(shipment: ShipmentSummary) {
    if (trackingShipmentId) return;

    setStatus(uiMessage("trackingQueueing"));
    setTrackingShipmentId(shipment.public_id);
    try {
      const result = await domain.trackShipment(shipment.public_id, {
        idempotency_key: `track_${shipment.public_id}_${Date.now()}`,
      });
      setLastShipmentTrack(`${result.provider} ${result.operation} ${result.queued ? "queued" : "dry-run"} ${result.request_id}`);
      setStatus(uiMessage("trackingQueued", { gate: result.live_gate }));
    } finally {
      setTrackingShipmentId(null);
    }
  }

  async function handleSaveProviderLiveGate() {
    setStatus(uiMessage("liveGateSaving"));
    const setting = await admin.upsertSetting("providers.ptt.live_mode", false, false, "global");
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("liveGateSaved"));
  }

  async function handleSaveSipConfig() {
    const setting = await admin.upsertSetting(
      "sip_config",
      {
        ws_url: sipServerSettings.ws_url,
        domain: sipServerSettings.domain,
        stun: sipServerSettings.stun,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("sipSaved"));
  }

  async function handleSaveOperationalPolicy() {
    setStatus(uiMessage("policySaving"));
    const setting = await admin.upsertSetting(
      "operations.policy",
      {
        max_attempts: 5,
        retry_delay_ms: 45000,
        request_timeout_ms: 12000,
        webhook_timeout_ms: 6000,
        provider_rate_limit_per_minute: 90,
        queue_concurrency: 6,
        storage_bucket: "garage-media",
        lifecycle_days: 120,
        orphan_cleanup_enabled: true,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("policySaved"));
  }

  async function handleUpsertIntegrationAccount() {
    setStatus(uiMessage("integrationAccountSaving"));
    const account = await admin.upsertIntegrationAccount({
      provider_key: "instagram",
      display_name: "Instagram Playwright",
      external_account_id: "ig_playwright",
      metadata: { source: "frontend" },
    });
    setData((current) => ({
      ...current,
      integrationAccounts: [
        account,
        ...current.integrationAccounts.filter((item) => item.public_id !== account.public_id),
      ],
    }));
    setStatus(uiMessage("integrationAccountSaved"));
  }

  async function handleOpenIntegrationAccount(accountPublicId: string) {
    setStatus(uiMessage("integrationAccountLoading"));
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationAccountLoaded"));
  }

  async function handleCreateInstagramPublishPreview() {
    if (instagramPublishPreviewing) return;

    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id ?? null;
    setStatus(uiMessage("instagramPreviewPreparing"));
    setInstagramPublishPreviewing(true);
    try {
      const attempt = await admin.createInstagramPublishPreview({
        account_public_id: accountPublicId,
        image_url: instagramDraftImageUrl,
        caption: instagramDraftCaption,
        idempotency_key: `instagram_publish_${accountPublicId ?? "preview"}`,
      });
      setData((current) => ({
        ...current,
        providerAttempts: [
          toProviderAttemptViewModel(attempt),
          ...current.providerAttempts.filter((item) => item.public_id !== attempt.public_id),
        ],
      }));
      setLastInstagramPublishPreview(`${attempt.operation} ${attempt.request_id}`);
      setStatus(uiMessage("instagramPreviewSaved"));
    } finally {
      setInstagramPublishPreviewing(false);
    }
  }

  async function handleSaveIntegrationToken() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus(uiMessage("integrationTokenSaving"));
    await admin.upsertIntegrationToken(accountPublicId, "access_token", {
      secret: "frontend-playwright-token",
      source: "admin-ui",
    });
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationTokenSaved"));
  }

  async function handleSaveIntegrationSetting() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus(uiMessage("integrationSettingSaving"));
    await admin.upsertIntegrationSetting(accountPublicId, "webhook.enabled", true, false);
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationSettingSaved"));
  }

  async function handleTogglePresence() {
    if (!user || user.role === "admin") return;

    const nextPresence = !user.is_online;
    setPresenceUpdating(true);
    setStatus(uiMessage(nextPresence ? "presenceGoingOnline" : "presenceGoingOffline"));
    try {
      const updatedUser = await auth.setPresence(nextPresence);
      setUser(updatedUser);
      setStatus(uiMessage(updatedUser.is_online ? "presenceOnlineUpdated" : "presenceOfflineUpdated"));
    } finally {
      setPresenceUpdating(false);
    }
  }

  const activeSettings = data.settings.filter((setting) => !setting.is_secret);
  const visibleNavigation = navigationItems.filter((item) => item.roles.includes(navigationRole(user?.role)));
  const requestedFlow = flowFromPath(location.pathname);
  const activeFlow = visibleNavigation.some((item) => item.key === requestedFlow)
    ? requestedFlow
    : visibleNavigation[0]?.key ?? "inbox";
  const canTogglePresence = Boolean(user && navigationRole(user.role) !== "admin");
  const sipServerSettings = sipServerSettingsFrom(activeSettings, data.webphone);
  const operationalPolicy = operationalPolicyFrom(activeSettings);
  const selectedCustomer = data.customers[0] ?? null;
  const selectedOrder = data.orders.find((order) => order.public_id === selectedOrderId) ?? data.orders[0] ?? null;
  const selectedShipment = data.shipments.find((shipment) => shipment.public_id === selectedShipmentId) ?? data.shipments[0] ?? null;
  const visibleOrderIds = data.orders.map((order) => order.public_id);
  const allVisibleOrdersSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedOrderIds.has(id));
  const orderPageCount = Math.max(1, Math.ceil(orderTotalCount / 20));
  const shipmentPageCount = Math.max(1, Math.ceil(shipmentTotalCount / shipmentPageSize));
  const shipmentOffsetStart = shipmentTotalCount === 0 ? 0 : shipmentPage * shipmentPageSize + 1;
  const shipmentOffsetEnd = Math.min((shipmentPage + 1) * shipmentPageSize, shipmentTotalCount);
  const orderSources = [...new Set(data.orders.map((order) => order.source).filter(Boolean))].sort();
  const orderPersonnel = [...new Map(data.orders
    .filter((order) => order.created_by_user_public_id && order.created_by_user_email)
    .map((order) => [order.created_by_user_public_id as string, order.created_by_user_email as string])).entries()];
  const unreadConversationCount = data.conversationSummary.unread_count;
  const poolConversationCount = data.conversationSummary.pool_count;
  const humanAgentConversationCount = data.conversationSummary.human_agent_count;
  const instagramConversationCount = data.conversationSummary.channel_counts.instagram;
  const facebookConversationCount = data.conversationSummary.channel_counts.facebook;
  const openConversationCount = data.conversationSummary.status_counts.open;
  const closedConversationCount = data.conversationSummary.status_counts.closed;
  const conversationMatchesChannelFilter = (conversation: ConversationSummary, filter: string) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "facebook") {
      return conversation.channel === "facebook" || conversation.channel === "messenger";
    }
    return conversation.channel === filter;
  };
  const visibleConversations = data.conversations.filter((conversation) => {
    const channelMatches = conversationMatchesChannelFilter(conversation, conversationChannelFilter);
    const statusMatches = conversationStatusFilter === "all" || conversation.status === conversationStatusFilter;
    const normalizedSearch = conversationSearch.trim().toLocaleLowerCase("tr-TR");
    const searchMatches =
      !normalizedSearch ||
      [
        conversation.customer?.full_name,
        conversation.customer?.phone,
        conversation.last_message_text,
        conversation.channel,
        conversation.assigned_user_email,
      ].some((value) => value?.toLocaleLowerCase("tr-TR").includes(normalizedSearch));
    return channelMatches && statusMatches && searchMatches;
  });
  const selectedConversation =
    visibleConversations.find((conversation) => conversation.public_id === selectedConversationId) ?? visibleConversations[0] ?? null;
  const selectedConversationCustomer =
    data.customers.find((customer) =>
      customer.phone && customer.phone === selectedConversation?.customer?.phone
    ) ??
    data.customers.find((customer) =>
      customer.full_name === selectedConversation?.customer?.full_name
    ) ??
    null;

  useEffect(() => {
    setConversationNoteDraft(selectedConversation?.notes ?? "");
    setCustomerNoteDraft(selectedConversationCustomer?.notes ?? "");
    setAiSuggestion(null);
  }, [selectedConversation?.public_id, selectedConversation?.notes, selectedConversationCustomer?.notes]);

  useEffect(() => () => {
    for (const attachment of pendingAttachments) {
      if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url);
    }
    for (const attachment of shortcutDraft.attachments) {
      if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url);
    }
  }, [pendingAttachments, shortcutDraft.attachments]);

  const conversationChannelFilters = [
    { value: "all", label: `Tüm kanallar ${data.conversationSummary.total_count}` },
    { value: "instagram", label: `Instagram ${instagramConversationCount}` },
    { value: "facebook", label: `Facebook ${facebookConversationCount}` },
  ];
  const conversationStatusFilters = [
    { value: "all", label: "Tüm durumlar" },
    { value: "open", label: `Açık ${openConversationCount}` },
    { value: "closed", label: `Kapalı ${closedConversationCount}` },
  ];
  const instagramAnalytics = toInstagramAnalyticsView(data.instagramAnalytics);
  const selectedProviderAttempt = data.providerAttempts[0] ?? null;
  const selectedProviderPreview = selectedProviderAttempt?.provider_request_preview ?? null;
  const selectedProviderCatalogItem = data.providerCatalog[0] ?? null;
  const currentOrderFormTotals = orderFormTotals(orderForm.items);
  const providerAttemptTotal = data.providerDebugSummary.providers.reduce(
    (total, summary) => total + summary.total_attempts,
    0,
  );
  const pttProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "ptt");
  const latestSettingsAudit = data.settingsAudit[0] ?? null;
  const latestIntegrationAudit = data.integrationAudit[0] ?? null;
  const deliveredShipmentCount = data.shipmentSummary.delivered_count;
  const activeShipmentCount = data.shipmentSummary.active_count;
  const pttShipmentCount = data.shipmentSummary.provider_counts.ptt;
  const suratShipmentCount = data.shipmentSummary.provider_counts.surat;
  const pttNotDeliveredCount = data.shipmentSummary.exception_counts.ptt_not_delivered;
  const suratNotDeliveredCount = data.shipmentSummary.exception_counts.surat_not_delivered;
  const trackingMissingCount = data.shipmentSummary.exception_counts.tracking_missing;
  const otherShipmentCount = data.shipmentSummary.provider_counts.other;
  const visibleShipmentPipelineRows = data.shipmentPipeline.rows.filter(
    (row) => shipmentPipelineFilter === "all" || row.step === shipmentPipelineFilter,
  );
  const pipelineMessageCount = data.shipmentPipeline.counts.mesaj;
  const pipelineSmsCount = data.shipmentPipeline.counts.sms;
  const pipelineVapiCount = data.shipmentPipeline.counts.vapi;
  const pipelineWaitingCount = data.shipmentPipeline.counts.bekliyor;
  const pipelineProcessingCount = data.shipmentPipeline.counts.isleniyor;
  const pipelineErrorCount = data.shipmentPipeline.counts.hata;
  const pipelineDeliveredCount = data.shipmentPipeline.counts.teslim;
  const shipmentPipelineFilters: Array<{ value: ShipmentPipelineFilter; label: string; count: number }> = [
    { value: "all", label: "Tümü", count: data.shipmentPipeline.counts.all },
    { value: "mesaj", label: "Mesaj", count: pipelineMessageCount },
    { value: "sms", label: "SMS", count: pipelineSmsCount },
    { value: "vapi", label: "VAPI", count: pipelineVapiCount },
    { value: "teslim", label: "Teslim", count: pipelineDeliveredCount },
  ];
  const customerWithPhoneCount = data.customerSummary.with_phone_count;
  const customerWithEmailCount = data.customerSummary.with_email_count;
  const customerWithNotesCount = data.customerSummary.with_notes_count;
  const messageAttachments = data.messages.flatMap((message) => message.attachments ?? []);

  return {
    location,
    publicPage,
    token,
    setToken,
    user,
    setUser,
    authChecked,
    setAuthChecked,
    data,
    setData,
    status,
    setStatus,
    uploadedFile,
    setUploadedFile,
    downloadInstruction,
    setDownloadInstruction,
    orphanCleanupPreview,
    setOrphanCleanupPreview,
    lastInstagramPublishPreview,
    setLastInstagramPublishPreview,
    instagramPublishPreviewing,
    setInstagramPublishPreviewing,
    orphanCleanupPreviewing,
    setOrphanCleanupPreviewing,
    presenceUpdating,
    setPresenceUpdating,
    integrationSnapshot,
    setIntegrationSnapshot,
    selectedConversationId,
    setSelectedConversationId,
    selectedOrderId,
    setSelectedOrderId,
    selectedShipmentId,
    setSelectedShipmentId,
    conversationChannelFilter,
    setConversationChannelFilter,
    conversationStatusFilter,
    setConversationStatusFilter,
    conversationSearch,
    setConversationSearch,
    messageDraft,
    setMessageDraft,
    pendingAttachments,
    setPendingAttachments,
    messageShortcuts,
    setMessageShortcuts,
    shortcutMenuOpen,
    setShortcutMenuOpen,
    shortcutDraft,
    setShortcutDraft,
    editingShortcutId,
    setEditingShortcutId,
    conversationNoteDraft,
    setConversationNoteDraft,
    customerNoteDraft,
    setCustomerNoteDraft,
    aiSuggestion,
    setAiSuggestion,
    orderFilter,
    setOrderFilter,
    orderSearch,
    setOrderSearch,
    orderStatusFilter,
    setOrderStatusFilter,
    orderSourceFilter,
    setOrderSourceFilter,
    orderCargoFilter,
    setOrderCargoFilter,
    orderPersonnelFilter,
    setOrderPersonnelFilter,
    orderCreatedFrom,
    setOrderCreatedFrom,
    orderCreatedTo,
    setOrderCreatedTo,
    orderSortBy,
    setOrderSortBy,
    orderSortDirection,
    setOrderSortDirection,
    orderPage,
    setOrderPage,
    orderTotalCount,
    setOrderTotalCount,
    selectedOrderIds,
    setSelectedOrderIds,
    printShipmentId,
    setPrintShipmentId,
    orderFormOpen,
    setOrderFormOpen,
    orderFormSubmitting,
    setOrderFormSubmitting,
    orderFormMessage,
    setOrderFormMessage,
    orderForm,
    setOrderForm,
    shipmentFilter,
    setShipmentFilter,
    shipmentSearch,
    setShipmentSearch,
    shipmentPage,
    setShipmentPage,
    shipmentTotalCount,
    setShipmentTotalCount,
    trackingShipmentId,
    setTrackingShipmentId,
    lastShipmentTrack,
    setLastShipmentTrack,
    shipmentPipelineFilter,
    setShipmentPipelineFilter,
    realtimeClient,
    setRealtimeClient,
    selectedConversationIdRef,
    mediaInputRef,
    pdfInputRef,
    shortcutMediaInputRef,
    conversationNoteSaveRef,
    customerNoteSaveRef,
    conversationFilterRequestSeqRef,
    orderFilterRequestSeqRef,
    shipmentFilterRequestSeqRef,
    dashboardLoadKeyRef,
    http,
    auth,
    domain,
    admin,
    files,
    webphone,
    refreshConversations,
    refreshMessages,
    refreshShipments,
    loadDashboard,
    handleLogin,
    handleLogout,
    handleUpload,
    handlePrepareOrphanCleanupDryRun,
    handleSendMessage,
    handlePickMessageFiles,
    handlePickShortcutFiles,
    handleSaveShortcut,
    handleDeleteShortcut,
    handleUseShortcut,
    handleEditShortcut,
    handleDownloadShortcutAttachment,
    handleConversationNoteChange,
    handleCustomerNoteChange,
    handleAiSuggestion,
    handleUpdateConversationState,
    handleApplyConversationFilters,
    orderListParams,
    refreshOrders,
    refreshOrdersWithParams,
    handleApplyOrderFilter,
    handleApplyOrderAdvancedFilters,
    handleOrderPage,
    handleOrderSort,
    handleApplyShipmentFilter,
    handleSearchShipments,
    handleShipmentPage,
    handleOpenShipmentDetail,
    handleApplyShipmentPipelineFilter,
    handleSelectConversation,
    openOrderForm,
    updateOrderFormItem,
    selectOrderFormProduct,
    addOrderFormItem,
    removeOrderFormItem,
    lookupOrderCustomerByPhone,
    handleSubmitOrderForm,
    toggleOrderSelection,
    toggleAllVisibleOrders,
    downloadOrderExcel,
    handleExportOrders,
    handleCancelSelectedOrder,
    handleUpdateShipment,
    handleTrackShipment,
    handleSaveProviderLiveGate,
    handleSaveSipConfig,
    handleSaveOperationalPolicy,
    handleUpsertIntegrationAccount,
    handleOpenIntegrationAccount,
    handleCreateInstagramPublishPreview,
    handleSaveIntegrationToken,
    handleSaveIntegrationSetting,
    handleTogglePresence,
    notifications,
    activeSettings,
    visibleNavigation,
    requestedFlow,
    activeFlow,
    canTogglePresence,
    sipServerSettings,
    operationalPolicy,
    selectedCustomer,
    selectedOrder,
    selectedShipment,
    visibleOrderIds,
    allVisibleOrdersSelected,
    orderPageCount,
    shipmentPageCount,
    shipmentOffsetStart,
    shipmentOffsetEnd,
    orderSources,
    orderPersonnel,
    unreadConversationCount,
    poolConversationCount,
    humanAgentConversationCount,
    instagramConversationCount,
    facebookConversationCount,
    openConversationCount,
    closedConversationCount,
    conversationMatchesChannelFilter,
    visibleConversations,
    selectedConversation,
    selectedConversationCustomer,
    conversationChannelFilters,
    conversationStatusFilters,
    instagramAnalytics,
    selectedProviderAttempt,
    selectedProviderPreview,
    selectedProviderCatalogItem,
    currentOrderFormTotals,
    providerAttemptTotal,
    pttProviderAttempts,
    latestSettingsAudit,
    latestIntegrationAudit,
    deliveredShipmentCount,
    activeShipmentCount,
    pttShipmentCount,
    suratShipmentCount,
    pttNotDeliveredCount,
    suratNotDeliveredCount,
    trackingMissingCount,
    otherShipmentCount,
    visibleShipmentPipelineRows,
    pipelineMessageCount,
    pipelineSmsCount,
    pipelineVapiCount,
    pipelineWaitingCount,
    pipelineProcessingCount,
    pipelineErrorCount,
    pipelineDeliveredCount,
    shipmentPipelineFilters,
    customerWithPhoneCount,
    customerWithEmailCount,
    customerWithNotesCount,
    messageAttachments,
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;
