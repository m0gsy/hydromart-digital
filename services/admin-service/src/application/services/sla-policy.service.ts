import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import {
  SaveSlaPolicyData,
  SlaPolicyRecord,
  SlaPolicyRepository,
} from '../ports/sla-policy.repository';
import { ADMIN_TOKENS } from '../tokens';

// Platform defaults returned before an admin has ever saved the policy (Design 19d). These
// mirror the DB column defaults so GET is never empty and PUT starts from a sensible baseline.
const DEFAULTS: SaveSlaPolicyData = {
  onTimeThresholdMinutes: 90,
  healthyBandPct: 95,
  criticalBandPct: 85,
};

@Injectable()
export class SlaPolicyService {
  constructor(
    @Inject(ADMIN_TOKENS.SlaPolicyRepository) private readonly repo: SlaPolicyRepository,
  ) {}

  /** Current SLA policy, falling back to platform defaults when unset. */
  async get(): Promise<SlaPolicyRecord> {
    const existing = await this.repo.get();
    return existing ?? { ...DEFAULTS, updatedAt: new Date(0) };
  }

  /**
   * Replace the singleton policy (PUT).
   *
   * CA-2-53: refused when the caller's copy is older than the stored row. Two admins on
   * this page at once used to produce whichever of them saved last, with the other's
   * change gone and neither of them told.
   */
  async save(data: SaveSlaPolicyData, seenUpdatedAt?: string): Promise<SlaPolicyRecord> {
    assertFresh((await this.repo.get())?.updatedAt ?? null, seenUpdatedAt);
    return this.repo.save(data);
  }
}
