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
  expiresAt: Date | null;
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
    expiresAt: true,
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

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    return row ? this.toRecord(row) : null;
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: at } });
  }

  async rotate(
    id: string,
    keyPrefix: string,
    keyHash: string,
    expiresAt: Date | null,
  ): Promise<ApiKeyRecord | null> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) return null;
    // ADM-5: `revokedAt` is NOT cleared. Rotating a revoked key used to hand the same
    // partner a working credential again — an undo of a security decision, spelled as
    // routine maintenance. A revoked key stays revoked; mint a new one instead.
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { keyPrefix, keyHash, expiresAt },
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
