import { Injectable } from '@nestjs/common';

import {
  SaveSecurityPolicyData,
  SecurityPolicyRecord,
  SecurityPolicyRepository,
} from '../../application/ports/security-policy.repository';
import { PrismaService } from './prisma.service';

// The policy table holds exactly one row, keyed by this fixed id.
const SINGLETON_ID = 'singleton';

@Injectable()
export class SecurityPolicyPrismaRepository implements SecurityPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SecurityPolicyRecord | null> {
    const row = await this.prisma.securityPolicy.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return null;
    const { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt } = row;
    return { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt };
  }

  async save(data: SaveSecurityPolicyData): Promise<SecurityPolicyRecord> {
    const row = await this.prisma.securityPolicy.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    const { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt } = row;
    return { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt };
  }
}
