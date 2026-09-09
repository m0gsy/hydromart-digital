import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import {
  SaveSecurityPolicyData,
  SecurityPolicyRecord,
  SecurityPolicyRepository,
} from '../ports/security-policy.repository';
import { ADMIN_TOKENS } from '../tokens';

// Platform defaults returned before an admin has ever saved the policy (Design 19b).
const DEFAULTS: SaveSecurityPolicyData = {
  idleTimeoutMinutes: 15,
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
    assertFresh((await this.repo.get())?.updatedAt ?? null, seenUpdatedAt);
    return this.repo.save(data);
  }
}
