import { Inject, Injectable } from '@nestjs/common';

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

  /** Replace the singleton policy (PUT). */
  save(data: SaveSecurityPolicyData): Promise<SecurityPolicyRecord> {
    return this.repo.save(data);
  }
}
