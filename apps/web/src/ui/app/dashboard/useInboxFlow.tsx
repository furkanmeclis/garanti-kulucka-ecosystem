import { useCallback, useEffect, useRef, useState } from "react";
import { type ConversationSummary, type MessageShortcutSummary } from "../../../api/domain-client.js";
import { type PendingAttachment, type ShortcutDraft, attachmentTypeFromFile } from "../shared.js";
import { uiMessage } from "../../i18n/messages/status.js";
import type { DashboardCore } from "./types.js";

/** Messages flow: conversations, messages, shortcuts, notes, AI suggestion and conversation filters. */
export function useInboxFlow(core: DashboardCore) {
  const { user, domain, files, data, setData, setStatus } = core;
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
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
  const selectedConversationIdRef = useRef<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutMediaInputRef = useRef<HTMLInputElement | null>(null);
  const conversationNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const customerNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const conversationFilterRequestSeqRef = useRef(0);

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

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

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

  async function handleSelectConversation(conversationPublicId: string) {
    selectedConversationIdRef.current = conversationPublicId;
    setSelectedConversationId(conversationPublicId);
    setStatus(uiMessage("conversationMessagesLoading"));
    await refreshMessages(conversationPublicId);
    setStatus(uiMessage("conversationLoaded"));
  }

  const selectedCustomer = data.customers[0] ?? null;
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
    { value: "all", label: uiMessage("filterChannelAll", { count: data.conversationSummary.total_count }) },
    { value: "instagram", label: uiMessage("filterChannelInstagram", { count: instagramConversationCount }) },
    { value: "facebook", label: uiMessage("filterChannelFacebook", { count: facebookConversationCount }) },
  ];
  const conversationStatusFilters = [
    { value: "all", label: uiMessage("filterStatusAll") },
    { value: "open", label: uiMessage("filterStatusOpen", { count: openConversationCount }) },
    { value: "closed", label: uiMessage("filterStatusClosed", { count: closedConversationCount }) },
  ];
  const customerWithPhoneCount = data.customerSummary.with_phone_count;
  const customerWithEmailCount = data.customerSummary.with_email_count;
  const customerWithNotesCount = data.customerSummary.with_notes_count;
  const messageAttachments = data.messages.flatMap((message) => message.attachments ?? []);

  /** Inbox part of the logout reset. */
  function resetInbox() {
    setSelectedConversationId(null);
    setMessageShortcuts([]);
    setPendingAttachments([]);
    setShortcutMenuOpen(false);
    setShortcutDraft({ code: "", message: "", attachments: [] });
    setEditingShortcutId(null);
    setAiSuggestion(null);
  }

  return {
    selectedConversationId,
    setSelectedConversationId,
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
    selectedConversationIdRef,
    mediaInputRef,
    pdfInputRef,
    shortcutMediaInputRef,
    conversationNoteSaveRef,
    customerNoteSaveRef,
    conversationFilterRequestSeqRef,
    refreshConversations,
    refreshMessages,
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
    handleSelectConversation,
    selectedCustomer,
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
    customerWithPhoneCount,
    customerWithEmailCount,
    customerWithNotesCount,
    messageAttachments,
    resetInbox,
  };
}
