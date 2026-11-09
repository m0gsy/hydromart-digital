/** AAS-14: a security-policy or retention-window change waiting for a second super admin. */
export type PolicyChangeKind = 'SECURITY_POLICY' | 'RETENTION_POLICY';
export type PolicyChangeStatus = 'PENDING' | 'APPLIED' | 'REJECTED';

export interface PolicyChangeRecord {
  id: string;
  kind: PolicyChangeKind;
  /** The retention policy id; null for the singleton security policy. */
  targetId: string | null;
  /** Exactly what the PUT carried (minus the freshness token). */
  payload: Record<string, unknown>;
  status: PolicyChangeStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface CreatePolicyChangeData {
  kind: PolicyChangeKind;
  targetId: string | null;
  payload: Record<string, unknown>;
  requestedBy: string;
}

export interface PolicyChangeRepository {
  create(data: CreatePolicyChangeData): Promise<PolicyChangeRecord>;
  findById(id: string): Promise<PolicyChangeRecord | null>;
  /** Newest first; `status` omitted = all. Bounded. */
  list(status: PolicyChangeStatus | undefined, take: number): Promise<PolicyChangeRecord[]>;
  /**
   * Atomically move a PENDING request to a decided state. Null when it was not PENDING any more
   * (decided meanwhile): the WHERE guard is the defence, so two approvers cannot both apply it.
   */
  decideIfPending(
    id: string,
    decision: { status: 'APPLIED' | 'REJECTED'; decidedBy: string; decisionNote: string | null },
  ): Promise<PolicyChangeRecord | null>;
  /** Hand a claimed request back to PENDING (the apply step failed after the claim). */
  reopen(id: string): Promise<void>;
}
