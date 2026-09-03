import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  computeTotal,
  isFullyReceived,
  PoLine,
  PoStatus,
  PurchaseOrder,
  receivedOf,
} from '../../domain/purchase-order';
import {
  DepotNotFoundError,
  InvalidPurchaseOrderTransitionError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { PurchaseOrderRepository } from '../ports/purchase-order.repository';
import { SupplierRepository } from '../ports/supplier.repository';
import { InventoryService } from './inventory.service';
import { DEPOT_TOKENS } from '../tokens';

export interface CreatePurchaseOrderInput {
  depotId: string;
  supplierId: string;
  lines: PoLine[];
  shippingIdr?: number;
  expectedAt?: Date | null;
}

export interface ListPurchaseOrderFilters {
  status?: PoStatus;
}

/**
 * Depot purchase orders (design 7a/9d). DRAFT → SENT → RECEIVED. Receiving a PO posts a
 * RECEIPT stock movement per line into the depot's inventory via InventoryService (a direct
 * in-process call — same service, no HTTP).
 */
@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    @Inject(DEPOT_TOKENS.PurchaseOrderRepository) private readonly orders: PurchaseOrderRepository,
    @Inject(DEPOT_TOKENS.SupplierRepository) private readonly suppliers: SupplierRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly inventory: InventoryService,
  ) {}

  private async require(id: string): Promise<PurchaseOrder> {
    const found = await this.orders.findById(id);
    if (!found) throw new PurchaseOrderNotFoundError();
    return found;
  }

  async create(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    if (!(await this.depots.findById(input.depotId, false))) {
      throw new DepotNotFoundError();
    }
    const supplier = await this.suppliers.findById(input.supplierId);
    if (!supplier || supplier.depotId !== input.depotId) {
      throw new SupplierNotFoundError();
    }
    const shippingIdr = input.shippingIdr ?? 0;
    const { subtotalIdr, totalIdr } = computeTotal(input.lines, shippingIdr);
    return this.orders.create({
      depotId: input.depotId,
      // ponytail: random human-readable ref; swap for a per-depot running sequence if
      // finance needs gapless numbering.
      poNumber: `PO-${randomUUID().slice(0, 8).toUpperCase()}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      lines: input.lines,
      subtotalIdr,
      shippingIdr,
      totalIdr,
      expectedAt: input.expectedAt ?? null,
    });
  }

  async list(depotId: string, filters: ListPurchaseOrderFilters = {}): Promise<PurchaseOrder[]> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
    return this.orders.listForDepot(depotId, filters.status);
  }

  get(id: string): Promise<PurchaseOrder> {
    return this.require(id);
  }

  /** DRAFT → SENT (submitted to the supplier). */
  async send(id: string): Promise<PurchaseOrder> {
    const po = await this.require(id);
    if (po.status !== PoStatus.DRAFT) {
      throw new InvalidPurchaseOrderTransitionError('Only a DRAFT purchase order can be sent.');
    }
    return this.orders.update(id, { status: PoStatus.SENT });
  }

  /**
   * Book in what actually arrived — all of it, or some of it.
   *
   * CA-2-64: this used to be one button that posted the FULL ordered quantity of every
   * line and stamped the PO RECEIVED. A supplier who sends 40 of 60 galon, which is the
   * ordinary case, left the depot choosing between putting 20 units into the stock ledger
   * that are not in the building, and booking none of the 40 that are. The first is worse:
   * the ledger is what the reorder point, the COGS and the next opname all read.
   *
   * `received` names the quantity arriving NOW per line, keyed by line index. Omitted
   * entirely, it means "everything still outstanding" — the old button's meaning, so the
   * existing caller keeps working and a full delivery is still one press.
   *
   * The PO only reaches RECEIVED when every line is complete. Until then it stays SENT and
   * can be received again; each call posts the delta, never the whole line twice.
   *
   * ponytail: not a single DB transaction across the receipts — a mid-loop crash can leave
   * some lines posted and the PO still SENT. That is now SAFE rather than merely tolerable:
   * re-running posts only what is still outstanding, because the arrived quantity is
   * written back per line.
   */
  async receive(
    id: string,
    actorId: string,
    received?: Record<number, number>,
  ): Promise<PurchaseOrder> {
    const po = await this.require(id);
    if (po.status !== PoStatus.SENT) {
      throw new InvalidPurchaseOrderTransitionError('Only a SENT purchase order can be received.');
    }

    const lines = po.lines.map((line, index) => {
      const already = receivedOf(line);
      const outstanding = line.quantity - already;
      const asked = received ? (received[index] ?? 0) : outstanding;
      if (asked < 0) {
        throw new InvalidPurchaseOrderTransitionError(
          `Line ${index + 1} ("${line.label}"): a received quantity cannot be negative.`,
        );
      }
      if (asked > outstanding) {
        // Booking in more than was ordered is not a rounding question — it is either the
        // wrong PO or a supplier sending goods nobody agreed to buy, and the stock ledger
        // must not be where that gets decided silently.
        throw new InvalidPurchaseOrderTransitionError(
          `Line ${index + 1} ("${line.label}"): ${asked} arriving would exceed the ` +
            `${outstanding} still outstanding of ${line.quantity} ordered.`,
        );
      }
      return { line, index, arriving: asked, next: { ...line, receivedQuantity: already + asked } };
    });

    if (lines.every((l) => l.arriving === 0)) {
      throw new InvalidPurchaseOrderTransitionError(
        'Nothing to receive: every line already has its full ordered quantity booked in.',
      );
    }

    for (const { line, arriving } of lines) {
      if (arriving === 0) continue;
      try {
        await this.inventory.receiveStock(
          po.depotId,
          line.itemType,
          arriving,
          actorId,
          `PO ${po.poNumber} · ${line.label}`,
        );
      } catch (error) {
        // Best-effort: a missing/unconfigured stock line must not fail the whole receipt.
        // Q-4: but it must not be SILENT either. This is the stock ledger — a swallowed
        // line means the PO reads RECEIVED while the goods were never booked in, and the
        // only evidence used to be the discrepancy someone finds at the next opname.
        this.logger.error(
          `PO ${po.poNumber} (depot ${po.depotId}): stock not booked for "${line.label}" ` +
            `×${arriving} — ${(error as Error).message}. Receipt continues; reconcile manually.`,
        );
      }
    }

    const next = lines.map((l) => l.next);
    const complete = isFullyReceived(next);
    return this.orders.update(id, {
      lines: next,
      // Still SENT while anything is outstanding: a PO marked RECEIVED is one nobody
      // chases, and the rest of the delivery is exactly what someone has to chase.
      status: complete ? PoStatus.RECEIVED : PoStatus.SENT,
      receivedAt: complete ? new Date() : null,
    });
  }
}
