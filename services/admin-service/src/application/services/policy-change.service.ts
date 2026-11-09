import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  PolicyChangeNotFoundError,
  PolicyChangeNotPendingError,
  PolicyChangeSelfDecideError,
} from '../../domain/errors';
import {
  PolicyChangeKind,
  PolicyChangeRecord,
  PolicyChangeRepository,
  PolicyChangeStatus,
} from '../ports/policy-change.repository';
import { ADMIN_TOKENS } from '../tokens';
import { RetentionService } from './retention.service';
import { SecurityPolicyService } from './security-policy.service';

/**
 * AAS-14 (owner decision 2026-11-09): four-eyes for the two policies that can switch off a
 * safeguard or shorten how long data must be kept.
 *
 * A PUT no longer applies anything: it VALIDATES (so an illegal value is refused to the person
 * typing it, not discovered at approval) and records a request. A DIFFERENT super admin approves
 * - which applies it through the same validated service call - or rejects it. The requester
 * can do neither to their own request.
 *
 * Approving CLAIMS the request first (atomic PENDING -> APPLIED) and only then applies, so two
 * approvers cannot both apply it; if the apply fails the claim is handed back and the approver
 * sees the error. The freshness token (CA-2-53) is deliberately not replayed at approval: the
 * approver reviewed the payload itself, and an unrelated edit in between must not strand it.
 */
@Injectable()
export class PolicyChangeService {
  private readonly logger = new Logger(PolicyChangeService.name);

  constructor(
    @Inject(ADMIN_TOKENS.PolicyChangeRepository) private readonly repo: PolicyChangeRepository,
    private readonly security: SecurityPolicyService,
    private readonly retention: RetentionService,
  ) {}

  /** Record a security-policy change for approval. Validates first. */
  async requestSecurityChange(
    payload: { idleTimeoutMinutes: number; require2fa: boolean; ipAllowlist: string[] },
    requestedBy: string,
  ): Promise<PolicyChangeRecord> {
    this.security.validate(payload);
    return this.repo.create({ kind: 'SECURITY_POLICY', targetId: null, payload, requestedBy });
  }

  /** Record a retention-window change for approval. Validates against the dataset's current class. */
  async requestRetentionChange(
    id: string,
    payload: { windowLabel: string; windowDays: number; dataClass?: string },
    requestedBy: string,
  ): Promise<PolicyChangeRecord> {
    await this.retention.validate(id, payload as never);
    return this.repo.create({ kind: 'RETENTION_POLICY', targetId: id, payload, requestedBy });
  }

  list(status?: PolicyChangeStatus): Promise<PolicyChangeRecord[]> {
    return this.repo.list(status, 200);
  }

  async approve(id: string, decidedBy: string, note: string | null): Promise<PolicyChangeRecord> {
    const current = await this.requireOpen(id, decidedBy);
    const claimed = await this.repo.decideIfPending(id, {
      status: 'APPLIED',
      decidedBy,
      decisionNote: note,
    });
    if (!claimed) throw new PolicyChangeNotPendingError();
    try {
      await this.apply(current.kind, current.targetId, current.payload);
    } catch (error) {
      // The change did not land: hand the request back so it can be approved again (or rejected).
      await this.repo.reopen(id).catch((e) => {
        this.logger.error(`Policy change ${id} could not be reopened after a failed apply: ${(e as Error).message}`);
      });
      throw error;
    }
    return claimed;
  }

  async reject(id: string, decidedBy: string, note: string | null): Promise<PolicyChangeRecord> {
    await this.requireOpen(id, decidedBy);
    const rejected = await this.repo.decideIfPending(id, {
      status: 'REJECTED',
      decidedBy,
      decisionNote: note,
    });
    if (!rejected) throw new PolicyChangeNotPendingError();
    return rejected;
  }

  private async requireOpen(id: string, decidedBy: string): Promise<PolicyChangeRecord> {
    const current = await this.repo.findById(id);
    if (!current) throw new PolicyChangeNotFoundError(id);
    if (current.status !== 'PENDING') throw new PolicyChangeNotPendingError();
    if (current.requestedBy === decidedBy) throw new PolicyChangeSelfDecideError();
    return current;
  }

  private async apply(
    kind: PolicyChangeKind,
    targetId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (kind === 'SECURITY_POLICY') {
      await this.security.save(payload as never);
      return;
    }
    await this.retention.updatePolicy(targetId as string, payload as never);
  }
}
