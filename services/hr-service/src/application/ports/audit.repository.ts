import { Prisma, AuditLog } from '../../../prisma/generated/client';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditWrite {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
  ip: string | null;
}

export interface AuditListFilter {
  entity?: string;
  entityId?: string;
  actorId?: string;
  skip: number;
  take: number;
}

export interface AuditRepository {
  write(entry: AuditWrite): Promise<void>;
  list(filter: AuditListFilter): Promise<{ rows: AuditLog[]; total: number }>;
}
