import { AuditLog } from '../../../prisma/generated/client';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditWrite {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** Free-form JSON snapshots (serialized by the adapter). null = not captured. */
  before: unknown;
  after: unknown;
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
