import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditLog } from '../../../prisma/generated/client';
import { AUDIT_REPOSITORY, AuditRepository, AuditWrite } from '../ports/audit.repository';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository) {}

  /** Persist an audit entry. Failure must never break the mutating request it trails. */
  async record(entry: AuditWrite): Promise<void> {
    try {
      await this.repo.write(entry);
    } catch (err) {
      this.logger.warn(`audit write failed for ${entry.action} ${entry.entity}: ${String(err)}`);
    }
  }

  /**
   * HR-2 — the HR trail kept every row forever. `audit_logs` in auth-service has had a
   * two-year window since the retention console shipped; this table is a second audit trail in
   * a second database that the sweep had never heard of, so it grew without limit and held the
   * personal data of people who left years ago. Same window, same console.
   */
  async purgeOlderThan(cutoff: Date): Promise<{ purged: number }> {
    const purged = await this.repo.deleteBefore(cutoff);
    this.logger.log(`Retention: deleted ${purged} HR audit row(s) before ${cutoff.toISOString()}`);
    return { purged };
  }

  // hrAdmin-only endpoint (guarded at the controller); no depot scope — audit is HQ-wide.
  // CA-1-26: `/hr/audit` reads `HrPage<AuditLog>` — four fields — and this answered two.
  // The declared return type said so out loud and still nobody noticed, because the client
  // asserts the shape with a cast rather than being handed it.
  async list(query: {
    entity?: string;
    entityId?: string;
    actorId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: AuditLog[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.repo.list({
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }
}
