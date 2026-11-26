import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  ComplianceSource,
  EndHoldData,
  NewLabTest,
  NewPermit,
  QualityHoldRepository,
  StartHoldData,
} from '../../application/ports/quality-hold.repository';
import { LabTest, Permit, QualityHold, qualityHoldChanged } from '../../domain/quality-hold';
import { PrismaService } from './prisma.service';

/** The event row, written inside the transaction that owes it. */
async function recordEvent(tx: Prisma.TransactionClient, hold: QualityHold, at: Date): Promise<void> {
  const event = qualityHoldChanged(hold.id, hold.depotId, hold.status, at);
  await tx.webhookEventOutbox.create({ data: { ...event, payload: event.payload as Prisma.InputJsonValue } });
}

/** HD-14: holds, lab tests and permits. */
@Injectable()
export class QualityHoldPrismaRepository implements QualityHoldRepository {
  constructor(private readonly prisma: PrismaService) {}

  async start(data: StartHoldData): Promise<QualityHold | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const hold = (await tx.depotQualityHold.create({
          data: {
            depotId: data.depotId,
            reasonCode: data.reasonCode,
            note: data.note,
            startedBy: data.startedBy,
            startedAt: data.at,
          },
        })) as QualityHold;
        await recordEvent(tx, hold, data.at);
        return hold;
      });
    } catch (error) {
      // The partial unique index is the real guard against two ACTIVE holds on one depot.
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    }
  }

  async end(data: EndHoldData): Promise<QualityHold | null> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.depotQualityHold.findFirst({ where: { depotId: data.depotId, status: 'ACTIVE' } });
      if (!active) return null;
      // Guarded again at the write: a concurrent end that got in between loses.
      const { count } = await tx.depotQualityHold.updateMany({
        where: { id: active.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endedBy: data.endedBy, endedAt: data.at, endRetestId: data.endRetestId },
      });
      if (count === 0) return null;
      const hold = (await tx.depotQualityHold.findUniqueOrThrow({ where: { id: active.id } })) as QualityHold;
      await recordEvent(tx, hold, data.at);
      return hold;
    });
  }

  async findActive(depotId: string): Promise<QualityHold | null> {
    return (await this.prisma.depotQualityHold.findFirst({ where: { depotId, status: 'ACTIVE' } })) as QualityHold | null;
  }

  async history(depotId: string): Promise<QualityHold[]> {
    return (await this.prisma.depotQualityHold.findMany({
      where: { depotId },
      orderBy: { startedAt: 'desc' },
    })) as QualityHold[];
  }

  async addLabTest(data: NewLabTest): Promise<LabTest> {
    return (await this.prisma.depotLabTest.create({ data })) as LabTest;
  }

  async findLabTest(id: string): Promise<LabTest | null> {
    return (await this.prisma.depotLabTest.findUnique({ where: { id } })) as LabTest | null;
  }

  async listLabTests(depotId: string): Promise<LabTest[]> {
    return (await this.prisma.depotLabTest.findMany({
      where: { depotId },
      orderBy: [{ takenOn: 'desc' }, { createdAt: 'desc' }],
    })) as LabTest[];
  }

  async addPermit(data: NewPermit): Promise<Permit> {
    return this.prisma.depotPermit.create({ data });
  }

  async listPermits(depotId: string): Promise<Permit[]> {
    return this.prisma.depotPermit.findMany({ where: { depotId }, orderBy: { validUntil: 'desc' } });
  }

  async complianceSource(): Promise<ComplianceSource> {
    const active = { depot: { active: true } };
    const [depots, tests, permits] = await Promise.all([
      this.prisma.depot.findMany({ where: { active: true }, select: { id: true, name: true, createdAt: true } }),
      this.prisma.depotLabTest.findMany({ where: active, select: { depotId: true, kind: true, takenOn: true } }),
      this.prisma.depotPermit.findMany({ where: active }),
    ]);
    return { depots, tests, permits };
  }
}
