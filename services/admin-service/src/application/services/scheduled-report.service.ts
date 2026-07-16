import { Inject, Injectable } from '@nestjs/common';

import { ScheduledReportNotFoundError } from '../../domain/errors';
import {
  CreateScheduledReportData,
  ScheduledReportRecord,
  ScheduledReportRepository,
  UpdateScheduledReportData,
} from '../ports/scheduled-report.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class ScheduledReportService {
  constructor(
    @Inject(ADMIN_TOKENS.ScheduledReportRepository)
    private readonly repo: ScheduledReportRepository,
  ) {}

  /** All scheduled reports (Design 15c), newest first. */
  list(): Promise<ScheduledReportRecord[]> {
    return this.repo.list();
  }

  create(data: CreateScheduledReportData): Promise<ScheduledReportRecord> {
    return this.repo.create(data);
  }

  /** Enable/disable/edit a schedule. 404 when the id is unknown. */
  async update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord> {
    const updated = await this.repo.update(id, data);
    if (!updated) throw new ScheduledReportNotFoundError(id);
    return updated;
  }

  /** Delete a schedule. 404 when the id is unknown. */
  async remove(id: string): Promise<void> {
    if (!(await this.repo.remove(id))) throw new ScheduledReportNotFoundError(id);
  }
}
