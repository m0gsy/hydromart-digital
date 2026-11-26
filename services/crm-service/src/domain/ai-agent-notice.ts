export const AI_AGENT_NOTICE_KINDS = ['FLAG', 'CAP_REACHED', 'STOPPED', 'STOPPED_ALL'] as const;
export type AiAgentNoticeKind = (typeof AI_AGENT_NOTICE_KINDS)[number];
