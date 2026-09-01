import { Injectable } from '@nestjs/common';

import { WithdrawalStatus } from '../../domain/ledger';
import {
  CourierWithdrawalRecord,
  CourierWithdrawalOutcome,
  CourierWithdrawalRepository,
  CreateCourierWithdrawalData,
} from '../../application/ports/courier-withdrawal.repository';
import { SettleWithdrawalOutcome } from '../../application/ports/withdrawal.repository';
import { PrismaService } from './prisma.service';
import { nextReferenceSequence } from './reference-sequence';

interface WithdrawalRow {
  id: string;
  courierId: string;
  amount: unknown; // Prisma Decimal
  bankAccountRef: string;
  status: string;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CourierWithdrawalPrismaRepository implements CourierWithdrawalRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextReferenceSequence(): Promise<number> {
    return nextReferenceSequence(this.prisma);
  }

  private toWithdrawal(row: WithdrawalRow): CourierWithdrawalRecord {
    return {
      id: row.id,
      courierId: row.courierId,
      amount: Number(row.amount),
      bankAccountRef: row.bankAccountRef,
      status: row.status as WithdrawalStatus,
      reference: row.reference,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateCourierWithdrawalData): Promise<CourierWithdrawalRecord> {
    const row = await this.prisma.courierWithdrawal.create({ data });
    return this.toWithdrawal(row as unknown as WithdrawalRow);
  }

  async withdrawWithDebit(input: {
    courierId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<CourierWithdrawalOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // Balance is a SUM over ledger rows, so there is nothing to lock FOR UPDATE. This
      // advisory lock ends with the transaction and is keyed on the courier, so one
      // courier's withdrawals queue while other couriers run unblocked.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.courierId}, 0))`;

      const agg = await tx.courierLedgerEntry.aggregate({
        where: { courierId: input.courierId },
        _sum: { amount: true },
      });
      const balance = Number(agg._sum.amount ?? 0);
      if (input.amount > balance) {
        return { ok: false as const, balance };
      }

      const row = await tx.courierWithdrawal.create({
        data: {
          courierId: input.courierId,
          amount: input.amount,
          bankAccountRef: input.bankAccountRef,
          reference: input.reference,
          status: input.status,
        },
      });
      await tx.courierLedgerEntry.create({
        data: {
          courierId: input.courierId,
          depotId: null,
          type: 'WITHDRAWAL',
          amount: -input.amount,
          description: input.description,
          // B-10: the only courier ledger write that had no idempotency key. The reference
          // is unique per withdrawal, so a retry collides on sourceRef instead of debiting
          // the courier a second time.
          sourceRef: `withdrawal:${input.reference}`,
        },
      });
      return { ok: true as const, withdrawal: this.toWithdrawal(row as unknown as WithdrawalRow) };
    });
  }

  async listProcessing(limit: number): Promise<CourierWithdrawalRecord[]> {
    const rows = await this.prisma.courierWithdrawal.findMany({
      where: { status: 'PROCESSING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toWithdrawal(r as unknown as WithdrawalRow));
  }

  async settle(input: {
    id: string;
    status: Extract<WithdrawalStatus, 'PAID' | 'FAILED'>;
    reversal: { sourceRef: string; description: string };
  }): Promise<SettleWithdrawalOutcome<CourierWithdrawalRecord>> {
    return this.prisma.$transaction(async (tx) => {
      const current = (await tx.courierWithdrawal.findUnique({
        where: { id: input.id },
      })) as unknown as WithdrawalRow | null;
      if (!current) return { ok: false as const, reason: 'NOT_FOUND' as const };
      if (current.status !== 'PROCESSING') {
        return {
          ok: false as const,
          reason: 'NOT_PROCESSING' as const,
          status: current.status as WithdrawalStatus,
        };
      }

      const row = await tx.courierWithdrawal.update({
        where: { id: input.id },
        data: { status: input.status },
      });

      if (input.status === 'FAILED') {
        // Same rule as the franchise ledger: the WITHDRAWAL debit already went out, so a
        // rejected transfer has to come back inside this transaction. `sourceRef` is unique,
        // so settling twice credits once.
        await tx.courierLedgerEntry.create({
          data: {
            courierId: current.courierId,
            depotId: null,
            type: 'ADJUSTMENT',
            amount: Number(current.amount),
            description: input.reversal.description,
            sourceRef: input.reversal.sourceRef,
          },
        });
      }
      return { ok: true as const, withdrawal: this.toWithdrawal(row as unknown as WithdrawalRow) };
    });
  }

  async listForCourier(courierId: string, limit: number): Promise<CourierWithdrawalRecord[]> {
    const rows = await this.prisma.courierWithdrawal.findMany({
      where: { courierId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toWithdrawal(r as unknown as WithdrawalRow));
  }
}
