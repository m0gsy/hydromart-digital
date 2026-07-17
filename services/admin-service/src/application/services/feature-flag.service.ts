import { Inject, Injectable } from '@nestjs/common';

import { FeatureFlagNotFoundError } from '../../domain/errors';
import {
  FeatureFlagRecord,
  FeatureFlagRepository,
  UpdateFeatureFlagData,
} from '../ports/feature-flag.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(ADMIN_TOKENS.FeatureFlagRepository) private readonly repo: FeatureFlagRepository,
  ) {}

  /** All feature flags (Design 8b), stable order by key. */
  list(): Promise<FeatureFlagRecord[]> {
    return this.repo.list();
  }

  /**
   * Toggle a flag's state / rollout percentage by key. Throws FeatureFlagNotFoundError
   * (404) when the key is unknown so a stale UI never silently no-ops.
   */
  async update(key: string, data: UpdateFeatureFlagData): Promise<FeatureFlagRecord> {
    const updated = await this.repo.update(key, data);
    if (!updated) throw new FeatureFlagNotFoundError(key);
    return updated;
  }
}
