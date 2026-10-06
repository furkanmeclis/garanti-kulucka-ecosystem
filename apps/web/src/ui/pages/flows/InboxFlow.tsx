import { Bot, CheckCheck, Download, FileText, Image, MessageCircle, Pencil, Search, Send, Trash2, X, Zap } from "lucide-react";
import { cx, formatDate, attachmentLabel, FlowPanel, DetailPanel, List, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function InboxFlow({ ctx }: { ctx: DashboardController }) {
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

  return (
    <FlowPanel title="Mesajlar" icon={<MessageCircle size={18} />} testId="inbox-flow">
            <div className="messages-layout">
              <aside className="messages-sidebar" data-testid="conversation-filter-summary">
                <div className="messages-toolbar" data-testid="conversation-filter-bar">
                  <label className="messages-select-label">
                    <span>Kanal</span>
                    <select
                      className="inline-input"
                      data-testid="channel-filter"
                      value={conversationChannelFilter}
                      onChange={(event) => void handleApplyConversationFilters(event.target.value, conversationStatusFilter)}
                    >
                      {conversationChannelFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="messages-select-label">
                    <span>Durum</span>
                    <select
                      className="inline-input"
                      data-testid="status-filter"
                      value={conversationStatusFilter}
                      onChange={(event) => void handleApplyConversationFilters(conversationChannelFilter, event.target.value)}
                    >
                      {conversationStatusFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
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
                      {label}
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
                      {label}
                    </button>
                  ))}
                </div>
                <label className="messages-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    data-testid="conversation-search"
                    value={conversationSearch}
                    onChange={(event) => setConversationSearch(event.target.value)}
                    placeholder="Konuşma ara"
                    type="search"
                  />
                </label>
                <div className="messages-counts">
                  <span>Okunmamış {unreadConversationCount}</span>
                  <span>Havuz {poolConversationCount}</span>
                  <span>Human Agent {humanAgentConversationCount}</span>
                  <span>legacy kanal/durum filtreleri</span>
                  <span>backend is_in_pool</span>
                  <span>backend human_agent_enabled</span>
                  <span>Aktif kanal {conversationChannelFilter}</span>
                  <span>Aktif durum {conversationStatusFilter}</span>
                </div>
                <List title="Konuşmalar" testId="conversation-list">
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
                        <span>{conversation.last_message_text ?? "Mesaj yok"}</span>
                        <span>
                          {conversation.status} / okunmamış {conversation.unread_count}
                          {conversation.is_in_pool ? " / havuzda" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </aside>

              <section className="message-thread">
                <header className="message-thread-header">
                  <div>
                    <h2>{selectedConversation?.customer?.full_name ?? "Konuşma seçin"}</h2>
                    <span>{selectedConversation?.channel ?? "Kanal yok"}</span>
                  </div>
                  {selectedConversation && selectedConversation.unread_count > 0 && (
                    <button
                      className="secondary-action icon-action"
                      data-testid="mark-read-button"
                      type="button"
                      onClick={() => void handleUpdateConversationState({ unread_count: 0 })}
                    >
                      <CheckCheck size={16} aria-hidden="true" />
                      <span>Okundu yap</span>
                    </button>
                  )}
                </header>
                <div className="message-scroll-area" data-testid="message-scroll-area">
                  {messageAttachments.length > 0 && (
                    <div className="message-attachments" data-testid="message-attachments">
                      {messageAttachments.map((attachment) => (
                        <span key={`${attachment.file_public_id}-${attachment.attachment_type}`}>
                          <FileText size={13} aria-hidden="true" />
                          {attachmentLabel(attachment.attachment_type)} {attachment.original_name ?? attachment.file_public_id}
                        </span>
                      ))}
                    </div>
                  )}
                  {data.messages.map((message) => {
                    const mine = message.sender_type === "user" || message.sender_type === "ai";
                    const attachments = message.attachments ?? [];
                    return (
                      <article className={cx("message-bubble", mine && "mine")} key={message.public_id}>
                        <strong>{message.sender_name ?? (mine ? "Temsilci" : "Müşteri")}</strong>
                        <span>{message.body ?? (attachments.length > 0 ? "Medya" : "Boş mesaj")}</span>
                        {attachments.length > 0 && (
                          <div className="message-attachments">
                            {attachments.map((attachment) => (
                              <span key={attachment.file_public_id}>
                                <FileText size={13} aria-hidden="true" />
                                {attachmentLabel(attachment.attachment_type)} {attachment.original_name ?? attachment.file_public_id}
                              </span>
                            ))}
                          </div>
                        )}
                        <small>{formatDate(message.sent_at)}</small>
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
                      title="Görsel / video ekle"
                      type="button"
                      onClick={() => mediaInputRef.current?.click()}
                    >
                      <Image size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      title="PDF ekle"
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      <FileText size={16} aria-hidden="true" />
                    </button>
                    <button
                      className={cx("secondary-action icon-only", shortcutMenuOpen && "selected")}
                      data-testid="shortcut-menu-button"
                      title="Hızlı cevaplar"
                      type="button"
                      onClick={() => setShortcutMenuOpen((current) => !current)}
                    >
                      <Zap size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      data-testid="ai-suggestion-button"
                      title="AI yanıt öner"
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
                            {attachmentLabel(attachment.attachment_type)}: {attachment.file.name}
                            <button
                              title="Medyayı kaldır"
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
                            placeholder="Kısayol kodu"
                            value={shortcutDraft.code}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, code: event.target.value }))}
                          />
                          <textarea
                            data-testid="shortcut-message-input"
                            placeholder={shortcutDraft.attachments.length > 0 ? "Medya başlığı" : "Kısayol mesajı"}
                            value={shortcutDraft.message}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, message: event.target.value }))}
                          />
                          {shortcutDraft.attachments.length > 0 && (
                            <div className="attachment-strip">
                              {shortcutDraft.attachments.map((attachment, index) => (
                                <span key={`${attachment.file.name}-${index}`}>
                                  {attachmentLabel(attachment.attachment_type)}: {attachment.file.name}
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
                              Medya ekle
                            </button>
                            <button
                              className="primary-action"
                              data-testid="shortcut-save-button"
                              disabled={!shortcutDraft.code.trim() || (!shortcutDraft.message.trim() && shortcutDraft.attachments.length === 0)}
                              type="button"
                              onClick={() => void handleSaveShortcut()}
                            >
                              {editingShortcutId ? "Güncelle" : "Ekle"}
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => {
                                setEditingShortcutId(null);
                                setShortcutDraft({ code: "", message: "", attachments: [] });
                              }}
                            >
                              İptal
                            </button>
                          </div>
                        </div>
                        <div className="shortcut-list">
                          {messageShortcuts.filter((shortcut) => shortcut.is_active).map((shortcut) => (
                            <div className="shortcut-row" key={shortcut.public_id}>
                              <button data-testid="shortcut-row" type="button" onClick={() => handleUseShortcut(shortcut)}>
                                <code>/{shortcut.code}</code>
                                <span>{shortcut.message ?? shortcut.attachments[0]?.original_name ?? "Medya"}</span>
                                {shortcut.attachments.length > 0 && <em>{shortcut.attachments.length} medya</em>}
                              </button>
                              {shortcut.attachments.length > 0 && (
                                <button
                                  className="secondary-action icon-only"
                                  data-testid="shortcut-download-button"
                                  title="Dosyayı indir"
                                  type="button"
                                  onClick={() => void handleDownloadShortcutAttachment(shortcut)}
                                >
                                  <Download size={14} aria-hidden="true" />
                                </button>
                              )}
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-edit-button"
                                title="Kısayolu düzenle"
                                type="button"
                                onClick={() => handleEditShortcut(shortcut)}
                              >
                                <Pencil size={14} aria-hidden="true" />
                              </button>
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-delete-button"
                                title="Kısayolu sil"
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
                      placeholder={pendingAttachments.length > 0 ? "Medya başlığı yazın..." : "Mesajınızı yazın..."}
                      value={messageDraft}
                    />
                    {aiSuggestion && (
                      <div className="ai-suggestion" data-testid="ai-suggestion">
                        <span>{aiSuggestion}</span>
                        <button type="button" onClick={() => setMessageDraft(aiSuggestion)}>
                          Kullan
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
                    <span>Cevap gönder</span>
                  </button>
                </div>
              </section>

              <aside className="messages-detail">
                {selectedConversation && (
                  <DetailPanel title="Konuşma Detayı" testId="conversation-detail">
                    <DataRows
                      rows={[
                        ["Müşteri", selectedConversation.customer?.full_name ?? selectedConversation.public_id, selectedConversation.channel],
                        ["Durum", selectedConversation.status, selectedConversation.assigned_user_email ?? "havuz"],
                        ["Okunmamış", String(selectedConversation.unread_count), selectedConversation.last_message_sender_type ?? "-"],
                      ]}
                    />
                    <label className="note-editor">
                      <span>Konuşma notu</span>
                      <textarea
                        data-testid="conversation-note-input"
                        placeholder="Konuşma için not"
                        value={conversationNoteDraft}
                        onChange={(event) => handleConversationNoteChange(event.target.value)}
                      />
                    </label>
                    <label className="note-editor">
                      <span>Müşteri notu</span>
                      <textarea
                        data-testid="customer-note-input"
                        placeholder="Müşteri için not"
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
                        {selectedConversation.human_agent_enabled ? "Human agent kapat" : "Human agent aç"}
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
                        {selectedConversation.is_in_pool ? "Havuzdan al" : "Havuza bırak"}
                      </button>
                    </div>
                    <button
                      className="primary-action"
                      type="button"
                      onClick={() => openOrderForm("conversation")}
                    >
                      Konuşmadan sipariş aç
                    </button>
                  </DetailPanel>
                )}
              </aside>
            </div>
          </FlowPanel>
  );
}

