import { can } from '@hydromart/access';

import { NotificationEvent } from './notification-event';

export const AI_LEAD_NOTICE_KINDS = ['NEW', 'REMIND', 'ESCALATE'] as const;
export type AiLeadNoticeKind = (typeof AI_LEAD_NOTICE_KINDS)[number];

export const AI_LEAD_EVENT_OF: Record<AiLeadNoticeKind, NotificationEvent> = {
  NEW: NotificationEvent.AI_LEAD_NEW,
  REMIND: NotificationEvent.AI_LEAD_REMIND,
  ESCALATE: NotificationEvent.AI_LEAD_ESCALATE,
};

/**
 * Who is told: NEW and REMIND go to the roles that work the calon mitra CRM (`prospectCrm`), ESCALATE
 * to Sales Lead (`prospectSettings`) and Direksi.
 */
export const isLeadRole = (kind: AiLeadNoticeKind, role: string): boolean =>
  kind === 'ESCALATE' ? role === 'DIREKTUR' || can('prospectSettings', role) : can('prospectCrm', role);
