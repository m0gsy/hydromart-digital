import { Inject, Injectable } from '@nestjs/common';

import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../domain/order-dispute';
import {
  DepotNotFoundError,
  DisputeAlreadyResolvedError,
  DisputeNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { DisputeRepository } from '../ports/dispute.repository';
import { DisputeRefundPort } from '../ports/dispute-refund.port';
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
    @Inject(DEPOT_TOKENS.DisputeRefund) private readonly refunds: DisputeRefundPort,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
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
    authorization = '',
  ): Promise<OrderDispute> {
    const current = await this.require(id);
    if (current.status !== DisputeStatus.OPEN) throw new DisputeAlreadyResolvedError();
    /*
     * CA-2-39: REFUND asks for the money back, then records that it did.
     *
     * This method used to write the dispute row and nothing else, so a manager choosing
     * REFUND believed the customer would be repaid and nothing repaid them — the only
     * record was a status on a queue nobody reconciles against the money.
     *
     * It QUEUES a refund, it does not pay one: payment-service already has the path, and a
     * requested refund waits for HQ approval before it settles. The decision a depot
     * manager may make is "this customer should be refunded"; the decision HQ may make is
     * "and here is the money". The manager's own token travels with the request, so
     * `Can('refundIssue')` applies to them and the refund is attributed to them.
     *
     * Before the write, and fail-closed: a dispute marked RESOLVED against a refund that
     * was never queued is the state this whole row is about. RESEND is deliberately NOT
     * wired — creating a replacement order is a product decision, not a plumbing one, and
     * inventing one here would repeat the mistake in the other direction.
     */
    if (resolution === DisputeResolution.REFUND) {
      await this.refunds.request(
        current.orderRef,
        resolutionNote?.trim() || `Sengketa ${current.category}`,
        authorization,
      );
    }
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
