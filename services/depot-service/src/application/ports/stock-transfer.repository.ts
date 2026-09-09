import { StockTransferStatus } from '../../domain/stock-transfer';

export interface StockTransferRecord {
  id: string;
  reference: string;
  fromDepotId: string;
  toDepotId: string;
  productId: string;
  label: string;
  unit: string;
  quantity: number;
  status: StockTransferStatus;
  note: string | null;
  sentBy: string;
  sentAt: Date;
  receivedBy: string | null;
  receivedAt: Date | null;
  cancelReason: string | null;
}

export interface SendTransferData {
  reference: string;
  fromItemId: string;
  fromDepotId: string;
  toDepotId: string;
  productId: string;
  label: string;
  unit: string;
  quantity: number;
  note: string | null;
  sentBy: string;
}

export interface TransferQuery {
  depotId: string;
  /** 'in' = arriving here, 'out' = sent from here. */
  direction: 'in' | 'out';
  status?: StockTransferStatus;
  limit: number;
}

/**
 * CA-2-54 — stock moving between two depots.
 *
 * Every method here is written as ONE database transaction, and that is the whole reason
 * this port exists rather than two calls from the service. A transfer changes two things
 * that must never disagree: a depot's stock, and the record explaining where it went.
 * Deducting stock and then failing to write the transfer row would be stock that vanished;
 * writing the row and failing to deduct would be stock counted in two depots at once.
 */
export interface StockTransferRepository {
  /**
   * Deducts the sender and records the transfer as SENT, atomically.
   *
   * The deduction is floored in the same statement, so a sale landing in the gap between
   * the service's check and this write cannot take the line below zero — it fails the
   * transfer instead.
   */
  send(data: SendTransferData): Promise<StockTransferRecord>;
  /**
   * Credits the receiving line and marks the transfer RECEIVED, atomically.
   *
   * `toItemId` is resolved by the service, which creates the destination line if the
   * receiving depot has never stocked this product. Returns null when the transfer is no
   * longer SENT — somebody else received or cancelled it first, and this must not be a
   * second credit.
   */
  receive(
    transferId: string,
    toItemId: string,
    receivedBy: string,
  ): Promise<StockTransferRecord | null>;
  /**
   * Puts the stock back at the sender and marks the transfer CANCELLED, atomically.
   * Returns null when it is no longer SENT, for the same reason as `receive`.
   */
  cancel(
    transferId: string,
    fromItemId: string,
    reason: string,
    actorId: string,
  ): Promise<StockTransferRecord | null>;
  findById(id: string): Promise<StockTransferRecord | null>;
  list(query: TransferQuery): Promise<StockTransferRecord[]>;
  /** Highest reference minted today, so the next one continues the day's sequence. */
  countSentOn(day: string): Promise<number>;
}
