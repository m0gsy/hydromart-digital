import { Injectable } from '@nestjs/common';

import {
  BankAccountStatus,
  PayoutBankAccountRecord,
  PayoutBankAccountRepository,
  RegisterBankAccountData,
} from '../../application/ports/bank-account.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PayoutBankAccountPrismaRepository implements PayoutBankAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: unknown): PayoutBankAccountRecord {
    return row as PayoutBankAccountRecord;
  }

  async upsert(data: RegisterBankAccountData): Promise<PayoutBankAccountRecord> {
    // A replacement account is a new destination, so it goes back to PENDING and loses the
    // previous verification — otherwise re-registering would inherit somebody else's tick.
    const fresh = {
      ...data,
      status: 'PENDING' as const,
      verifiedBy: null,
      verifiedAt: null,
      rejectedReason: null,
    };
    const row = await this.prisma.payoutBankAccount.upsert({
      where: { subjectId: data.subjectId },
      create: fresh,
      update: fresh,
    });
    return this.toRecord(row);
  }

  async findBySubject(subjectId: string): Promise<PayoutBankAccountRecord | null> {
    const row = await this.prisma.payoutBankAccount.findUnique({ where: { subjectId } });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<PayoutBankAccountRecord | null> {
    const row = await this.prisma.payoutBankAccount.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listByStatus(status: BankAccountStatus, limit: number): Promise<PayoutBankAccountRecord[]> {
    const rows = await this.prisma.payoutBankAccount.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async decide(
    id: string,
    data: { status: 'VERIFIED' | 'REJECTED'; verifiedBy: string; rejectedReason: string | null },
  ): Promise<PayoutBankAccountRecord | null> {
    // The PENDING guard is in the WHERE clause: two reviewers cannot both decide it.
    const { count } = await this.prisma.payoutBankAccount.updateMany({
      where: { id, status: 'PENDING' },
      data: { ...data, verifiedAt: new Date() },
    });
    return count === 0 ? null : this.findById(id);
  }
}
