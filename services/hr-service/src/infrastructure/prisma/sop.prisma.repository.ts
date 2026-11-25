import { Injectable } from '@nestjs/common';

import { Sop } from '../../../prisma/generated/client';
import {
  SopListRow,
  SopRepository,
  SopVersionWithDepots,
  SopVersionWrite,
  SopWithVersions,
} from '../../application/ports/sop.repository';
import { PrismaService } from './prisma.service';

/** Every column of a version except `body`. */
const noBody = {
  id: true,
  sopId: true,
  versionNo: true,
  title: true,
  fileKey: true,
  fileName: true,
  sizeBytes: true,
  effectiveFrom: true,
  allDepots: true,
  audienceSize: true,
  publishedBy: true,
  createdAt: true,
  depots: { select: { depotId: true } },
} as const;

const withDepots = { depots: { select: { depotId: true } } } as const;

function versionData({ depotIds, ...rest }: SopVersionWrite) {
  return { ...rest, depots: { create: depotIds.map((depotId) => ({ depotId })) } };
}

@Injectable()
export class SopPrismaRepository implements SopRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(title: string, createdBy: string | null, version: SopVersionWrite): Promise<SopWithVersions> {
    return this.prisma.sop.create({
      data: { title, createdBy, versions: { create: { versionNo: 1, ...versionData(version) } } },
      include: { versions: { include: withDepots, orderBy: { versionNo: 'desc' } } },
    });
  }

  addVersion(sopId: string, version: SopVersionWrite): Promise<SopVersionWithDepots | null> {
    return this.prisma.$transaction(async (tx) => {
      const sop = await tx.sop.findUnique({ where: { id: sopId }, select: { id: true } });
      if (!sop) return null;
      const last = await tx.sopVersion.aggregate({ where: { sopId }, _max: { versionNo: true } });
      return tx.sopVersion.create({
        data: { sopId, versionNo: (last._max.versionNo ?? 0) + 1, ...versionData(version) },
        include: withDepots,
      });
    });
  }

  findById(id: string): Promise<SopWithVersions | null> {
    return this.prisma.sop.findUnique({
      where: { id },
      include: { versions: { include: withDepots, orderBy: { versionNo: 'desc' } } },
    });
  }

  list(): Promise<SopListRow[]> {
    return this.prisma.sop.findMany({
      orderBy: { createdAt: 'desc' },
      include: { versions: { select: noBody, orderBy: { versionNo: 'desc' } } },
    });
  }

  findVersion(versionId: string): Promise<(SopVersionWithDepots & { sop: Sop }) | null> {
    return this.prisma.sopVersion.findUnique({
      where: { id: versionId },
      include: { ...withDepots, sop: true },
    });
  }

  listVersions(sopIds: readonly string[]): Promise<(SopVersionWithDepots & { sop: Sop })[]> {
    return this.prisma.sopVersion.findMany({
      where: { sopId: { in: [...sopIds] } },
      include: { ...withDepots, sop: true },
      orderBy: { versionNo: 'desc' },
    });
  }

  async countAcks(versionIds: readonly string[]): Promise<Map<string, number>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.prisma.sopAck.groupBy({
      by: ['versionId'],
      where: { versionId: { in: [...versionIds] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.versionId, r._count._all]));
  }

  async listAckedEmployeeIds(versionId: string): Promise<string[]> {
    const rows = await this.prisma.sopAck.findMany({ where: { versionId }, select: { employeeId: true } });
    return rows.map((r) => r.employeeId);
  }
}
