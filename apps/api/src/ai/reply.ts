/**
 * Conversation reply drafts (legacy `/api/ai-agent/yanit-oner` and `/yanit-ve-gonder`).
 *
 * No OpenAI provider adapter is ported yet, so every draft is a dry-run placeholder: `dry_run: true` and
 * `live_call_permitted: false`. Callers must never deliver a dry-run draft to a customer; once a live adapter
 * exists it plugs in here behind its own live gate and the send route keeps working unchanged.
 */
export interface ConversationReplyDraft {
  provider: "openai";
  operation: "messages.reply_suggestion";
  dry_run: boolean;
  live_call_permitted: boolean;
  suggestion: string;
}

export const dryRunReplySuggestion = "AI yanıt önerisi backend dry-run sınırında tutuldu.";

export async function draftConversationReply(_input: { conversationPublicId: string }): Promise<ConversationReplyDraft> {
  return {
    provider: "openai",
    operation: "messages.reply_suggestion",
    dry_run: true,
    live_call_permitted: false,
    suggestion: dryRunReplySuggestion,
  };
}
