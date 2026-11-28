import { Injectable } from '@nestjs/common';

import {
  WaConsentInput,
  WaConsentRecord,
  WaConsentRepository,
  WaOptInCodeRecord,
} from '../../application/ports/wa.repository';
import { PrismaService } from './prisma.service';

const CODE_FIELDS = {
  id: true,
  code: true,
  kind: true,
  customerId: true,
  depotId: true,
  createdBy: true,
  expiresAt: true,
  usedAt: true,
  usedPhone: true,
} as const;

/** HD-12/HD-13: the per-number consent ledger, the opt-in codes and the AI web peer stamp. */
@Injectable()
export class WaConsentPrismaRepository implements WaConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: WaConsentInput): Promise<boolean> {
    // ON CONFLICT DO NOTHING on (source, sourceRef): a replayed webhook or AI web item is a no-op.
    const { count } = await this.prisma.waConsent.createMany({ data: [input], skipDuplicates: true });
    return count === 1;
  }

  listForPhone(phone: string): Promise<WaConsentRecord[]> {
    return this.prisma.waConsent.findMany({ where: { phone }, orderBy: { seq: 'asc' }, take: 1000 });
  }

  listForPhones(phones: string[]): Promise<WaConsentRecord[]> {
    return this.prisma.waConsent.findMany({ where: { phone: { in: phones } }, orderBy: { seq: 'asc' }, take: 5000 });
  }

  listUtilityForCustomer(customerId: string): Promise<WaConsentRecord[]> {
    return this.prisma.waConsent.findMany({
      where: { customerId, purpose: 'UTILITY', waNumber: '1' },
      orderBy: { seq: 'asc' },
      take: 1000,
    });
  }

  /** Not commit-ordered: see the contract on the port (callers re-read an overlap window and dedupe on id). */
  listAfter(afterSeq: bigint, limit: number): Promise<WaConsentRecord[]> {
    return this.prisma.waConsent.findMany({
      where: { seq: { gt: afterSeq }, NOT: { source: 'AIWEB' } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
  }

  createCode(input: {
    code: string;
    kind: string;
    customerId: string | null;
    depotId: string | null;
    createdBy: string;
    expiresAt: Date;
  }): Promise<WaOptInCodeRecord> {
    return this.prisma.waOptInCode.create({ data: input, select: CODE_FIELDS });
  }

  findCode(code: string): Promise<WaOptInCodeRecord | null> {
    return this.prisma.waOptInCode.findUnique({ where: { code }, select: CODE_FIELDS });
  }

  findCodeById(id: string): Promise<WaOptInCodeRecord | null> {
    return this.prisma.waOptInCode.findUnique({ where: { id }, select: CODE_FIELDS });
  }

  async claimCode(code: string, phone: string, now: Date): Promise<WaOptInCodeRecord | null> {
    const { count } = await this.prisma.waOptInCode.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, usedPhone: phone },
    });
    return count === 1 ? this.findCode(code) : null;
  }

  async peerLastOkAt(peer: string): Promise<Date | null> {
    const row = await this.prisma.waPeerState.findUnique({ where: { peer } });
    return row ? row.lastOkAt : null;
  }

  async purgeBefore(cutoff: Date): Promise<number> {
    // Newest row per phone by seq; only a phone whose newest row is a grant and old enough is deleted.
    return this.prisma.$executeRaw`DELETE FROM "wa_consents" WHERE "phone" IN (
      SELECT "phone" FROM (SELECT DISTINCT ON ("phone") "phone", "granted", "recordedAt" FROM "wa_consents" ORDER BY "phone", "seq" DESC) n
      WHERE n."granted" = true AND n."recordedAt" < ${cutoff})`;
  }

  async stampPeer(peer: string, now: Date, lastSeq: bigint): Promise<void> {
    await this.prisma.waPeerState.upsert({
      where: { peer },
      create: { peer, lastOkAt: now, lastSeq },
      update: { lastOkAt: now, lastSeq },
    });
  }
}
