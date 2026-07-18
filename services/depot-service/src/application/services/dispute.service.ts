import { Inject, Injectable } from '@nestjs/common';

import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../domain/order-dispute';
import { DepotNotFoundError, DisputeAlreadyResolvedError, DisputeNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { DisputeRepository } from '../ports/dispute.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RaiseDisputeInput {
  depotId: string;
  orderRef: string;
  customerName: string;
  category: DisputeCategory;
  description: string;
  amountIdr?: number;
  courierName?: string | null;
}

/**
 * Customer order disputes (design depot CRM). A depot-scoped complaint log with an
 * OPEN → RESOLVED/REJECTED lifecycle; the manager decides refund / resend / reject.
 */
@Injectable()
export class DisputeService {
  constructor(
    @Inject(DEPOT_TOKENS.DisputeRepository) private readonly disputes: DisputeRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<OrderDispute> {
    const found = await this.disputes.findById(id);
    if (!found) throw new DisputeNotFoundError();
    return found;
  }

  async raise(input: RaiseDisputeInput, raisedBy: string): Promise<OrderDispute> {
    await this.requireDepot(input.depotId);
    return this.disputes.create({
      depotId: input.depotId,
      orderRef: input.orderRef,
      customerName: input.customerName,
      category: input.category,
      description: input.description,
      amountIdr: input.amountIdr ?? 0,
      courierName: input.courierName ?? null,
      raisedBy,
    });
  }

  async list(depotId: string, status?: DisputeStatus): Promise<OrderDispute[]> {
    await this.requireDepot(depotId);
    return this.disputes.listForDepot(depotId, status);
  }

  get(id: string): Promise<OrderDispute> {
    return this.require(id);
  }

  /**
   * Manager decision. REJECTED resolution → REJECTED status; REFUND/RESEND → RESOLVED.
   * Only an OPEN dispute can be decided.
   */
  async resolve(
    id: string,
    resolution: DisputeResolution,
    resolutionNote: string | null,
    resolvedBy: string,
  ): Promise<OrderDispute> {
    const current = await this.require(id);
    if (current.status !== DisputeStatus.OPEN) throw new DisputeAlreadyResolvedError();
    const status =
      resolution === DisputeResolution.REJECTED ? DisputeStatus.REJECTED : DisputeStatus.RESOLVED;
    return this.disputes.update(id, {
      status,
      resolution,
      resolutionNote: resolutionNote ?? null,
      resolvedBy,
      resolvedAt: new Date(),
    });
  }
}
