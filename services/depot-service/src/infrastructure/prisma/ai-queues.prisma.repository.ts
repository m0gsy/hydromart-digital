import { Injectable } from '@nestjs/common';

import { AiQueuesRepository } from '../../application/ports/ai-queues.repository';
import { ApprovalStatus, DisputeStatus, IncidentStatus } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

type Grouped = { depotId: string; _count: { _all: number } }[];
const toMap = (rows: Grouped): Map<string, number> => new Map(rows.map((r) => [r.depotId, r._count._all]));

/** HD-6 H4 part 2: four grouped counts, each on an index that already leads with (depotId, status). */
@Injectable()
export class AiQueuesPrismaRepository implements AiQueuesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async openCounts(depotIds: readonly string[], now: Date) {
    const depotId = { in: [...depotIds] };
    const [incidents, disputes, approvals, maintenance] = await Promise.all([
      this.prisma.incident.groupBy({ by: ['depotId'], where: { depotId, status: { not: IncidentStatus.RESOLVED } }, _count: { _all: true } }),
      this.prisma.orderDispute.groupBy({ by: ['depotId'], where: { depotId, status: DisputeStatus.OPEN }, _count: { _all: true } }),
      this.prisma.approval.groupBy({ by: ['depotId'], where: { depotId, status: ApprovalStatus.PENDING }, _count: { _all: true } }),
      this.prisma.maintenanceItem.groupBy({ by: ['depotId'], where: { depotId, nextDueAt: { lte: now } }, _count: { _all: true } }),
    ]);
    return {
      incidents: toMap(incidents),
      disputes: toMap(disputes),
      approvals: toMap(approvals),
      maintenanceOverdue: toMap(maintenance),
    };
  }
}
