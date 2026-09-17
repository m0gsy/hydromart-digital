import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  InvalidWithdrawalAmountError,
  ReleaseAlreadyRequestedError,
  ReleaseRequestNotPendingError,
  ReleaseSelfApprovalError,
} from '../../domain/errors';
import { LedgerRepository } from '../ports/ledger.repository';
import {
  ReleaseRequestRecord,
  ReleaseRequestRepository,
} from '../ports/release-request.repository';
import { PAYOUT_TOKENS } from '../tokens';
import { PayoutService } from './payout.service';

/**
 * PYO-2 — maker-checker for HQ releases (owner decision 2026-09-17).
 *
 * One FINANCE account used to release any owner's full balance to a destination it typed,
 * alone. Now the release is a REQUEST; a DIREKTUR or SUPER_ADMIN who is not the requester
 * approves it, and only then does the existing release path move the money. Both actors
 * stay on the request row, linked to the withdrawal it produced.
 */
@Injectable()
export class HqReleaseService {
  private readonly logger = new Logger(HqReleaseService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.ReleaseRequestRepository)
    private readonly requests: ReleaseRequestRepository,
    @Inject(PAYOUT_TOKENS.LedgerRepository) private readonly ledger: LedgerRepository,
    private readonly payout: PayoutService,
  ) {}

  async request(
    ownerId: string,
    bankAccountRef: string | undefined,
    requestedBy: string,
  ): Promise<ReleaseRequestRecord> {
    const balance = await this.ledger.balanceFor(ownerId);
    if (!(balance > 0)) throw new InvalidWithdrawalAmountError();
    const created = await this.requests.create({
      franchiseOwnerId: ownerId,
      bankAccountRef: bankAccountRef?.trim() || null,
      amountAtRequest: balance,
      requestedBy,
    });
    if (!created) throw new ReleaseAlreadyRequestedError();
    this.logger.log(`hq.release.requested id=${created.id} owner=${ownerId} by=${requestedBy} amount=${balance}`);
    return created;
  }

  listPending(limit = 100): Promise<ReleaseRequestRecord[]> {
    return this.requests.listByStatus('PENDING', limit);
  }

  async approve(id: string, approverId: string): Promise<ReleaseRequestRecord> {
    const pending = await this.loadPending(id, approverId);
    const approved = await this.requests.decide(id, {
      status: 'APPROVED',
      decidedBy: approverId,
      reason: null,
    });
    if (!approved) throw new ReleaseRequestNotPendingError();
    let withdrawalId: string;
    try {
      withdrawalId = (
        await this.payout.releaseForOwner(pending.franchiseOwnerId, pending.bankAccountRef ?? undefined)
      ).id;
    } catch (error) {
      // No money moved; put the request back so it can be decided again.
      await this.requests.reopen(id);
      throw error;
    }
    this.logger.log(`hq.release.approved id=${id} by=${approverId} requestedBy=${pending.requestedBy} withdrawal=${withdrawalId}`);
    return this.requests.attachWithdrawal(id, withdrawalId);
  }

  async reject(id: string, approverId: string, reason: string | null): Promise<ReleaseRequestRecord> {
    await this.loadPending(id, approverId);
    const rejected = await this.requests.decide(id, {
      status: 'REJECTED',
      decidedBy: approverId,
      reason: reason?.trim() || null,
    });
    if (!rejected) throw new ReleaseRequestNotPendingError();
    this.logger.log(`hq.release.rejected id=${id} by=${approverId}`);
    return rejected;
  }

  private async loadPending(id: string, approverId: string): Promise<ReleaseRequestRecord> {
    const request = await this.requests.findById(id);
    if (!request || request.status !== 'PENDING') throw new ReleaseRequestNotPendingError();
    if (request.requestedBy === approverId) throw new ReleaseSelfApprovalError();
    return request;
  }
}
