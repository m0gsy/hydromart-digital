import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { SegmentFilter } from '../ports/customer-directory.port';
import {
  SavedSegmentRecord,
  SavedSegmentRepository,
} from '../ports/saved-segment.repository';
import { CRM_TOKENS } from '../tokens';

/**
 * Named audience definitions (design 21d "Buat segment").
 *
 * The builder could compose conditions, size them live and hand them to the campaign
 * builder — but nothing could be saved, so the same audience was rebuilt by hand every
 * time somebody wanted to message it again.
 */
@Injectable()
export class SavedSegmentService {
  /** The list is human-curated and rendered whole; this is a ceiling, not a page size. */
  private static readonly MAX = 200;

  constructor(
    @Inject(CRM_TOKENS.SavedSegmentRepository) private readonly repo: SavedSegmentRepository,
  ) {}

  list(): Promise<SavedSegmentRecord[]> {
    return this.repo.list(SavedSegmentService.MAX);
  }

  save(createdBy: string, name: string, conditions: SegmentFilter): Promise<SavedSegmentRecord> {
    return this.repo.upsertByName({ name: name.trim(), conditions, createdBy });
  }

  async remove(id: string): Promise<void> {
    if (!(await this.repo.remove(id))) throw new NotFoundException('Segment tidak ditemukan.');
  }
}
