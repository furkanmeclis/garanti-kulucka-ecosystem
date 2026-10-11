import type { ConversationChannel, ConversationMergeCandidate } from "./conversation-mapping.js";

/**
 * Legacy conversations that share a target thread key collapse into one target conversation.
 *
 * The key mirrors the target unique indexes on `conversations`:
 * `(integration_account_id, external_thread_id)` when the conversation has an integration account,
 * `(channel, external_thread_id)` when it has none. Rows without an external thread id never merge.
 *
 * The winner is the member with the most recent activity: `son_mesaj_tarihi`, then `guncelleme_tarihi`,
 * then `olusturma_tarihi` (missing values sort first), then the greatest legacy id as a deterministic
 * tiebreak. Every other member is "merged away": it gets no target row, its legacy id maps to the
 * winner (`legacy_id_map.mapping_role = 'merged_into'`), and its messages and order links follow the winner.
 */
export const conversationMergedIntoMappingRole = "merged_into";

export interface ConversationMergeGroup {
  readonly winnerSourceId: string;
  readonly winnerPublicId: string;
  readonly memberSourceIds: readonly string[];
  readonly channel: ConversationChannel;
  /** Sum of the members' legacy unread counts; the merged conversation's unread_count. */
  readonly unreadCount: number;
}

export interface ConversationMergeChannelSummary {
  readonly groups: number;
  readonly memberRows: number;
  readonly mergedAwayRows: number;
}

export interface ConversationMergeSummary {
  readonly groups: number;
  readonly memberRows: number;
  readonly mergedAwayRows: number;
  readonly largestGroup: number;
  /** Groups whose members point at different legacy customers; the winner's customer is kept. */
  readonly groupsWithMultipleCustomers: number;
  readonly byChannel: Readonly<Record<string, ConversationMergeChannelSummary>>;
}

export interface ConversationMergePlan {
  /** Every member of a merged group (winner included), by lower-case legacy conversation id. */
  readonly groupBySourceId: ReadonlyMap<string, ConversationMergeGroup>;
  /** Merged-away legacy conversation id -> winner target public id. */
  readonly winnerPublicIdByMergedSourceId: ReadonlyMap<string, string>;
  readonly summary: ConversationMergeSummary;
}

export const emptyConversationMergePlan: ConversationMergePlan = Object.freeze({
  groupBySourceId: new Map(),
  winnerPublicIdByMergedSourceId: new Map(),
  summary: Object.freeze({
    groups: 0,
    memberRows: 0,
    mergedAwayRows: 0,
    largestGroup: 0,
    groupsWithMultipleCustomers: 0,
    byChannel: Object.freeze({}),
  }),
});

export function conversationMergeKey(candidate: Pick<
  ConversationMergeCandidate,
  "channel" | "integrationAccountPublicId" | "externalThreadId"
>): string | null {
  if (candidate.externalThreadId === null) return null;
  return candidate.integrationAccountPublicId === null
    ? `channel\u0000${candidate.channel}\u0000${candidate.externalThreadId}`
    : `account\u0000${candidate.integrationAccountPublicId}\u0000${candidate.externalThreadId}`;
}

/** Positive when `a` has more recent activity than `b` (and so would win over it). */
export function compareConversationActivity(a: ConversationMergeCandidate, b: ConversationMergeCandidate): number {
  return compareNullableTimestamps(a.lastMessageAt, b.lastMessageAt)
    || compareNullableTimestamps(a.updatedAt, b.updatedAt)
    || compareNullableTimestamps(a.createdAt, b.createdAt)
    || compareStrings(a.sourceId, b.sourceId);
}

export function buildConversationMergePlan(candidates: Iterable<ConversationMergeCandidate>): ConversationMergePlan {
  const byKey = new Map<string, ConversationMergeCandidate[]>();
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.sourceId)) {
      throw new Error(`Conversation merge plan received legacy conversation ${candidate.sourceId} twice`);
    }
    seen.add(candidate.sourceId);
    const key = conversationMergeKey(candidate);
    if (key === null) continue;
    const members = byKey.get(key);
    if (members) members.push(candidate);
    else byKey.set(key, [candidate]);
  }

  const groupBySourceId = new Map<string, ConversationMergeGroup>();
  const winnerPublicIdByMergedSourceId = new Map<string, string>();
  const byChannel = new Map<string, { groups: number; memberRows: number; mergedAwayRows: number }>();
  let groups = 0;
  let memberRows = 0;
  let largestGroup = 0;
  let groupsWithMultipleCustomers = 0;

  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const winner = members.reduce((best, candidate) =>
      compareConversationActivity(candidate, best) > 0 ? candidate : best);
    const group: ConversationMergeGroup = Object.freeze({
      winnerSourceId: winner.sourceId,
      winnerPublicId: winner.publicId,
      memberSourceIds: Object.freeze(members.map((member) => member.sourceId).sort(compareStrings)),
      channel: winner.channel,
      unreadCount: members.reduce((sum, member) => sum + member.unreadCount, 0),
    });
    for (const member of members) {
      groupBySourceId.set(member.sourceId, group);
      if (member.sourceId !== winner.sourceId) winnerPublicIdByMergedSourceId.set(member.sourceId, winner.publicId);
    }
    groups += 1;
    memberRows += members.length;
    largestGroup = Math.max(largestGroup, members.length);
    if (new Set(members.map((member) => member.legacyCustomerId)).size > 1) groupsWithMultipleCustomers += 1;
    const channel = byChannel.get(winner.channel) ?? { groups: 0, memberRows: 0, mergedAwayRows: 0 };
    channel.groups += 1;
    channel.memberRows += members.length;
    channel.mergedAwayRows += members.length - 1;
    byChannel.set(winner.channel, channel);
  }

  return Object.freeze({
    groupBySourceId,
    winnerPublicIdByMergedSourceId,
    summary: Object.freeze({
      groups,
      memberRows,
      mergedAwayRows: memberRows - groups,
      largestGroup,
      groupsWithMultipleCustomers,
      byChannel: Object.freeze(Object.fromEntries(
        [...byChannel.entries()]
          .sort(([left], [right]) => compareStrings(left, right))
          .map(([channel, summary]) => [channel, Object.freeze({ ...summary })]),
      )),
    }),
  });
}

function compareNullableTimestamps(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  // Normalized legacy timestamps are fixed-width UTC strings, so string order is time order.
  return compareStrings(a, b);
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
