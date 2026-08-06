import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { computeTotal, PoLine, PoStatus, PurchaseOrder } from '../../domain/purchase-order';
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
   * SENT → RECEIVED. For each line, add a RECEIPT movement of `quantity` for that itemType
   * into the depot's inventory. Best-effort per line: a line whose depot inventory line does
   * not exist is skipped (try/catch) so goods-in never blocks on an unconfigured stock line;
   * the PO is still marked RECEIVED. ponytail: not a single DB transaction across the receipts
   * — a mid-loop crash could leave some lines posted and the PO still SENT (retry-safe: RECEIPT
   * is additive, so guard against a double-receive by only receiving from SENT).
   */
  async receive(id: string, actorId: string): Promise<PurchaseOrder> {
    const po = await this.require(id);
    if (po.status !== PoStatus.SENT) {
      throw new InvalidPurchaseOrderTransitionError('Only a SENT purchase order can be received.');
    }
    for (const line of po.lines) {
      try {
        await this.inventory.receiveStock(
          po.depotId,
          line.itemType,
          line.quantity,
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
            `×${line.quantity} — ${(error as Error).message}. Receipt continues; reconcile manually.`,
        );
      }
    }
    return this.orders.update(id, { status: PoStatus.RECEIVED, receivedAt: new Date() });
  }
}
