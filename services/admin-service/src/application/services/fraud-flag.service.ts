import { Inject, Injectable } from '@nestjs/common';

import { FraudStatus } from '../../domain/fraud';
import { FraudFlagNotFoundError } from '../../domain/errors';
import {
  CreateFraudFlagData,
  FraudFlagRecord,
  FraudFlagRepository,
  ListFraudFlagsFilter,
} from '../ports/fraud-flag.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class FraudFlagService {
  constructor(
    @Inject(ADMIN_TOKENS.FraudFlagRepository) private readonly repo: FraudFlagRepository,
  ) {}

  /** Fraud flags (Design 15b), highest-score-then-newest first, optionally filtered. */
  list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]> {
    return this.repo.list(filter);
  }

  /** Record a flag (internal-key ingest). The score/level/signals are stored verbatim. */
  ingest(data: CreateFraudFlagData): Promise<FraudFlagRecord> {
    return this.repo.create(data);
  }

  /** Mark a flag REVIEWED. 404 when unknown. */
  review(id: string): Promise<FraudFlagRecord> {
    return this.transition(id, FraudStatus.REVIEWED);
  }

  /** Mark a flag BLOCKED. 404 when unknown. */
  block(id: string): Promise<FraudFlagRecord> {
    return this.transition(id, FraudStatus.BLOCKED);
  }

  /** Mark a flag CLEARED. 404 when unknown. */
  clear(id: string): Promise<FraudFlagRecord> {
    return this.transition(id, FraudStatus.CLEARED);
  }

  private async transition(id: string, status: FraudStatus): Promise<FraudFlagRecord> {
    const updated = await this.repo.setStatus(id, status);
    if (!updated) throw new FraudFlagNotFoundError(id);
    return updated;
  }
}
