import { Injectable } from '@nestjs/common';

import { ApiKeyEnvironment } from '../../domain/api-key-environment';
import {
  ApiKeyRecord,
  ApiKeyRepository,
  CreateApiKeyData,
} from '../../application/ports/api-key.repository';
import { PrismaService } from './prisma.service';

// Prisma generates a structurally distinct enum, so `environment` is cast back to the
// domain ApiKeyEnvironment here (infra only). The keyHash column never leaves this layer.
interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class ApiKeyPrismaRepository implements ApiKeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Explicit select so the secret hash is never read into a record.
  private static readonly SELECT = {
    id: true,
    name: true,
    keyPrefix: true,
    scopes: true,
    environment: true,
    lastUsedAt: true,
    revokedAt: true,
    createdAt: true,
  } as const;

  private toRecord(row: ApiKeyRow): ApiKeyRecord {
    return { ...row, environment: row.environment as ApiKeyEnvironment };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.apiKey.findMany({
      select: ApiKeyPrismaRepository.SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
    const row = await this.prisma.apiKey.create({
      data,
      select: ApiKeyPrismaRepository.SELECT,
    });
    return this.toRecord(row);
  }

  async rotate(id: string, keyPrefix: string, keyHash: string): Promise<ApiKeyRecord | null> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { keyPrefix, keyHash, revokedAt: null },
      select: ApiKeyPrismaRepository.SELECT,
    });
    return this.toRecord(row);
  }

  async revoke(id: string): Promise<ApiKeyRecord | null> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: ApiKeyPrismaRepository.SELECT,
    });
    return this.toRecord(row);
  }
}
