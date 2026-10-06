import type { TrainingConversation } from "./repository.js";

/**
 * Legacy AIEgitimPage export formats:
 * - text: readable transcript blocks ("Müşteri:" / "Temsilci:")
 * - jsonl: one chat fine-tuning record per conversation ({ messages: [{ role, content }] })
 * - json: the same records as a JSON array with conversation metadata
 * Consecutive messages from the same side are merged so roles alternate.
 */

export const trainingFormats = ["text", "jsonl", "json"] as const;
export type TrainingFormat = (typeof trainingFormats)[number];

const systemPrompt = "Sen Garanti Kuluçka'nın müşteri hizmetleri temsilcisisin.";

function turns(conversation: TrainingConversation) {
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of conversation.messages) {
    const role = message.sender_type === "customer" ? "user" : "assistant";
    const last = merged.at(-1);
    if (last && last.role === role) last.content = `${last.content}\n${message.body}`;
    else merged.push({ role, content: message.body });
  }
  // A training example must start with the customer and end with the staff answer.
  while (merged[0]?.role === "assistant") merged.shift();
  while (merged.at(-1)?.role === "user") merged.pop();
  return merged;
}

export function formatTrainingExport(conversations: TrainingConversation[], format: TrainingFormat) {
  const records = conversations
    .map((conversation) => ({ conversation, messages: turns(conversation) }))
    .filter((record) => record.messages.length >= 2);

  if (format === "text") {
    const body = records
      .map(({ conversation, messages }, index) =>
        [`### Konuşma ${index + 1} (${conversation.channel})`, ...messages.map((turn) => `${turn.role === "user" ? "Müşteri" : "Temsilci"}: ${turn.content}`)].join("\n"),
      )
      .join("\n\n");
    return { body: body ? `${body}\n` : "", contentType: "text/plain; charset=utf-8", extension: "txt", count: records.length };
  }

  const chat = records.map(({ messages }) => ({ messages: [{ role: "system", content: systemPrompt }, ...messages] }));
  if (format === "jsonl") {
    return { body: chat.map((record) => JSON.stringify(record)).join("\n") + (chat.length ? "\n" : ""), contentType: "application/x-ndjson; charset=utf-8", extension: "jsonl", count: records.length };
  }
  return {
    body: JSON.stringify(
      records.map(({ conversation }, index) => ({
        conversation_public_id: conversation.public_id,
        channel: conversation.channel,
        created_at: conversation.created_at,
        messages: chat[index]!.messages,
      })),
      null,
      2,
    ),
    contentType: "application/json; charset=utf-8",
    extension: "json",
    count: records.length,
  };
}
