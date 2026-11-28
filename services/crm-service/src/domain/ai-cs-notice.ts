import { can } from '@hydromart/access';

import { NotificationEvent } from './notification-event';

export const AI_CS_NOTICE_KINDS = ['NEW', 'REMIND', 'ESCALATE'] as const;
export type AiCsNoticeKind = (typeof AI_CS_NOTICE_KINDS)[number];

export const AI_CS_EVENT_OF: Record<AiCsNoticeKind, NotificationEvent> = {
  NEW: NotificationEvent.AI_CS_NEW,
  REMIND: NotificationEvent.AI_CS_REMIND,
  ESCALATE: NotificationEvent.AI_CS_ESCALATE,
};

/** NEW and REMIND go to whoever answers in the CS inbox (aiCsReply), ESCALATE to whoever manages it (aiCsManage). */
export const isCsRecipient = (kind: AiCsNoticeKind, role: string): boolean =>
  can(kind === 'ESCALATE' ? 'aiCsManage' : 'aiCsReply', role);

/**
 * The AI web's own dedupe key: ai-cs:<conversationId> for NEW, ai-cs-overdue:<conversationId>:<kind>
 * otherwise, plus an optional :<n> for the n-th handoff of a conversation that was closed and reopened.
 */
export const aiCsEventIdPattern = (kind: AiCsNoticeKind, conversationId: string): RegExp =>
  new RegExp(`^${kind === 'NEW' ? `ai-cs:${conversationId}` : `ai-cs-overdue:${conversationId}:${kind}`}(:[0-9]{1,6})?$`);
