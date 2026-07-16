import { Inject, Injectable } from '@nestjs/common';

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

  /** Replace the singleton policy (PUT). */
  save(data: SaveSlaPolicyData): Promise<SlaPolicyRecord> {
    return this.repo.save(data);
  }
}
