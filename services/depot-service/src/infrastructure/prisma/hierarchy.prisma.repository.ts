import { Injectable } from '@nestjs/common';

import { HierarchyRepository } from '../../application/ports/hierarchy.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class HierarchyPrismaRepository implements HierarchyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async depotsForAssistant(staffId: string): Promise<string[]> {
    return this.depotsForAssistants([staffId]);
  }

  async depotsForAssistants(staffIds: readonly string[]): Promise<string[]> {
    if (staffIds.length === 0) return [];
    const rows = await this.prisma.depot.findMany({
      where: { assistantSupervisorId: { in: [...staffIds] } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async subordinatesOf(superiorId: string): Promise<string[]> {
    return this.subordinatesOfMany([superiorId]);
  }

  async subordinatesOfMany(superiorIds: readonly string[]): Promise<string[]> {
    if (superiorIds.length === 0) return [];
    const rows = await this.prisma.staffSupervision.findMany({
      where: { superiorId: { in: [...superiorIds] } },
      select: { staffId: true },
    });
    return rows.map((r) => r.staffId);
  }

  async directDepots(staffId: string): Promise<string[]> {
    const rows = await this.prisma.staffDepotAssignment.findMany({
      where: { staffId },
      select: { depotId: true },
    });
    return rows.map((r) => r.depotId);
  }

  async setDepotAssistant(depotId: string, staffId: string | null): Promise<void> {
    await this.prisma.depot.update({
      where: { id: depotId },
      data: { assistantSupervisorId: staffId },
    });
  }

  async setSuperior(staffId: string, superiorId: string, updatedBy: string | null): Promise<void> {
    await this.prisma.staffSupervision.upsert({
      where: { staffId },
      create: { staffId, superiorId, updatedBy },
      update: { superiorId, updatedBy },
    });
  }

  async clearSuperior(staffId: string): Promise<void> {
    // deleteMany, not delete: clearing a link that was never set is the state the caller
    // asked for, not a 404.
    await this.prisma.staffSupervision.deleteMany({ where: { staffId } });
  }

  async grantDepot(staffId: string, depotId: string, updatedBy: string | null): Promise<void> {
    await this.prisma.staffDepotAssignment.upsert({
      where: { staffId_depotId: { staffId, depotId } },
      create: { staffId, depotId, updatedBy },
      update: { updatedBy },
    });
  }

  async revokeDepot(staffId: string, depotId: string): Promise<void> {
    await this.prisma.staffDepotAssignment.deleteMany({ where: { staffId, depotId } });
  }

  async describe(staffId: string): Promise<{
    superiorId: string | null;
    subordinateIds: string[];
    assistantDepotIds: string[];
    directDepotIds: string[];
  }> {
    const [link, subordinateIds, assistantDepotIds, directDepotIds] = await Promise.all([
      this.prisma.staffSupervision.findUnique({ where: { staffId }, select: { superiorId: true } }),
      this.subordinatesOf(staffId),
      this.depotsForAssistant(staffId),
      this.directDepots(staffId),
    ]);
    return {
      superiorId: link?.superiorId ?? null,
      subordinateIds,
      assistantDepotIds,
      directDepotIds,
    };
  }
}
