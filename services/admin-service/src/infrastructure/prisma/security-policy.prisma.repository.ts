import { Injectable } from '@nestjs/common';
import { StaleWriteError } from '@hydromart/platform';

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

  async save(data: SaveSecurityPolicyData, expectedUpdatedAt?: Date): Promise<SecurityPolicyRecord> {
    if (expectedUpdatedAt) {
      // AAS-13: the check and the write are ONE statement. assertFresh then upsert let two admins both
      // pass the check and the slower one overwrite the faster.
      const { count } = await this.prisma.securityPolicy.updateMany({
        where: { id: SINGLETON_ID, updatedAt: expectedUpdatedAt },
        data,
      });
      if (count === 0) throw new StaleWriteError();
      return (await this.get()) as SecurityPolicyRecord;
    }
    const row = await this.prisma.securityPolicy.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    const { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt } = row;
    return { idleTimeoutMinutes, require2fa, ipAllowlist, updatedAt };
  }
}
