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

  // hrAdmin-only endpoint (guarded at the controller); no depot scope — audit is HQ-wide.
  list(query: {
    entity?: string;
    entityId?: string;
    actorId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: AuditLog[]; total: number }> {
    return this.repo.list({
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }
}
