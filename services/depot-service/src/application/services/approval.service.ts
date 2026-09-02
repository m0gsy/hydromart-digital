import { Inject, Injectable } from '@nestjs/common';

import {
  Approval,
  ApprovalPayload,
  ApprovalStatus,
  ApprovalType,
  needsApproval,
} from '../../domain/approval';
import {
  ApprovalAlreadyDecidedError,
  ApprovalNotFoundError,
  ApprovalSelfDecideError,
  DepotNotFoundError,
} from '../../domain/errors';
import { DepotConfigService } from '../../config/depot-config.service';
import { ApprovalRepository, PendingCounts } from '../ports/approval.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateApprovalInput {
  depotId: string;
  type: ApprovalType;
  title: string;
  subjectRef?: string | null;
  /** Signed rupiah at stake (loss/refund/shortfall). */
  amountIdr: number;
  payload?: ApprovalPayload;
}

export type ApprovalDecision = 'APPROVE' | 'REJECT' | 'HOLD';

const DECISION_STATUS: Record<ApprovalDecision, ApprovalStatus> = {
  APPROVE: ApprovalStatus.APPROVED,
  REJECT: ApprovalStatus.REJECTED,
  HOLD: ApprovalStatus.HELD,
};

/**
 * Depot-manager approval queue (design 1c/2a-2c/10c/12a). Value decisions (opname loss,
 * deposit refund, COD shortfall) land here; small ones auto-pass (mirrors payout's
 * expense auto-approve), larger ones wait PENDING for a Tolak/Tahan/Setujui decision.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DEPOT_TOKENS.ApprovalRepository) private readonly approvals: ApprovalRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<Approval> {
    const found = await this.approvals.findById(id);
    if (!found) throw new ApprovalNotFoundError();
    return found;
  }

  async create(input: CreateApprovalInput, submittedBy: string): Promise<Approval> {
    await this.requireDepot(input.depotId);
    const threshold = this.config.approvalAutoPassIdr(input.depotId);
    const autoPass = !needsApproval(input.amountIdr, threshold);
    const now = new Date();
    return this.approvals.create({
      depotId: input.depotId,
      type: input.type,
      status: autoPass ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
      title: input.title,
      submittedBy,
      subjectRef: input.subjectRef ?? null,
      amountIdr: input.amountIdr,
      payload: input.payload ?? {},
      autoPassThreshold: threshold,
      decisionNote: autoPass ? 'Disetujui otomatis (di bawah ambang)' : null,
      decidedBy: null,
      decidedAt: autoPass ? now : null,
    });
  }

  async list(depotId: string, status?: ApprovalStatus): Promise<Approval[]> {
    await this.requireDepot(depotId);
    return this.approvals.listForDepot(depotId, status);
  }

  get(id: string): Promise<Approval> {
    return this.require(id);
  }

  /**
   * Manager decision: APPROVE / REJECT / HOLD. Terminal items cannot be re-decided.
   *
   * CA-2-20, owner decision D7: nor can the person who raised it.
   *
   * `submittedBy` is the account that performed the act being reviewed — the stock count
   * whose loss this is, the gallon return whose refund this is — and every one of those
   * acts is reachable by a MANAGER, who is also the role that holds `approvals`. So one
   * account could count a shortfall, raise the item for it, and sign it off, and the ledger
   * would show two names that were the same name. HOLD is refused with the rest: parking
   * your own item is still a decision about it.
   *
   * The refusal is the escalation. Nothing is deleted and no status is invented: the item
   * stays PENDING, in the same queue, for the next `approvals` holder — another manager, or
   * above a lone manager the superuser — to decide. Paired with `approvalThresholdWrite`,
   * which stops the same person from simply raising the bar until nothing is reviewed.
   */
  async decide(
    id: string,
    decision: ApprovalDecision,
    note: string | null,
    decidedBy: string,
  ): Promise<Approval> {
    const current = await this.require(id);
    if (current.status === ApprovalStatus.APPROVED || current.status === ApprovalStatus.REJECTED) {
      throw new ApprovalAlreadyDecidedError();
    }
    if (current.submittedBy === decidedBy) {
      throw new ApprovalSelfDecideError();
    }
    const status = DECISION_STATUS[decision];
    return this.approvals.update(id, {
      status,
      decisionNote: note ?? null,
      decidedBy,
      // HELD is not a final decision — keep decidedAt null until it's approved/rejected.
      decidedAt: status === ApprovalStatus.HELD ? null : new Date(),
    });
  }

  async counts(depotId: string): Promise<{ total: number; byType: PendingCounts }> {
    await this.requireDepot(depotId);
    const byType = await this.approvals.pendingCounts(depotId);
    const total = Object.values(byType).reduce((sum, n) => sum + n, 0);
    return { total, byType };
  }
}
