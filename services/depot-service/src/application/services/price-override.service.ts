import { Inject, Injectable } from '@nestjs/common';

import { PricingAdjustType } from '../../domain/pricing-rule';
import {
  PriceOverrideProposalRecord,
  PriceOverrideStatus,
  isTerminalStatus,
} from '../../domain/price-override-proposal';
import {
  DepotNotFoundError,
  PriceOverrideProposalDecidedError,
  PriceOverrideProposalNotFoundError,
} from '../../domain/errors';
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
  constructor(
    @Inject(DEPOT_TOKENS.PriceOverrideProposalRepository)
    private readonly proposals: PriceOverrideProposalRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly pricing: PricingService,
  ) {}

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

  async approve(id: string, decidedBy: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.require(id);
    if (isTerminalStatus(proposal.status)) throw new PriceOverrideProposalDecidedError();
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
    return this.proposals.update(id, {
      status: PriceOverrideStatus.APPROVED,
      decidedBy,
    });
  }

  async reject(id: string, decidedBy: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.require(id);
    if (isTerminalStatus(proposal.status)) throw new PriceOverrideProposalDecidedError();
    return this.proposals.update(id, {
      status: PriceOverrideStatus.REJECTED,
      decidedBy,
    });
  }

  private async require(id: string): Promise<PriceOverrideProposalRecord> {
    const proposal = await this.proposals.findById(id);
    if (!proposal) throw new PriceOverrideProposalNotFoundError();
    return proposal;
  }
}
