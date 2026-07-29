import { Injectable } from '@nestjs/common';

import { ConsentPurpose, ConsentRecord } from '../../../domain/data-subject/consent';
import {
  ConsentRepository,
  RecordConsentData,
} from '../../../application/ports/consent.repository';
import { PrismaService } from '../prisma.service';

type Row = {
  id: string;
  customerId: string;
  purpose: string;
  granted: boolean;
  documentVersion: string;
  source: string;
  recordedAt: Date;
};

@Injectable()
export class ConsentPrismaRepository implements ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: RecordConsentData): Promise<ConsentRecord> {
    return this.toRecord(await this.prisma.consentRecord.create({ data }));
  }

  async recordMany(entries: RecordConsentData[]): Promise<ConsentRecord[]> {
    if (entries.length === 0) return [];
    // One transaction: a registration that recorded TERMS but crashed before PRIVACY
    // would leave an account whose consent evidence is half-missing.
    const rows = await this.prisma.$transaction(
      entries.map((data) => this.prisma.consentRecord.create({ data })),
    );
    return rows.map((r) => this.toRecord(r));
  }

  async listForCustomer(customerId: string): Promise<ConsentRecord[]> {
    const rows = await this.prisma.consentRecord.findMany({
      where: { customerId },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: Row): ConsentRecord {
    return { ...row, purpose: row.purpose as ConsentPurpose };
  }
}
