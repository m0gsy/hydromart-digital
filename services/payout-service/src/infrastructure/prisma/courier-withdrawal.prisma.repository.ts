import { Injectable } from '@nestjs/common';

import { WithdrawalStatus } from '../../domain/ledger';
import {
  CourierWithdrawalRecord,
  CourierWithdrawalRepository,
  CreateCourierWithdrawalData,
} from '../../application/ports/courier-withdrawal.repository';
import { PrismaService } from './prisma.service';

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

  async listForCourier(courierId: string, limit: number): Promise<CourierWithdrawalRecord[]> {
    const rows = await this.prisma.courierWithdrawal.findMany({
      where: { courierId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toWithdrawal(r as unknown as WithdrawalRow));
  }
}
