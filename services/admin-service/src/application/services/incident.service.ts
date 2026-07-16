import { Inject, Injectable } from '@nestjs/common';

import { IncidentNotFoundError } from '../../domain/errors';
import {
  CreateIncidentData,
  IncidentRecord,
  IncidentRepository,
  ListIncidentsFilter,
  PatchIncidentData,
} from '../ports/incident.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class IncidentService {
  constructor(
    @Inject(ADMIN_TOKENS.IncidentRepository) private readonly repo: IncidentRepository,
  ) {}

  /** Incidents (Design 14c), newest first, optionally filtered by status. */
  list(filter: ListIncidentsFilter): Promise<IncidentRecord[]> {
    return this.repo.list(filter);
  }

  create(data: CreateIncidentData): Promise<IncidentRecord> {
    return this.repo.create(data);
  }

  /** Append a timeline update and/or resolve. 404 when the id is unknown. */
  async patch(id: string, data: PatchIncidentData): Promise<IncidentRecord> {
    const updated = await this.repo.patch(id, data);
    if (!updated) throw new IncidentNotFoundError(id);
    return updated;
  }
}
