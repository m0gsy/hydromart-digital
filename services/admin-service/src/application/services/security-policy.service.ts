import { Inject, Injectable } from '@nestjs/common';
import { HQ_IDLE_LIMIT } from '@hydromart/access';
import { assertFresh } from '@hydromart/platform';

import { IdleLimitOutOfRangeError } from '../../domain/errors';

import {
  SaveSecurityPolicyData,
  SecurityPolicyRecord,
  SecurityPolicyRepository,
} from '../ports/security-policy.repository';
import { ADMIN_TOKENS } from '../tokens';

// Platform defaults returned before an admin has ever saved the policy (Design 19b).
// The idle limit is OFF: it applies only to head-office accounts, and turning it on is a
// decision, not a default — see HQ_IDLE_LIMIT.
const DEFAULTS: SaveSecurityPolicyData = {
  idleTimeoutMinutes: HQ_IDLE_LIMIT.off,
  require2fa: true,
  ipAllowlist: [],
};

@Injectable()
export class SecurityPolicyService {
  constructor(
    @Inject(ADMIN_TOKENS.SecurityPolicyRepository)
    private readonly repo: SecurityPolicyRepository,
  ) {}

  /** Current security policy, falling back to platform defaults when unset. */
  async get(): Promise<SecurityPolicyRecord> {
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
  async save(
    data: SaveSecurityPolicyData,
    seenUpdatedAt?: string,
  ): Promise<SecurityPolicyRecord> {
    const idle = data.idleTimeoutMinutes;
    if (idle !== HQ_IDLE_LIMIT.off && (idle < HQ_IDLE_LIMIT.min || idle > HQ_IDLE_LIMIT.max)) {
      throw new IdleLimitOutOfRangeError(HQ_IDLE_LIMIT.min, HQ_IDLE_LIMIT.max);
    }
    assertFresh((await this.repo.get())?.updatedAt ?? null, seenUpdatedAt);
    return this.repo.save(data);
  }
}
