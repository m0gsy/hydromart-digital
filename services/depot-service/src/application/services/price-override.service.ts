import { Inject, Injectable, Logger } from '@nestjs/common';

import { ImportSummary, recordAuditEvent, runImport } from '@hydromart/platform';

import { PricingAdjustType } from '../../domain/pricing-rule';
import {
  PriceOverrideProposalRecord,
  PriceOverrideStatus,
  isTerminalStatus,
  needsSecondApprover,
  overrideImpactIdr,
} from '../../domain/price-override-proposal';
import {
  DepotNotFoundError,
  PriceOverrideProposalDecidedError,
  PriceOverrideProposalNotFoundError,
  PriceOverrideSelfApprovalError,
} from '../../domain/errors';
import { DepotConfigService } from '../../config/depot-config.service';
import { buildPage, Page } from '../pagination';
import {
  ListProposalsFilter,
  PriceOverrideProposalRepository,
} from '../ports/price-override-proposal.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';
import { PricingService } from './pricing.service';

export interface ProposeOverrideInput {
  productId: string;
  productName: string;
  currentPrice: number;
  adjustType: PricingAdjustType;
  value: number;
  note: string | null;
}

// Approved overrides win over standing rules (design 7a "priority-wins").
const APPROVED_OVERRIDE_PRIORITY = 100;

/**
 * Price-override approvals (design 7a). Depot managers propose a per-product price
 * adjustment; HQ approves or rejects. Approving creates the real pricing rule through
 * the EXISTING mechanism (PricingService.create) at a winning priority — no duplicated
 * pricing logic. Rejecting just closes the proposal; no price changes.
 */
@Injectable()
export class PriceOverrideService {
  private readonly logger = new Logger(PriceOverrideService.name);

  constructor(
    @Inject(DEPOT_TOKENS.PriceOverrideProposalRepository)
    private readonly proposals: PriceOverrideProposalRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly pricing: PricingService,
    private readonly config: DepotConfigService,
  ) {}

  /** Bulk-propose overrides from the CSV wizard; each row still enters the HQ queue. */
  async importProposals(
    depotId: string,
    proposedBy: string,
    rows: readonly ProposeOverrideInput[],
  ): Promise<ImportSummary> {
    return runImport(rows, async (row) => ({
      status: 'created',
      id: (await this.propose(depotId, proposedBy, row)).id,
    }));
  }

  async propose(
    depotId: string,
    proposedBy: string,
    input: ProposeOverrideInput,
  ): Promise<PriceOverrideProposalRecord> {
    const depot = await this.depots.findById(depotId, false);
    if (!depot) throw new DepotNotFoundError();
    return this.proposals.create({
      depotId,
      depotName: depot.name,
      productId: input.productId,
      productName: input.productName,
      currentPrice: input.currentPrice,
      adjustType: input.adjustType,
      value: input.value,
      note: input.note,
      proposedBy,
    });
  }

  async list(filter: ListProposalsFilter): Promise<Page<PriceOverrideProposalRecord>> {
    const { items, total } = await this.proposals.list(filter);
    return buildPage(items, total, filter.page, filter.limit);
  }

  /** Per-product proposal count (7a base list); HQ defaults to the PENDING queue. */
  countByProduct(
    status: PriceOverrideStatus = PriceOverrideStatus.PENDING,
  ): Promise<{ productId: string; count: number }[]> {
    return this.proposals.countByProduct(status);
  }

  /** Load one proposal (for by-id depot-scope assertion in the controller). */
  get(id: string): Promise<PriceOverrideProposalRecord> {
    return this.require(id);
  }

  async approve(id: string, decidedBy: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.require(id);
    if (isTerminalStatus(proposal.status)) throw new PriceOverrideProposalDecidedError();

    // M18-15 four-eyes: the proposer may not also decide their own above-threshold
    // override. Reuses the depot's existing auto-pass limit rather than inventing a
    // second knob. The proposal is left PENDING, so it simply stays in HQ's queue.
    const impactIdr = overrideImpactIdr(proposal.currentPrice, proposal.adjustType, proposal.value);
    const autoPassIdr = this.config.approvalAutoPassIdr(proposal.depotId);
    if (needsSecondApprover(proposal.proposedBy, decidedBy, impactIdr, autoPassIdr)) {
      // The log line stays: it is stable, greppable, and predates the trail. It is no
      // longer the ONLY record — a blocked self-approval is a security-relevant attempt,
      // so it goes to the audit trail as an unsuccessful decision (H-29).
      this.logger.warn(
        `price-override.self-approve-blocked proposal=${id} depot=${proposal.depotId} actor=${decidedBy} impactIdr=${impactIdr} autoPassIdr=${autoPassIdr}`,
      );
      await this.audit('depot.price_override.self_approve_blocked', proposal, decidedBy, false, {
        impactIdr,
        autoPassIdr,
        proposedBy: proposal.proposedBy,
      });
      throw new PriceOverrideSelfApprovalError();
    }

    // Apply the override through the existing pricing mechanism (priority-wins).
    await this.pricing.create(proposal.depotId, {
      productId: proposal.productId,
      adjustType: proposal.adjustType,
      value: proposal.value,
      daysOfWeek: [],
      startMinute: null,
      endMinute: null,
      validFrom: null,
      validUntil: null,
      priority: APPROVED_OVERRIDE_PRIORITY,
      active: true,
    });
    await this.audit('depot.price_override.approved', proposal, decidedBy, true, {
      impactIdr,
      currentPrice: proposal.currentPrice,
      adjustType: proposal.adjustType,
      value: proposal.value,
      proposedBy: proposal.proposedBy,
    });
    return this.proposals.update(id, {
      status: PriceOverrideStatus.APPROVED,
      decidedBy,
    });
  }

  async reject(id: string, decidedBy: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.require(id);
    if (isTerminalStatus(proposal.status)) throw new PriceOverrideProposalDecidedError();
    // success:false — the decision succeeded, the price change did not. The trail records
    // outcomes for the thing under review, and a rejected price rise is a "no".
    await this.audit('depot.price_override.rejected', proposal, decidedBy, false, {
      currentPrice: proposal.currentPrice,
      adjustType: proposal.adjustType,
      value: proposal.value,
      proposedBy: proposal.proposedBy,
    });
    return this.proposals.update(id, {
      status: PriceOverrideStatus.REJECTED,
      decidedBy,
    });
  }

  /**
   * Records one price-override decision to the shared audit trail (H-29).
   *
   * depot-service has no audit store of its own; auth-service's is the platform's, and
   * this is the internal ingest path. Fail-open by construction (see recordAuditEvent):
   * the price change has already been applied by the time this runs.
   */
  private async audit(
    action: string,
    proposal: PriceOverrideProposalRecord,
    decidedBy: string,
    success: boolean,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await recordAuditEvent(
      {
        authServiceUrl: this.config.authServiceUrl,
        internalServiceKey: this.config.internalServiceKey,
      },
      {
        action,
        actorId: decidedBy || null,
        target: `${proposal.depotName} · ${proposal.productName}`,
        success,
        // depotId is what the depot-scoped audit view (design 8b) filters on.
        metadata: { ...metadata, proposalId: proposal.id, depotId: proposal.depotId },
      },
      this.logger,
    );
  }

  private async require(id: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.proposals.findById(id);
    if (!proposal) throw new PriceOverrideProposalNotFoundError();
    return proposal;
  }
}
