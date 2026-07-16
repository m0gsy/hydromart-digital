import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { AdminConfigService } from '../../src/config/admin-config.service';
import { FlagState } from '../../src/domain/flag-state';
import {
  FeatureFlagRecord,
  FeatureFlagRepository,
  UpdateFeatureFlagData,
} from '../../src/application/ports/feature-flag.repository';
import {
  SaveSystemSettingsData,
  SystemSettingsRecord,
  SystemSettingsRepository,
} from '../../src/application/ports/system-settings.repository';
import { HealthProbePort, HealthProbeResult } from '../../src/application/ports/health-probe.port';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export function makeFlag(over: Partial<FeatureFlagRecord> = {}): FeatureFlagRecord {
  const now = nextDate();
  return {
    id: randomUUID(),
    key: 'sample.flag',
    label: 'Sample flag',
    description: 'A sample flag',
    state: FlagState.OFF,
    rolloutPct: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  flags: FeatureFlagRecord[] = [];

  async list(): Promise<FeatureFlagRecord[]> {
    return [...this.flags]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => ({ ...f }));
  }

  async findByKey(key: string): Promise<FeatureFlagRecord | null> {
    const f = this.flags.find((x) => x.key === key);
    return f ? { ...f } : null;
  }

  async update(key: string, data: UpdateFeatureFlagData): Promise<FeatureFlagRecord | null> {
    const f = this.flags.find((x) => x.key === key);
    if (!f) return null;
    if (data.state !== undefined) f.state = data.state;
    if (data.rolloutPct !== undefined) f.rolloutPct = data.rolloutPct;
    f.updatedAt = nextDate();
    return { ...f };
  }
}

export class InMemorySystemSettingsRepository implements SystemSettingsRepository {
  row: SystemSettingsRecord | null = null;

  async get(): Promise<SystemSettingsRecord | null> {
    return this.row ? { ...this.row } : null;
  }

  async save(data: SaveSystemSettingsData): Promise<SystemSettingsRecord> {
    this.row = { ...data, updatedAt: nextDate() };
    return { ...this.row };
  }
}

export class FakeHealthProbe implements HealthProbePort {
  probed: string[] = [];
  // Map baseUrl -> forced result; anything not present defaults to a healthy probe.
  results = new Map<string, HealthProbeResult>();

  async probe(baseUrl: string): Promise<HealthProbeResult> {
    this.probed.push(baseUrl);
    return this.results.get(baseUrl) ?? { status: 'up', latencyMs: 5, httpStatus: 200 };
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): AdminConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    ADMIN_SERVICE_PORT: '3017',
    ADMIN_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    AUTH_SERVICE_URL: 'http://auth:3001',
    ORDER_SERVICE_URL: 'http://order:3004',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new AdminConfigService(fake as unknown as ConfigService);
}
