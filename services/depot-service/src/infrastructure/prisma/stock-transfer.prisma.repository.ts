import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import { NegativeStockError } from '../../domain/errors';
import { StockMovementType } from '../../domain/inventory';
import { StockTransferStatus } from '../../domain/stock-transfer';
import {
  SendTransferData,
  StockTransferRecord,
  StockTransferRepository,
  TransferQuery,
} from '../../application/ports/stock-transfer.repository';
import { PrismaService } from './prisma.service';

interface TransferRow {
  id: string;
  reference: string;
  fromDepotId: string;
  toDepotId: string;
  productId: string;
  label: string;
  unit: string;
  quantity: number;
  status: string;
  note: string | null;
  sentBy: string;
  sentAt: Date;
  receivedBy: string | null;
  receivedAt: Date | null;
  cancelReason: string | null;
}

interface ItemRow {
  id: string;
  quantity: number;
}

@Injectable()
export class StockTransferPrismaRepository implements StockTransferRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: TransferRow): StockTransferRecord {
    return { ...row, status: row.status as StockTransferStatus };
  }

  /**
   * CA-2-54: the deduction, its movement row and the transfer record, in one transaction.
   *
   * The floor lives in the UPDATE itself — `quantity - qty >= 0` — so a sale landing between
   * the service's check and this write cannot take the line negative. It fails the transfer
   * instead, which is the safe direction: the sender keeps stock they were about to lose.
   */
  async send(data: SendTransferData): Promise<StockTransferRecord> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ItemRow[]>(Prisma.sql`
        UPDATE "inventory_items"
           SET "quantity" = "quantity" - ${data.quantity}, "updatedAt" = NOW()
         WHERE "id" = ${data.fromItemId}::uuid
           AND "quantity" - ${data.quantity} >= 0
        RETURNING "id", "quantity"
      `);
      const row = rows[0];
      if (!row) throw new NegativeStockError();

      await tx.stockMovement.create({
        data: {
          itemId: data.fromItemId,
          type: StockMovementType.TRANSFER_OUT,
          delta: -data.quantity,
          quantityBefore: row.quantity + data.quantity,
          quantityAfter: row.quantity,
          reason: `Transfer ${data.reference} → depot ${data.toDepotId}`,
          actorId: data.sentBy,
        },
      });

      const transfer = await tx.stockTransfer.create({
        data: {
          reference: data.reference,
          fromDepotId: data.fromDepotId,
          toDepotId: data.toDepotId,
          productId: data.productId,
          label: data.label,
          unit: data.unit,
          quantity: data.quantity,
          note: data.note,
          sentBy: data.sentBy,
        },
      });
      return this.toRecord(transfer as unknown as TransferRow);
    });
  }

  /**
   * The credit and the status change together. The status is moved with a WHERE on SENT,
   * so two receivers pressing at once produce one credit: the loser updates no row, gets
   * null back, and the caller reports it as already handled instead of crediting twice.
   */
  async receive(
    transferId: string,
    toItemId: string,
    receivedBy: string,
  ): Promise<StockTransferRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: transferId, status: StockTransferStatus.SENT },
        data: {
          status: StockTransferStatus.RECEIVED,
          receivedBy,
          receivedAt: new Date(),
        },
      });
      if (claimed.count === 0) return null;

      const transfer = (await tx.stockTransfer.findUnique({
        where: { id: transferId },
      })) as unknown as TransferRow;

      const rows = await tx.$queryRaw<ItemRow[]>(Prisma.sql`
        UPDATE "inventory_items"
           SET "quantity" = "quantity" + ${transfer.quantity}, "updatedAt" = NOW()
         WHERE "id" = ${toItemId}::uuid
        RETURNING "id", "quantity"
      `);
      const row = rows[0];
      if (!row) throw new NegativeStockError();

      await tx.stockMovement.create({
        data: {
          itemId: toItemId,
          type: StockMovementType.TRANSFER_IN,
          delta: transfer.quantity,
          quantityBefore: row.quantity - transfer.quantity,
          quantityAfter: row.quantity,
          reason: `Transfer ${transfer.reference} ← depot ${transfer.fromDepotId}`,
          actorId: receivedBy,
        },
      });
      return this.toRecord(transfer);
    });
  }

  /** The mirror of `receive`, crediting the SENDER back. Same single-claim rule. */
  async cancel(
    transferId: string,
    fromItemId: string,
    reason: string,
    actorId: string,
  ): Promise<StockTransferRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({
        where: { id: transferId, status: StockTransferStatus.SENT },
        data: { status: StockTransferStatus.CANCELLED, cancelReason: reason },
      });
      if (claimed.count === 0) return null;

      const transfer = (await tx.stockTransfer.findUnique({
        where: { id: transferId },
      })) as unknown as TransferRow;

      const rows = await tx.$queryRaw<ItemRow[]>(Prisma.sql`
        UPDATE "inventory_items"
           SET "quantity" = "quantity" + ${transfer.quantity}, "updatedAt" = NOW()
         WHERE "id" = ${fromItemId}::uuid
        RETURNING "id", "quantity"
      `);
      const row = rows[0];
      if (!row) throw new NegativeStockError();

      await tx.stockMovement.create({
        data: {
          itemId: fromItemId,
          type: StockMovementType.TRANSFER_IN,
          delta: transfer.quantity,
          quantityBefore: row.quantity - transfer.quantity,
          quantityAfter: row.quantity,
          reason: `Transfer ${transfer.reference} dibatalkan: ${reason}`,
          actorId,
        },
      });
      return this.toRecord(transfer);
    });
  }

  async findById(id: string): Promise<StockTransferRecord | null> {
    const row = (await this.prisma.stockTransfer.findUnique({
      where: { id },
    })) as unknown as TransferRow | null;
    return row ? this.toRecord(row) : null;
  }

  async list(query: TransferQuery): Promise<StockTransferRecord[]> {
    const rows = (await this.prisma.stockTransfer.findMany({
      where: {
        ...(query.direction === 'in'
          ? { toDepotId: query.depotId }
          : { fromDepotId: query.depotId }),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: query.limit,
    })) as unknown as TransferRow[];
    return rows.map((r) => this.toRecord(r));
  }

  async countSentOn(day: string): Promise<number> {
    return this.prisma.stockTransfer.count({
      where: {
        sentAt: {
          gte: new Date(`${day}T00:00:00.000Z`),
          lt: new Date(`${day}T23:59:59.999Z`),
        },
      },
    });
  }
}
