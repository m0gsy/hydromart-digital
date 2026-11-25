import { Inject, Injectable } from '@nestjs/common';

import { AI_QUEUES_REPOSITORY, AiQueuesRepository, OpenQueueRow } from '../ports/ai-queues.repository';

/** HD-6 H4 part 2: A-01, what is open at each depot right now. One row per depot asked, zeros included. */
@Injectable()
export class AiQueuesService {
  constructor(@Inject(AI_QUEUES_REPOSITORY) private readonly repo: AiQueuesRepository) {}

  async open(depotIds: readonly string[], now: Date = new Date()): Promise<OpenQueueRow[]> {
    const ids = [...new Set(depotIds)].sort();
    const c = await this.repo.openCounts(ids, now);
    return ids.map((depotId) => ({
      depotId,
      incidents: c.incidents.get(depotId) ?? 0,
      disputes: c.disputes.get(depotId) ?? 0,
      approvals: c.approvals.get(depotId) ?? 0,
      maintenanceOverdue: c.maintenanceOverdue.get(depotId) ?? 0,
    }));
  }
}
