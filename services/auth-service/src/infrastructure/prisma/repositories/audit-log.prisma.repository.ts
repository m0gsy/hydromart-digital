import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  AuditLogEntry,
  AuditLogRepository,
} from '../../../application/ports/audit-log.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditLogPrismaRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        customerId: entry.customerId,
        action: entry.action,
        success: entry.success,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
