import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, localDayKey } from '@hydromart/platform';

import {
  InsufficientStockError,
  InventoryItemNotFoundError,
  TransferNotFoundError,
  TransferNotPendingError,
  TransferSameDepotError,
} from '../../domain/errors';
import { InventoryItemType } from '../../domain/inventory';
import { StockTransferStatus, transferReference } from '../../domain/stock-transfer';
import { InventoryRepository } from '../ports/inventory.repository';
import { StockTransferRecord, StockTransferRepository } from '../ports/stock-transfer.repository';
import { DEPOT_TOKENS } from '../tokens';
import { DepotConfigService } from '../../config/depot-config.service';

export interface SendTransferInput {
  fromDepotId: string;
  toDepotId: string;
  productId: string;
  quantity: number;
  note?: string;
}

/**
 * CA-2-54 — stock moving between two depots.
 *
 * The only way stock could enter a depot was a purchase order to a supplier. A depot with
 * four spare gallons, and one two streets away that had run out, could do nothing about it
 * on the system: the transfer everyone already does in practice — on a motorbike — had no
 * record at all, so it showed up as a shortfall in one book and an unexplained surplus in
 * the other, and opname absorbed the difference twice a month.
 *
 * Two steps, not one, because a transfer is not instantaneous. SENT deducts the sender
 * (they genuinely no longer have it) and RECEIVED credits the receiver only once somebody
 * there has counted what arrived. What sits between the two is visible as in transit,
 * instead of being missing from both books at once.
 */
@Injectable()
export class StockTransferService {
  constructor(
    @Inject(DEPOT_TOKENS.StockTransferRepository) private readonly transfers: StockTransferRepository,
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    private readonly config: DepotConfigService,
  ) {}

  /**
   * The sender dispatches. Stock leaves here now.
   *
   * Scoped on the SENDING depot: giving stock away is the sender's decision, and a depot
   * operator can only give away their own. The receiving depot is not asked for permission
   * — it is asked to count what arrives, which is what `receive` is.
   */
  async send(
    user: AuthenticatedUser,
    actorId: string,
    input: SendTransferInput,
  ): Promise<StockTransferRecord> {
    assertDepotAccess(user, input.fromDepotId);
    if (input.fromDepotId === input.toDepotId) throw new TransferSameDepotError();

    const line = await this.inventory.findLine(
      input.fromDepotId,
      InventoryItemType.PRODUK,
      input.productId,
    );
    if (!line) throw new InventoryItemNotFoundError();

    /*
     * Measured against AVAILABLE, not against quantity. `reserved` is stock already promised
     * to orders this depot has taken; shipping it away would turn somebody's paid order into
     * a shortfall at the depot that promised it. The repository floors on quantity as well,
     * which catches the concurrent case this read cannot.
     */
    const available = line.quantity - line.reserved;
    if (available < input.quantity) {
      throw new InsufficientStockError([
        { productId: input.productId, requested: input.quantity, available },
      ]);
    }

    const day = localDayKey(new Date(), this.config.businessTimeZone);
    const reference = transferReference(day, (await this.transfers.countSentOn(day)) + 1);

    return this.transfers.send({
      reference,
      fromItemId: line.id,
      fromDepotId: input.fromDepotId,
      toDepotId: input.toDepotId,
      productId: input.productId,
      label: line.label,
      unit: line.unit,
      quantity: input.quantity,
      note: input.note ?? null,
      sentBy: actorId,
    });
  }

  /**
   * The receiver counts it in. Scoped on the RECEIVING depot — only the people who can see
   * the goods may say they arrived.
   *
   * A depot that has never stocked this product has no line to credit, so one is created.
   * Its label and unit come from the transfer rather than the catalog: they are what the
   * sender actually counted out, and they still read correctly after a product is renamed.
   */
  async receive(
    user: AuthenticatedUser,
    actorId: string,
    transferId: string,
  ): Promise<StockTransferRecord> {
    const transfer = await this.load(transferId);
    assertDepotAccess(user, transfer.toDepotId);
    if (transfer.status !== StockTransferStatus.SENT) throw new TransferNotPendingError();

    const existing = await this.inventory.findLine(
      transfer.toDepotId,
      InventoryItemType.PRODUK,
      transfer.productId,
    );
    const line =
      existing ??
      (await this.inventory.create({
        depotId: transfer.toDepotId,
        itemType: InventoryItemType.PRODUK,
        productId: transfer.productId,
        label: transfer.label,
        unit: transfer.unit,
        quantity: 0,
        minimumStock: 0,
      }));

    const received = await this.transfers.receive(transferId, line.id, actorId);
    // Null means somebody else received or cancelled it first. Two people pressing at once
    // must produce one credit, so the loser is told the truth rather than crediting again.
    if (!received) throw new TransferNotPendingError();
    return received;
  }

  /**
   * It never arrived, and the stock goes back where it came from.
   *
   * Scoped on the SENDER: they are the ones who still have to account for goods that left
   * their shelf, and the receiver refusing something is not the same as it being returned.
   */
  async cancel(
    user: AuthenticatedUser,
    actorId: string,
    transferId: string,
    reason: string,
  ): Promise<StockTransferRecord> {
    const transfer = await this.load(transferId);
    assertDepotAccess(user, transfer.fromDepotId);
    if (transfer.status !== StockTransferStatus.SENT) throw new TransferNotPendingError();

    const line = await this.inventory.findLine(
      transfer.fromDepotId,
      InventoryItemType.PRODUK,
      transfer.productId,
    );
    if (!line) throw new InventoryItemNotFoundError();

    const cancelled = await this.transfers.cancel(transferId, line.id, reason, actorId);
    if (!cancelled) throw new TransferNotPendingError();
    return cancelled;
  }

  /** What is coming to this depot, or what it has sent. Depot-scoped either way. */
  async list(
    user: AuthenticatedUser,
    depotId: string,
    direction: 'in' | 'out',
    status?: StockTransferStatus,
    limit = 50,
  ): Promise<StockTransferRecord[]> {
    assertDepotAccess(user, depotId);
    return this.transfers.list({ depotId, direction, status, limit });
  }

  private async load(id: string): Promise<StockTransferRecord> {
    const transfer = await this.transfers.findById(id);
    if (!transfer) throw new TransferNotFoundError();
    return transfer;
  }
}
