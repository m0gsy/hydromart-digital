// Depot purchase orders (design 7a/9d). A PO is drafted, sent to a supplier, then received —
// receiving posts a RECEIPT stock movement per line into the depot's inventory.
// Mirrors the Prisma model; the domain never imports the generated client.

import { InventoryItemType } from './inventory';

export enum PoStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
}

/** One ordered line: a stock type, its label, quantity, and unit cost (whole IDR). */
export interface PoLine {
  itemType: InventoryItemType;
  label: string;
  quantity: number;
  unitCostIdr: number;
  /**
   * CA-2-64: how much of this line has actually arrived.
   *
   * Receiving was all-or-nothing — one button that booked in the FULL ordered quantity of
   * every line and stamped the PO RECEIVED. A supplier who sends 40 of 60 galon, which is
   * the ordinary case, left the depot with two bad choices: press it and put 20 units of
   * stock into the ledger that are not in the building, or leave the PO open and book none
   * of the 40 that are.
   *
   * Absent on every PO written before this shipped, and read as 0 — the same thing it
   * meant then. `lines` is a JSON column, so this needed no migration; what it did need is
   * for every reader to treat the field as optional, which `receivedOf` below does.
   */
  receivedQuantity?: number;
  /**
   * CA-2-55: why the rest of this line is not coming.
   *
   * CA-2-64 let the receiver book what actually arrived, but the difference was left as an
   * implicit subtraction with no reason attached and no way to end. A supplier who sends 40
   * of 60 and cancels the balance left the PO in SENT forever: `receive()` refuses once
   * every line is at its cap, and a full receipt was the only route to RECEIVED.
   *
   * Owner decision 2026-09-04: the receiver types what came, and the shortfall is recorded
   * as a short delivery WITH a note. The note is what makes the line final — see
   * `isFullyReceived`. No note means today's meaning exactly: the balance is still coming.
   *
   * Rides the same JSON `lines` column as `receivedQuantity`, under the same rule: optional
   * on read, absent on every historical row, and absent means "no shortfall recorded".
   */
  shortfallNote?: string;
}

/** How much of a line has arrived. Old rows carry no field at all; that is zero, not null. */
export function receivedOf(line: PoLine): number {
  return Math.max(0, Math.min(line.quantity, line.receivedQuantity ?? 0));
}

/** A line the receiver has closed short, with the reason the balance is not coming (CA-2-55). */
export function isShortClosed(line: PoLine): boolean {
  return receivedOf(line) < line.quantity && !!line.shortfallNote?.trim();
}

/**
 * True once every line is finished — either fully booked in, or closed short with a note.
 *
 * The whole terminal-state design is this one predicate: no new status, no new enum, no
 * migration. A line with no note behaves exactly as it did before CA-2-55, so no historical
 * PO changes state on deploy.
 */
export function isFullyReceived(lines: PoLine[]): boolean {
  return lines.length > 0 && lines.every((l) => receivedOf(l) >= l.quantity || isShortClosed(l));
}

export interface PurchaseOrder {
  id: string;
  depotId: string;
  poNumber: string;
  supplierId: string;
  /** Denormalized supplier name snapshot (list/detail without a join). */
  supplierName: string;
  status: PoStatus;
  lines: PoLine[];
  subtotalIdr: number;
  shippingIdr: number;
  totalIdr: number;
  expectedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

/** Pure: subtotal (Σ qty×unitCost) + shipping = total. Used at create time and in tests. */
export function computeTotal(
  lines: PoLine[],
  shippingIdr: number,
): { subtotalIdr: number; totalIdr: number } {
  const subtotalIdr = lines.reduce((sum, l) => sum + l.quantity * l.unitCostIdr, 0);
  return { subtotalIdr, totalIdr: subtotalIdr + shippingIdr };
}
