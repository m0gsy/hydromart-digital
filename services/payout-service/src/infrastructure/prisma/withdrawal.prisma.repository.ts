import { Injectable } from '@nestjs/common';

import { WithdrawalRecord, WithdrawalStatus } from '../../domain/ledger';
import {
  CreateWithdrawalData,
  WithdrawalRepository,
} from '../../application/ports/withdrawal.repository';
import { PrismaService } from './prisma.service';

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

  async listForOwner(franchiseOwnerId: string, limit: number): Promise<WithdrawalRecord[]> {
    const rows = await this.prisma.withdrawal.findMany({
      where: { franchiseOwnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toWithdrawal(r as unknown as WithdrawalRow));
  }
}
