import { Bot, CheckCheck, Download, FileText, Image, MessageCircle, Pencil, Search, Send, Trash2, X, Zap } from "lucide-react";
import { cx, formatDate, attachmentLabel, FlowPanel, DetailPanel, List, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useUiMessageText } from "../../i18n/messages/status.js";
import { useLanguage, useT } from "../../i18n/index.js";
import { inboxMessages } from "../../i18n/messages/inbox.js";

export function InboxFlow({ ctx }: { ctx: DashboardController }) {
  const labelText = useUiMessageText();
  const {
    aiSuggestion,
    conversationChannelFilter,
    conversationChannelFilters,
    conversationNoteDraft,
    conversationSearch,
    conversationStatusFilter,
    conversationStatusFilters,
    customerNoteDraft,
    data,
    editingShortcutId,
    handleAiSuggestion,
    handleApplyConversationFilters,
    handleConversationNoteChange,
    handleCustomerNoteChange,
    handleDeleteShortcut,
    handleDownloadShortcutAttachment,
    handleEditShortcut,
    handlePickMessageFiles,
    handlePickShortcutFiles,
    handleSaveShortcut,
    handleSelectConversation,
    handleSendMessage,
    handleUpdateConversationState,
    handleUseShortcut,
    humanAgentConversationCount,
    mediaInputRef,
    messageAttachments,
    messageDraft,
    messageShortcuts,
    openOrderForm,
    pdfInputRef,
    pendingAttachments,
    poolConversationCount,
    selectedConversation,
    setConversationSearch,
    setEditingShortcutId,
    setMessageDraft,
    setPendingAttachments,
    setShortcutDraft,
    setShortcutMenuOpen,
    shortcutDraft,
    shortcutMediaInputRef,
    shortcutMenuOpen,
    unreadConversationCount,
    visibleConversations,
  } = ctx;
  const t = useT(inboxMessages);
  const { language } = useLanguage();

  return (
    <FlowPanel title={t("title")} icon={<MessageCircle size={18} />} testId="inbox-flow">
            <div className="messages-layout">
              <aside className="messages-sidebar" data-testid="conversation-filter-summary">
                <div className="messages-toolbar" data-testid="conversation-filter-bar">
                  <label className="messages-select-label">
                    <span>{t("channel")}</span>
                    <select
                      className="inline-input"
                      data-testid="channel-filter"
                      value={conversationChannelFilter}
                      onChange={(event) => void handleApplyConversationFilters(event.target.value, conversationStatusFilter)}
                    >
                      {conversationChannelFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {labelText(label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="messages-select-label">
                    <span>{t("status")}</span>
                    <select
                      className="inline-input"
                      data-testid="status-filter"
                      value={conversationStatusFilter}
                      onChange={(event) => void handleApplyConversationFilters(conversationChannelFilter, event.target.value)}
                    >
                      {conversationStatusFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {labelText(label)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="detail-actions compact" aria-hidden="true">
                  {conversationChannelFilters.map(({ value, label }) => (
                    <button
                      className={cx("secondary-action", conversationChannelFilter === value && "selected")}
                      data-testid={`conversation-channel-filter-${value}`}
                      key={value}
                      type="button"
                      onClick={() => void handleApplyConversationFilters(value, conversationStatusFilter)}
                    >
                      {labelText(label)}
                    </button>
                  ))}
                  {conversationStatusFilters.map(({ value, label }) => (
                    <button
                      className={cx("secondary-action", conversationStatusFilter === value && "selected")}
                      data-testid={`conversation-status-filter-${value}`}
                      key={value}
                      type="button"
                      onClick={() => void handleApplyConversationFilters(conversationChannelFilter, value)}
                    >
                      {labelText(label)}
                    </button>
                  ))}
                </div>
                <label className="messages-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    data-testid="conversation-search"
                    value={conversationSearch}
                    onChange={(event) => setConversationSearch(event.target.value)}
                    placeholder={t("searchPlaceholder")}
                    type="search"
                  />
                </label>
                <div className="messages-counts">
                  <span>{t("unreadCount", { count: unreadConversationCount })}</span>
                  <span>{t("poolCount", { count: poolConversationCount })}</span>
                  <span>{t("humanAgentCount", { count: humanAgentConversationCount })}</span>
                  <span>{t("legacyFilters")}</span>
                  <span>backend is_in_pool</span>
                  <span>backend human_agent_enabled</span>
                  <span>{t("activeChannel", { value: conversationChannelFilter })}</span>
                  <span>{t("activeStatus", { value: conversationStatusFilter })}</span>
                </div>
                <List title={t("conversations")} testId="conversation-list">
                  {visibleConversations.map((conversation) => (
                    <li key={conversation.public_id}>
                      <button
                        className={cx("conversation-button", selectedConversation?.public_id === conversation.public_id && "selected")}
                        data-channel={conversation.channel}
                        data-testid="conversation-row"
                        type="button"
                        onClick={() => void handleSelectConversation(conversation.public_id)}
                      >
                        <span className="conversation-row-top">
                          <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                          <em>{conversation.channel}</em>
                        </span>
                        <span>{conversation.last_message_text ?? t("noMessage")}</span>
                        <span>
                          {t("rowUnread", { status: conversation.status, count: conversation.unread_count })}
                          {conversation.is_in_pool ? t("rowInPool") : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </aside>

              <section className="message-thread">
                <header className="message-thread-header">
                  <div>
                    <h2>{selectedConversation?.customer?.full_name ?? t("selectConversation")}</h2>
                    <span>{selectedConversation?.channel ?? t("noChannel")}</span>
                  </div>
                  {selectedConversation && selectedConversation.unread_count > 0 && (
                    <button
                      className="secondary-action icon-action"
                      data-testid="mark-read-button"
                      type="button"
                      onClick={() => void handleUpdateConversationState({ unread_count: 0 })}
                    >
                      <CheckCheck size={16} aria-hidden="true" />
                      <span>{t("markRead")}</span>
                    </button>
                  )}
                </header>
                <div className="message-scroll-area" data-testid="message-scroll-area">
                  {messageAttachments.length > 0 && (
                    <div className="message-attachments" data-testid="message-attachments">
                      {messageAttachments.map((attachment) => (
                        <span key={`${attachment.file_public_id}-${attachment.attachment_type}`}>
                          <FileText size={13} aria-hidden="true" />
                          {attachmentLabel(attachment.attachment_type, language)} {attachment.original_name ?? attachment.file_public_id}
                        </span>
                      ))}
                    </div>
                  )}
                  {data.messages.map((message) => {
                    const mine = message.sender_type === "user" || message.sender_type === "ai";
                    const attachments = message.attachments ?? [];
                    return (
                      <article className={cx("message-bubble", mine && "mine")} key={message.public_id}>
                        <strong>{message.sender_name ?? (mine ? t("agent") : t("customer"))}</strong>
                        <span>{message.body ?? (attachments.length > 0 ? t("media") : t("emptyMessage"))}</span>
                        {attachments.length > 0 && (
                          <div className="message-attachments">
                            {attachments.map((attachment) => (
                              <span key={attachment.file_public_id}>
                                <FileText size={13} aria-hidden="true" />
                                {attachmentLabel(attachment.attachment_type, language)} {attachment.original_name ?? attachment.file_public_id}
                              </span>
                            ))}
                          </div>
                        )}
                        <small>{formatDate(message.sent_at, language)}</small>
                      </article>
                    );
                  })}
                </div>
                <div className="message-composer" data-testid="message-composer">
                  <input
                    ref={mediaInputRef}
                    accept="image/*,video/*"
                    className="hidden-file-input"
                    data-testid="message-media-input"
                    multiple
                    type="file"
                    onChange={(event) => {
                      handlePickMessageFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <input
                    ref={pdfInputRef}
                    accept="application/pdf"
                    className="hidden-file-input"
                    data-testid="message-pdf-input"
                    type="file"
                    onChange={(event) => {
                      handlePickMessageFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="message-composer-tools">
                    <button
                      className="secondary-action icon-only"
                      title={t("addImageVideo")}
                      type="button"
                      onClick={() => mediaInputRef.current?.click()}
                    >
                      <Image size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      title={t("addPdf")}
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      <FileText size={16} aria-hidden="true" />
                    </button>
                    <button
                      className={cx("secondary-action icon-only", shortcutMenuOpen && "selected")}
                      data-testid="shortcut-menu-button"
                      title={t("quickReplies")}
                      type="button"
                      onClick={() => setShortcutMenuOpen((current) => !current)}
                    >
                      <Zap size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      data-testid="ai-suggestion-button"
                      title={t("suggestAiReply")}
                      type="button"
                      onClick={() => void handleAiSuggestion()}
                    >
                      <Bot size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="message-composer-main">
                    {pendingAttachments.length > 0 && (
                      <div className="attachment-strip" data-testid="pending-attachments">
                        {pendingAttachments.map((attachment, index) => (
                          <span key={`${attachment.file.name}-${index}`}>
                            {attachmentLabel(attachment.attachment_type, language)}: {attachment.file.name}
                            <button
                              title={t("removeMedia")}
                              type="button"
                              onClick={() => {
                                setPendingAttachments((current) => {
                                  const removed = current[index];
                                  if (removed?.preview_url) URL.revokeObjectURL(removed.preview_url);
                                  return current.filter((_, itemIndex) => itemIndex !== index);
                                });
                              }}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {shortcutMenuOpen && (
                      <div className="shortcut-popover" data-testid="shortcut-popover">
                        <div className="shortcut-form">
                          <input
                            ref={shortcutMediaInputRef}
                            accept="image/*,video/*,application/pdf"
                            className="hidden-file-input"
                            data-testid="shortcut-media-input"
                            multiple
                            type="file"
                            onChange={(event) => {
                              handlePickShortcutFiles(event.currentTarget.files);
                              event.currentTarget.value = "";
                            }}
                          />
                          <input
                            className="inline-input"
                            data-testid="shortcut-code-input"
                            placeholder={t("shortcutCode")}
                            value={shortcutDraft.code}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, code: event.target.value }))}
                          />
                          <textarea
                            data-testid="shortcut-message-input"
                            placeholder={shortcutDraft.attachments.length > 0 ? t("mediaCaption") : t("shortcutMessage")}
                            value={shortcutDraft.message}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, message: event.target.value }))}
                          />
                          {shortcutDraft.attachments.length > 0 && (
                            <div className="attachment-strip">
                              {shortcutDraft.attachments.map((attachment, index) => (
                                <span key={`${attachment.file.name}-${index}`}>
                                  {attachmentLabel(attachment.attachment_type, language)}: {attachment.file.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="detail-actions compact">
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => shortcutMediaInputRef.current?.click()}
                            >
                              <Image size={14} aria-hidden="true" />
                              {t("addMedia")}
                            </button>
                            <button
                              className="primary-action"
                              data-testid="shortcut-save-button"
                              disabled={!shortcutDraft.code.trim() || (!shortcutDraft.message.trim() && shortcutDraft.attachments.length === 0)}
                              type="button"
                              onClick={() => void handleSaveShortcut()}
                            >
                              {editingShortcutId ? t("update") : t("add")}
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => {
                                setEditingShortcutId(null);
                                setShortcutDraft({ code: "", message: "", attachments: [] });
                              }}
                            >
                              {t("cancel")}
                            </button>
                          </div>
                        </div>
                        <div className="shortcut-list">
                          {messageShortcuts.filter((shortcut) => shortcut.is_active).map((shortcut) => (
                            <div className="shortcut-row" key={shortcut.public_id}>
                              <button data-testid="shortcut-row" type="button" onClick={() => handleUseShortcut(shortcut)}>
                                <code>/{shortcut.code}</code>
                                <span>{shortcut.message ?? shortcut.attachments[0]?.original_name ?? t("media")}</span>
                                {shortcut.attachments.length > 0 && <em>{t("mediaCount", { count: shortcut.attachments.length })}</em>}
                              </button>
                              {shortcut.attachments.length > 0 && (
                                <button
                                  className="secondary-action icon-only"
                                  data-testid="shortcut-download-button"
                                  title={t("downloadFile")}
                                  type="button"
                                  onClick={() => void handleDownloadShortcutAttachment(shortcut)}
                                >
                                  <Download size={14} aria-hidden="true" />
                                </button>
                              )}
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-edit-button"
                                title={t("editShortcut")}
                                type="button"
                                onClick={() => handleEditShortcut(shortcut)}
                              >
                                <Pencil size={14} aria-hidden="true" />
                              </button>
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-delete-button"
                                title={t("deleteShortcut")}
                                type="button"
                                onClick={() => void handleDeleteShortcut(shortcut.public_id)}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea
                      data-testid="message-input"
                      disabled={!selectedConversation}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={pendingAttachments.length > 0 ? t("mediaCaptionPlaceholder") : t("messagePlaceholder")}
                      value={messageDraft}
                    />
                    {aiSuggestion && (
                      <div className="ai-suggestion" data-testid="ai-suggestion">
                        <span>{aiSuggestion}</span>
                        <button type="button" onClick={() => setMessageDraft(aiSuggestion)}>
                          {t("use")}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="primary-action icon-action"
                    data-testid="message-send-button"
                    disabled={!selectedConversation || (!messageDraft.trim() && pendingAttachments.length === 0)}
                    type="button"
                    onClick={() => void handleSendMessage()}
                  >
                    <Send size={16} aria-hidden="true" />
                    <span>{t("sendReply")}</span>
                  </button>
                </div>
              </section>

              <aside className="messages-detail">
                {selectedConversation && (
                  <DetailPanel title={t("conversationDetail")} testId="conversation-detail">
                    <DataRows
                      rows={[
                        [t("customer"), selectedConversation.customer?.full_name ?? selectedConversation.public_id, selectedConversation.channel],
                        [t("status"), selectedConversation.status, selectedConversation.assigned_user_email ?? t("pool")],
                        [t("unread"), String(selectedConversation.unread_count), selectedConversation.last_message_sender_type ?? "-"],
                      ]}
                    />
                    <label className="note-editor">
                      <span>{t("conversationNote")}</span>
                      <textarea
                        data-testid="conversation-note-input"
                        placeholder={t("conversationNotePlaceholder")}
                        value={conversationNoteDraft}
                        onChange={(event) => handleConversationNoteChange(event.target.value)}
                      />
                    </label>
                    <label className="note-editor">
                      <span>{t("customerNote")}</span>
                      <textarea
                        data-testid="customer-note-input"
                        placeholder={t("customerNotePlaceholder")}
                        value={customerNoteDraft}
                        onChange={(event) => handleCustomerNoteChange(event.target.value)}
                      />
                    </label>
                    <div className="detail-actions" data-testid="conversation-state-actions">
                      <button
                        className="secondary-action"
                        data-testid="human-agent-toggle"
                        type="button"
                        onClick={() =>
                          void handleUpdateConversationState({
                            human_agent_enabled: !selectedConversation.human_agent_enabled,
                          })
                        }
                      >
                        {selectedConversation.human_agent_enabled ? t("humanAgentOff") : t("humanAgentOn")}
                      </button>
                      <button
                        className="secondary-action"
                        data-testid="pool-toggle"
                        type="button"
                        onClick={() =>
                          void handleUpdateConversationState(
                            selectedConversation.is_in_pool
                              ? { assign_to_me: true, is_in_pool: false }
                              : { assign_to_me: false, is_in_pool: true },
                          )
                        }
                      >
                        {selectedConversation.is_in_pool ? t("takeFromPool") : t("releaseToPool")}
                      </button>
                    </div>
                    <button
                      className="primary-action"
                      type="button"
                      onClick={() => openOrderForm("conversation")}
                    >
                      {t("createOrderFromConversation")}
                    </button>
                  </DetailPanel>
                )}
              </aside>
            </div>
          </FlowPanel>
  );
}

