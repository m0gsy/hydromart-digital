import { Injectable } from '@nestjs/common';

import { WithdrawalRecord, WithdrawalStatus } from '../../domain/ledger';
import {
  CreateWithdrawalData,
  WithdrawalOutcome,
  WithdrawalRepository,
} from '../../application/ports/withdrawal.repository';
import { PrismaService } from './prisma.service';
import { nextReferenceSequence } from './reference-sequence';

interface WithdrawalRow {
  id: string;
  franchiseOwnerId: string;
  amount: unknown; // Prisma Decimal
  bankAccountRef: string;
  status: string;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WithdrawalPrismaRepository implements WithdrawalRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextReferenceSequence(): Promise<number> {
    return nextReferenceSequence(this.prisma);
  }

  private toWithdrawal(row: WithdrawalRow): WithdrawalRecord {
    return {
      id: row.id,
      franchiseOwnerId: row.franchiseOwnerId,
      amount: Number(row.amount),
      bankAccountRef: row.bankAccountRef,
      status: row.status as WithdrawalStatus,
      reference: row.reference,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateWithdrawalData): Promise<WithdrawalRecord> {
    const row = await this.prisma.withdrawal.create({ data });
    return this.toWithdrawal(row as unknown as WithdrawalRow);
  }

  async withdrawWithDebit(input: {
    franchiseOwnerId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<WithdrawalOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // The balance is a SUM over ledger rows, so there is no row to lock FOR UPDATE. This
      // advisory lock is released when the transaction ends and is keyed on the owner, so
      // concurrent withdrawals for one owner queue up while different owners run freely.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.franchiseOwnerId}, 0))`;

      const agg = await tx.ledgerEntry.aggregate({
        where: { franchiseOwnerId: input.franchiseOwnerId },
        _sum: { amount: true },
      });
      const balance = Number(agg._sum.amount ?? 0);
      if (input.amount > balance) {
        return { ok: false as const, balance };
      }

      const row = await tx.withdrawal.create({
        data: {
          franchiseOwnerId: input.franchiseOwnerId,
          amount: input.amount,
          bankAccountRef: input.bankAccountRef,
          reference: input.reference,
          status: input.status,
        },
      });
      // Same transaction as the withdrawal: a crash between the two can no longer leave a
      // PROCESSING payout with the balance still showing as available.
      await tx.ledgerEntry.create({
        data: {
          franchiseOwnerId: input.franchiseOwnerId,
          depotId: null,
          type: 'WITHDRAWAL',
          amount: -input.amount,
          description: input.description,
        },
      });
      return { ok: true as const, withdrawal: this.toWithdrawal(row as unknown as WithdrawalRow) };
    });
  }

  async listForOwner(franchiseOwnerId: string, limit: number): Promise<WithdrawalRecord[]> {
    const rows = await this.prisma.withdrawal.findMany({
      where: { franchiseOwnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toWithdrawal(r as unknown as WithdrawalRow));
  }
}
