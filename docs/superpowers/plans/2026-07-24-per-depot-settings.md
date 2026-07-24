# Per-Depot Editable Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SUPER_ADMIN / depot managers edit business tunables (shift length, break quota, delivery fee, commission, loyalty/referral rates, etc.) from an admin UI, with a global default plus optional per-depot override — instead of redeploying to change an env var.

**Architecture:** Each service keeps a `service_settings` table (hexagonal — no cross-service runtime coupling). A tiny reusable core in `@hydromart/platform` resolves the effective value as `depot override ?? global default ?? ENV baked-in default`, keeps an in-memory snapshot refreshed on a timer so existing **synchronous** config getters keep working, and coerces the stored string to the right type. Each service exposes `GET /settings/schema` (key metadata + current effective values) and `PUT /settings` (write global or per-depot). A single web page aggregates the schema endpoints and renders an editor per depot. ENV stays the final fallback so a boot with an empty table behaves exactly like today.

**Tech Stack:** NestJS + Prisma (Postgres) backends, Next.js (App Router) web, `@hydromart/platform` shared lib, `@hydromart/access` RBAC (`depotAdmin` capability), Jest.

## Global Constraints

- **Scope = business tunables ONLY.** Secrets, JWT, service URLs, storage keys, ports, CORS, rate-limits are NEVER exposed to the settings store or UI. Keep them env-only.
- **ENV remains the final fallback.** Empty `service_settings` table ⇒ identical behavior to today. Never remove the existing env getters/defaults.
- **RBAC:** write gated by `CAPABILITIES.depotAdmin` (`DEPOT_MANAGER`, `SUPER_ADMIN`). SUPER_ADMIN already bypasses all guards (superuser).
- **Per-depot model:** sparse override. A depot row exists only for keys it overrides; unset keys inherit the global row; no global row ⇒ ENV default.
- **Values stored as `string`**, coerced on read by declared type (`int` | `number` | `money` | `string`). `money` and `int` truncate to integer.
- **Sync-safe:** config getters stay synchronous, served from an in-memory snapshot refreshed every 30s and immediately after a write. Do not convert call sites to async.
- **Money in IDR (integer rupiah).** No decimals for `money` keys.
- Follow existing per-service Prisma/hexagonal conventions (ports in `application/ports`, adapters in `infrastructure/prisma`).

---

## File Structure

**Shared core — `@hydromart/platform`:**
- Create `packages/platform/src/config/settings.ts` — types, `coerce`, `resolveRaw`, `SettingsSnapshot`, `SettingsCache`.
- Create `packages/platform/src/config/settings.spec.ts` — unit tests for coercion + resolution.
- Modify `packages/platform/src/index.ts` — export the new module.

**Per service (delivery = template, then order/payout/loyalty/referral/depot):**
- Modify `services/<svc>/prisma/schema.prisma` — add `ServiceSetting` model.
- Create `services/<svc>/prisma/migrations/<ts>_service_settings/migration.sql` (+ `rollback.sql`).
- Create `services/<svc>/src/application/ports/settings.repository.ts` — port.
- Create `services/<svc>/src/infrastructure/prisma/settings.prisma.repository.ts` — adapter.
- Create `services/<svc>/src/application/services/settings.service.ts` — write validation + snapshot source.
- Create `services/<svc>/src/modules/settings.controller.ts` — `GET /settings/schema`, `PUT /settings`.
- Create `services/<svc>/src/config/setting-defs.ts` — the key registry (label, type, unit, min/max, env key + default) for this service.
- Modify `services/<svc>/src/config/<svc>-config.service.ts` — back each business getter with the cache; add optional `depotId` param where per-depot resolution is wanted.
- Wire the above into the service module + register controller.

**Web:**
- Create `apps/web/src/lib/settings.ts` — types + `fetchSettingsSchema`, `putSetting` API helpers; static list of services that expose settings.
- Create `apps/web/src/app/dashboard/settings/page.tsx` — depot switcher + settings editor.
- Modify `apps/web/src/lib/dictionaries/{id,en}/*` — settings labels/copy fragment.
- Modify the ops nav to add a "Pengaturan" entry gated by `can('depotAdmin', role)`.

---

## Task 1: Shared resolution core in `@hydromart/platform`

**Files:**
- Create: `packages/platform/src/config/settings.ts`
- Test: `packages/platform/src/config/settings.spec.ts`
- Modify: `packages/platform/src/index.ts`

**Interfaces:**
- Produces:
  - `type SettingType = 'int' | 'number' | 'money' | 'string'`
  - `interface SettingRow { scope: 'GLOBAL' | 'DEPOT'; depotId: string | null; key: string; value: string }`
  - `interface SettingsSource { loadAll(): Promise<SettingRow[]> }`
  - `function coerce(raw: string, type: SettingType): number | string`
  - `function resolveRaw(key: string, depotId: string | null, rows: SettingRow[]): string | null`
  - `class SettingsCache { constructor(source: SettingsSource, ttlMs?: number); refresh(): Promise<void>; getRaw(key: string, depotId: string | null): string | null; effective(key: string, type: SettingType, envDefault: number | string, depotId?: string | null): number | string }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform/src/config/settings.spec.ts
import { coerce, resolveRaw, SettingsCache, SettingRow, SettingsSource } from './settings';

describe('coerce', () => {
  it('truncates int and money, keeps number, passes string', () => {
    expect(coerce('8', 'int')).toBe(8);
    expect(coerce('12000', 'money')).toBe(12000);
    expect(coerce('18.5', 'number')).toBe(18.5);
    expect(coerce('18.9', 'int')).toBe(18);
    expect(coerce('Asia/Jakarta', 'string')).toBe('Asia/Jakarta');
  });
});

describe('resolveRaw', () => {
  const rows: SettingRow[] = [
    { scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '8' },
    { scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6' },
  ];
  it('prefers depot override over global', () => {
    expect(resolveRaw('shiftLengthHours', 'd1', rows)).toBe('6');
  });
  it('falls back to global when depot has no override', () => {
    expect(resolveRaw('shiftLengthHours', 'd2', rows)).toBe('8');
  });
  it('returns null when neither exists', () => {
    expect(resolveRaw('unknownKey', 'd1', rows)).toBeNull();
  });
});

describe('SettingsCache.effective', () => {
  const source: SettingsSource = {
    loadAll: async () => [
      { scope: 'GLOBAL', depotId: null, key: 'fee', value: '2000' },
      { scope: 'DEPOT', depotId: 'd1', key: 'fee', value: '1000' },
    ],
  };
  it('coerces depot override, then global, then env default', async () => {
    const cache = new SettingsCache(source);
    await cache.refresh();
    expect(cache.effective('fee', 'money', 5000, 'd1')).toBe(1000);
    expect(cache.effective('fee', 'money', 5000, 'd2')).toBe(2000);
    expect(cache.effective('missing', 'money', 5000, 'd1')).toBe(5000);
  });
  it('returns env default before first refresh', () => {
    const cache = new SettingsCache(source);
    expect(cache.effective('fee', 'money', 5000, 'd1')).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/platform && npx jest src/config/settings.spec.ts`
Expected: FAIL — `Cannot find module './settings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/platform/src/config/settings.ts
export type SettingType = 'int' | 'number' | 'money' | 'string';

export interface SettingRow {
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  key: string;
  value: string;
}

/** How a service hands its full row set (all GLOBAL + DEPOT) to the cache. */
export interface SettingsSource {
  loadAll(): Promise<SettingRow[]>;
}

export function coerce(raw: string, type: SettingType): number | string {
  if (type === 'string') {
    return raw;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    // A malformed stored value must not poison config; caller's envDefault wins upstream.
    return type === 'string' ? raw : 0;
  }
  return type === 'int' || type === 'money' ? Math.trunc(n) : n;
}

/** depot override ?? global ?? null (never the env default — that is the caller's job). */
export function resolveRaw(key: string, depotId: string | null, rows: SettingRow[]): string | null {
  if (depotId != null) {
    const depot = rows.find((r) => r.scope === 'DEPOT' && r.depotId === depotId && r.key === key);
    if (depot) {
      return depot.value;
    }
  }
  const global = rows.find((r) => r.scope === 'GLOBAL' && r.key === key);
  return global ? global.value : null;
}

/**
 * In-memory snapshot of one service's settings rows, refreshed on a TTL. Keeps the
 * config getters synchronous: they read the last snapshot, never hit the DB inline.
 * Empty snapshot (pre-first-refresh or empty table) ⇒ every effective() returns the
 * env default, i.e. today's behavior.
 */
export class SettingsCache {
  private rows: SettingRow[] = [];

  constructor(
    private readonly source: SettingsSource,
    private readonly ttlMs = 30_000,
  ) {}

  async refresh(): Promise<void> {
    this.rows = await this.source.loadAll();
  }

  get ttl(): number {
    return this.ttlMs;
  }

  getRaw(key: string, depotId: string | null): string | null {
    return resolveRaw(key, depotId, this.rows);
  }

  effective(
    key: string,
    type: SettingType,
    envDefault: number | string,
    depotId: string | null = null,
  ): number | string {
    const raw = resolveRaw(key, depotId, this.rows);
    return raw == null ? envDefault : coerce(raw, type);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/platform && npx jest src/config/settings.spec.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Export from the package barrel**

```ts
// packages/platform/src/index.ts  — add near the other config exports:
export * from './config/settings';
```

- [ ] **Step 6: Build the package**

Run: `cd packages/platform && npm run build`
Expected: `tsc -p tsconfig.json` exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/platform/src/config/settings.ts packages/platform/src/config/settings.spec.ts packages/platform/src/index.ts
git commit -m "feat(platform): add per-depot settings resolution core"
```

---

## Task 2: `service_settings` table + repository in delivery-service (template)

**Files:**
- Modify: `services/delivery-service/prisma/schema.prisma`
- Create: `services/delivery-service/prisma/migrations/20260724180000_service_settings/migration.sql`
- Create: `services/delivery-service/prisma/migrations/20260724180000_service_settings/rollback.sql`
- Create: `services/delivery-service/src/application/ports/settings.repository.ts`
- Create: `services/delivery-service/src/infrastructure/prisma/settings.prisma.repository.ts`
- Test: `services/delivery-service/test/unit/settings.repository.spec.ts`

**Interfaces:**
- Consumes: `SettingRow`, `SettingsSource` (Task 1).
- Produces:
  - `interface SettingsRepository extends SettingsSource { upsert(row: SettingRow & { updatedBy: string }): Promise<void>; remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> }`
  - Prisma model `ServiceSetting` mapped to `service_settings`.

- [ ] **Step 1: Add the Prisma model**

```prisma
// services/delivery-service/prisma/schema.prisma  — append:
model ServiceSetting {
  id        String   @id @default(uuid())
  scope     String   // 'GLOBAL' | 'DEPOT'
  depotId   String?  @map("depot_id")
  key       String
  value     String
  updatedBy String   @map("updated_by")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([scope, depotId])
  @@map("service_settings")
}
```

- [ ] **Step 2: Write the migration SQL (partial unique indexes, NULL-safe)**

```sql
-- services/delivery-service/prisma/migrations/20260724180000_service_settings/migration.sql
CREATE TABLE "service_settings" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "depot_id" TEXT,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_settings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_settings_scope_depot_id_idx" ON "service_settings" ("scope", "depot_id");
-- One GLOBAL row per key; one DEPOT row per (depot,key). Partial indexes because
-- Postgres treats NULL depot_id as distinct under a plain composite unique.
CREATE UNIQUE INDEX "service_settings_global_key_key"
  ON "service_settings" ("key") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "service_settings_depot_key_key"
  ON "service_settings" ("depot_id", "key") WHERE "scope" = 'DEPOT';
```

```sql
-- services/delivery-service/prisma/migrations/20260724180000_service_settings/rollback.sql
DROP TABLE "service_settings";
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd services/delivery-service && npx prisma generate`
Expected: client regenerated, `ServiceSetting` delegate available.

- [ ] **Step 4: Write the port**

```ts
// services/delivery-service/src/application/ports/settings.repository.ts
import { SettingRow, SettingsSource } from '@hydromart/platform';

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export interface SettingsRepository extends SettingsSource {
  upsert(row: SettingRow & { updatedBy: string }): Promise<void>;
  remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void>;
}
```

- [ ] **Step 5: Write the failing repository test**

```ts
// services/delivery-service/test/unit/settings.repository.spec.ts
import { SettingsPrismaRepository } from '../../src/infrastructure/prisma/settings.prisma.repository';

describe('SettingsPrismaRepository', () => {
  it('loadAll maps rows to SettingRow shape', async () => {
    const prisma = {
      serviceSetting: {
        findMany: async () => [
          { scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '8' },
        ],
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await expect(repo.loadAll()).resolves.toEqual([
      { scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '8' },
    ]);
  });

  it('upsert targets the right partial-unique row (global)', async () => {
    const calls: unknown[] = [];
    const prisma = {
      serviceSetting: {
        upsert: async (arg: unknown) => {
          calls.push(arg);
        },
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await repo.upsert({ scope: 'GLOBAL', depotId: null, key: 'fee', value: '2000', updatedBy: 'u1' });
    expect(calls).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/delivery-service && npx jest test/unit/settings.repository.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the adapter**

```ts
// services/delivery-service/src/infrastructure/prisma/settings.prisma.repository.ts
import { Injectable } from '@nestjs/common';
import { SettingRow } from '@hydromart/platform';

import { SettingsRepository } from '../../application/ports/settings.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class SettingsPrismaRepository implements SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<SettingRow[]> {
    const rows = await this.prisma.serviceSetting.findMany({
      select: { scope: true, depotId: true, key: true, value: true },
    });
    return rows.map((r) => ({
      scope: r.scope as 'GLOBAL' | 'DEPOT',
      depotId: r.depotId,
      key: r.key,
      value: r.value,
    }));
  }

  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    // Emulate the partial-unique target: find existing, then update or create.
    const existing = await this.prisma.serviceSetting.findFirst({
      where: { scope: row.scope, depotId: row.depotId, key: row.key },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.serviceSetting.update({
        where: { id: existing.id },
        data: { value: row.value, updatedBy: row.updatedBy },
      });
      return;
    }
    await this.prisma.serviceSetting.create({
      data: {
        scope: row.scope,
        depotId: row.depotId,
        key: row.key,
        value: row.value,
        updatedBy: row.updatedBy,
      },
    });
  }

  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    await this.prisma.serviceSetting.deleteMany({ where: { scope, depotId, key } });
  }
}
```

Note: the test's `upsert` stub exposes only `serviceSetting.upsert`; update the adapter test double in Step 5 if you keep `findFirst`+`create`/`update`. (Adjust the stub to expose `findFirst`, `create`, `update` returning `{ id: 'x' }` / undefined so the two-call path runs.) Re-run until green.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd services/delivery-service && npx jest test/unit/settings.repository.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/delivery-service/prisma services/delivery-service/src/application/ports/settings.repository.ts services/delivery-service/src/infrastructure/prisma/settings.prisma.repository.ts services/delivery-service/test/unit/settings.repository.spec.ts
git commit -m "feat(delivery): service_settings table + repository"
```

---

## Task 3: Setting registry + settings service (delivery-service)

**Files:**
- Create: `services/delivery-service/src/config/setting-defs.ts`
- Create: `services/delivery-service/src/application/services/settings.service.ts`
- Test: `services/delivery-service/test/unit/settings.service.spec.ts`

**Interfaces:**
- Consumes: `SettingsRepository` (Task 2), `SettingType`, `SettingsCache` (Task 1).
- Produces:
  - `interface SettingDef { key: string; label: string; type: SettingType; unit?: string; min?: number; max?: number; envDefault: number | string }`
  - `const SETTING_DEFS: SettingDef[]`
  - `class SettingsService` with:
    - `schema(depotId: string | null): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }>`
    - `put(input: { scope: 'GLOBAL' | 'DEPOT'; depotId: string | null; key: string; value: string; updatedBy: string }): Promise<void>`
    - `reset(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void>`
    - `cache: SettingsCache` (exposed for the config service to read)

- [ ] **Step 1: Write the registry**

```ts
// services/delivery-service/src/config/setting-defs.ts
import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
}

// Business tunables ONLY. Env keys stay the boot-time fallback; values here are the
// documented defaults so the UI can show "ikut default (N)" before any override.
export const SETTING_DEFS: SettingDef[] = [
  { key: 'shiftLengthHours', label: 'Durasi shift', type: 'int', unit: 'jam', min: 1, max: 24, envDefault: 8 },
  { key: 'shiftBreakQuotaMinutes', label: 'Kuota istirahat', type: 'int', unit: 'menit', min: 0, max: 240, envDefault: 60 },
  { key: 'shiftCheckInRadiusMeters', label: 'Radius check-in', type: 'int', unit: 'meter', min: 10, max: 2000, envDefault: 150 },
  { key: 'maxActiveDeliveriesPerDriver', label: 'Maks pengiriman aktif / kurir', type: 'int', min: 1, max: 20, envDefault: 1 },
  { key: 'slaMinutes', label: 'SLA pengiriman', type: 'int', unit: 'menit', min: 15, max: 600, envDefault: 120 },
  { key: 'urbanSpeedKmph', label: 'Kecepatan rata-rata kota (ETA)', type: 'number', unit: 'km/jam', min: 5, max: 60, envDefault: 18 },
  { key: 'courierWeeklyTarget', label: 'Target mingguan kurir', type: 'int', unit: 'order', min: 0, max: 1000, envDefault: 60 },
  { key: 'courierRatePerDeliveryIdr', label: 'Komisi per pengiriman', type: 'money', unit: 'Rp', min: 0, max: 1000000, envDefault: 12000 },
  { key: 'noShowMinContactAttempts', label: 'Min. percobaan kontak sebelum no-show', type: 'int', min: 1, max: 10, envDefault: 2 },
  { key: 'noShowMinWaitSeconds', label: 'Min. tunggu sebelum no-show', type: 'int', unit: 'detik', min: 0, max: 3600, envDefault: 300 },
  { key: 'podRetentionDays', label: 'Retensi bukti pengiriman', type: 'int', unit: 'hari', min: 30, max: 3650, envDefault: 365 },
];

export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d]),
);
```

- [ ] **Step 2: Write the failing service test**

```ts
// services/delivery-service/test/unit/settings.service.spec.ts
import { SettingsCache, SettingRow } from '@hydromart/platform';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';

function repoWith(rows: SettingRow[]): SettingsRepository {
  const store = [...rows] as (SettingRow & { updatedBy: string })[];
  return {
    loadAll: async () => store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
    upsert: async (row) => {
      const i = store.findIndex((r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key);
      if (i >= 0) store[i] = row;
      else store.push(row);
    },
    remove: async (scope, depotId, key) => {
      const i = store.findIndex((r) => r.scope === scope && r.depotId === depotId && r.key === key);
      if (i >= 0) store.splice(i, 1);
    },
  };
}

describe('SettingsService', () => {
  it('schema returns effective values with env-default fallback', async () => {
    const repo = repoWith([{ scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '6' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    const out = await svc.schema(null);
    expect(out.effective.shiftLengthHours).toBe(6); // global override
    expect(out.effective.slaMinutes).toBe(120); // env default
  });

  it('put validates against the registry min/max and refreshes the cache', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.put({ scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '10', updatedBy: 'u1' });
    expect(svc.cache.effective('shiftLengthHours', 'int', 8)).toBe(10);
  });

  it('put rejects an unknown key', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'nope', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects an out-of-range value', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '99', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('reset removes an override so it falls back', async () => {
    const repo = repoWith([{ scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.reset('DEPOT', 'd1', 'shiftLengthHours');
    const out = await svc.schema('d1');
    expect(out.effective.shiftLengthHours).toBe(8); // back to env default
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/delivery-service && npx jest test/unit/settings.service.spec.ts`
Expected: FAIL — `SettingsService` not found.

- [ ] **Step 4: Write the service**

```ts
// services/delivery-service/src/application/services/settings.service.ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SettingsCache, coerce } from '@hydromart/platform';

import { SETTINGS_REPOSITORY, SettingsRepository } from '../ports/settings.repository';
import { SETTING_DEFS, SETTING_DEF_BY_KEY, SettingDef } from '../../config/setting-defs';

interface PutInput {
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  key: string;
  value: string;
  updatedBy: string;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly repo: SettingsRepository,
    public readonly cache: SettingsCache,
  ) {}

  async schema(
    depotId: string | null,
  ): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }> {
    await this.cache.refresh();
    const effective: Record<string, number | string> = {};
    for (const def of SETTING_DEFS) {
      effective[def.key] = this.cache.effective(def.key, def.type, def.envDefault, depotId);
    }
    return { defs: SETTING_DEFS, effective };
  }

  async put(input: PutInput): Promise<void> {
    const def = SETTING_DEF_BY_KEY[input.key];
    if (!def) {
      throw new BadRequestException(`Unknown setting: ${input.key}`);
    }
    if (input.scope === 'DEPOT' && !input.depotId) {
      throw new BadRequestException('depotId required for a DEPOT override');
    }
    const coerced = coerce(input.value, def.type);
    if (def.type !== 'string') {
      const n = coerced as number;
      if (def.min != null && n < def.min) throw new BadRequestException(`${input.key} below min ${def.min}`);
      if (def.max != null && n > def.max) throw new BadRequestException(`${input.key} above max ${def.max}`);
    }
    await this.repo.upsert({
      scope: input.scope,
      depotId: input.scope === 'GLOBAL' ? null : input.depotId,
      key: input.key,
      value: String(coerced),
      updatedBy: input.updatedBy,
    });
    await this.cache.refresh();
  }

  async reset(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    await this.repo.remove(scope, scope === 'GLOBAL' ? null : depotId, key);
    await this.cache.refresh();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/delivery-service && npx jest test/unit/settings.service.spec.ts`
Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
git add services/delivery-service/src/config/setting-defs.ts services/delivery-service/src/application/services/settings.service.ts services/delivery-service/test/unit/settings.service.spec.ts
git commit -m "feat(delivery): settings registry + validation service"
```

---

## Task 4: Back the config getters with the cache (delivery-service)

**Files:**
- Modify: `services/delivery-service/src/config/delivery-config.service.ts`
- Test: `services/delivery-service/test/unit/delivery-config.spec.ts` (create)

**Interfaces:**
- Consumes: `SettingsCache` (Task 1), `SETTING_DEF_BY_KEY` (Task 3).
- Produces: existing getters now accept an optional `depotId`, returning the effective value; env stays the fallback.

- [ ] **Step 1: Write the failing test**

```ts
// services/delivery-service/test/unit/delivery-config.spec.ts
import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';

function cacheWith(rows: SettingRow[]): SettingsCache {
  const cache = new SettingsCache({ loadAll: async () => rows });
  return cache;
}

describe('DeliveryConfigService with settings cache', () => {
  const env = new ConfigService({ SHIFT_LENGTH_HOURS: '8' } as never);

  it('returns depot override when present', async () => {
    const cache = cacheWith([{ scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6' }]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(env, cache);
    expect(cfg.shiftLengthHours('d1')).toBe(6);
  });

  it('falls back to env when no override', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(env, cache);
    expect(cfg.shiftLengthHours('d1')).toBe(8);
    expect(cfg.shiftLengthHours()).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/delivery-service && npx jest test/unit/delivery-config.spec.ts`
Expected: FAIL — constructor arity / `shiftLengthHours is not a function`.

- [ ] **Step 3: Modify the config service**

Inject the cache and route the business getters through it. Example for the shift getters — apply the same shape to every business key in the registry (`shiftLengthHours`, `shiftBreakQuotaMinutes`, `shiftCheckInRadiusMeters`, `maxActiveDeliveriesPerDriver`, `slaMinutes`, `urbanSpeedKmph`, `courierWeeklyTarget`, `courierRatePerDeliveryIdr`, `noShowMinContactAttempts`, `noShowMinWaitSeconds`, `podRetentionDays`). Leave infra getters (URLs, keys, storage, CORS, rate-limit, port) untouched.

```ts
// services/delivery-service/src/config/delivery-config.service.ts  (excerpt)
import { SettingsCache } from '@hydromart/platform';
import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class DeliveryConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  /** Effective business value: depot override ?? global ?? ENV default from the registry. */
  private tunable(key: string, depotId: string | null = null): number {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, def.envDefault, depotId) as number;
  }

  shiftLengthHours(depotId: string | null = null): number {
    return this.tunable('shiftLengthHours', depotId);
  }
  shiftBreakQuotaMinutes(depotId: string | null = null): number {
    return this.tunable('shiftBreakQuotaMinutes', depotId);
  }
  get shiftCheckInRadiusMeters(): number {
    return this.tunable('shiftCheckInRadiusMeters');
  }
  // ...repeat for the remaining business getters; convert to a method taking depotId
  // wherever a per-depot value is meaningful (shift/SLA/commission/target), keep a
  // no-arg getter where only the global value is ever used.
}
```

**Call-site sweep:** the getters that changed from property to method (e.g. `shiftLengthHours` → `shiftLengthHours(depotId)`) need every caller updated. Run `grep -rn "config.shiftLengthHours" services/delivery-service/src` and pass the shift's `depotId` at each call (shifts, settlement, performance all carry a `depotId`). Where no depot context exists, call with no arg (global).

- [ ] **Step 4: Run the config test + the full delivery suite**

Run: `cd services/delivery-service && npx jest test/unit/delivery-config.spec.ts && npx jest`
Expected: config test PASS; whole suite green (fix any call-site breaks the sweep surfaced).

- [ ] **Step 5: Commit**

```bash
git add services/delivery-service/src/config/delivery-config.service.ts services/delivery-service/test/unit/delivery-config.spec.ts services/delivery-service/src
git commit -m "feat(delivery): resolve shift/SLA/commission tunables per depot"
```

---

## Task 5: HTTP endpoints + module wiring (delivery-service)

**Files:**
- Create: `services/delivery-service/src/modules/dto/settings.dto.ts`
- Create: `services/delivery-service/src/modules/settings.controller.ts`
- Modify: the delivery Nest module (where providers/controllers are registered) + `main.ts`/bootstrap for the cache refresh timer.
- Test: `services/delivery-service/test/e2e/settings.e2e.spec.ts`

**Interfaces:**
- Consumes: `SettingsService` (Task 3), `CAPABILITIES.depotAdmin` (`@hydromart/access`), the existing `@Roles`/`RolesGuard` + `AuthenticatedUser`.
- Produces HTTP:
  - `GET /api/v1/settings/schema?depotId=<id?>` → `{ defs: SettingDef[]; effective: Record<string, number|string> }` (read: `depotAdmin`)
  - `PUT /api/v1/settings` body `{ scope, depotId?, key, value }` → `204` (write: `depotAdmin`)
  - `DELETE /api/v1/settings` body `{ scope, depotId?, key }` → `204` (reset: `depotAdmin`)

- [ ] **Step 1: Write the DTOs**

```ts
// services/delivery-service/src/modules/dto/settings.dto.ts
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PutSettingDto {
  @IsIn(['GLOBAL', 'DEPOT'])
  scope!: 'GLOBAL' | 'DEPOT';

  @IsOptional()
  @IsUUID()
  depotId?: string;

  @IsString()
  @MaxLength(64)
  key!: string;

  @IsString()
  @MaxLength(128)
  value!: string;
}

export class ResetSettingDto {
  @IsIn(['GLOBAL', 'DEPOT'])
  scope!: 'GLOBAL' | 'DEPOT';

  @IsOptional()
  @IsUUID()
  depotId?: string;

  @IsString()
  @MaxLength(64)
  key!: string;
}
```

- [ ] **Step 2: Write the failing e2e test**

```ts
// services/delivery-service/test/e2e/settings.e2e.spec.ts
// Follow the existing delivery e2e bootstrap (see delivery.e2e.spec.ts) for app setup,
// auth token minting, and DB reset. Assert:
//   - GET /api/v1/settings/schema as DEPOT_MANAGER → 200, body.effective.shiftLengthHours === 8
//   - PUT /api/v1/settings {scope:'GLOBAL',key:'shiftLengthHours',value:'6'} as DEPOT_MANAGER → 204
//   - GET again → body.effective.shiftLengthHours === 6
//   - PUT as DRIVER → 403 (lacks depotAdmin)
//   - PUT {key:'shiftLengthHours', value:'99'} → 400 (out of range)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/delivery-service && npx jest test/e2e/settings.e2e.spec.ts`
Expected: FAIL — route 404.

- [ ] **Step 4: Write the controller**

```ts
// services/delivery-service/src/modules/settings.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Query, Put, Req, UseGuards } from '@nestjs/common';
import { CAPABILITIES } from '@hydromart/access';

import { SettingsService } from '../application/services/settings.service';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';
// Reuse the service's existing Roles decorator + RolesGuard + AuthenticatedUser imports
// (match the paths used by the other delivery controllers).

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('schema')
  @Roles(...CAPABILITIES.depotAdmin)
  schema(@Query('depotId') depotId?: string) {
    return this.settings.schema(depotId ?? null);
  }

  @Put()
  @Roles(...CAPABILITIES.depotAdmin)
  @HttpCode(204)
  async put(@Body() dto: PutSettingDto, @Req() req: { user: { sub: string } }) {
    await this.settings.put({
      scope: dto.scope,
      depotId: dto.depotId ?? null,
      key: dto.key,
      value: dto.value,
      updatedBy: req.user.sub,
    });
  }

  @Delete()
  @Roles(...CAPABILITIES.depotAdmin)
  @HttpCode(204)
  async reset(@Body() dto: ResetSettingDto) {
    await this.settings.reset(dto.scope, dto.depotId ?? null, dto.key);
  }
}
```

- [ ] **Step 5: Wire the module + boot refresh**

In the delivery Nest module: provide `SettingsPrismaRepository` under `SETTINGS_REPOSITORY`; provide `SettingsCache` via a factory `useFactory: (repo) => new SettingsCache(repo)` injecting `SETTINGS_REPOSITORY`; provide `SettingsService`; register `SettingsController`. Provide `DeliveryConfigService` with the cache (already updated in Task 4).

In bootstrap (`main.ts` or a module `onModuleInit`): after the app starts, call `settingsCache.refresh()` once, then `setInterval(() => settingsCache.refresh().catch(() => {}), settingsCache.ttl)`. Keep the interval `unref()`'d so it never blocks shutdown.

```ts
// excerpt in the module:
{
  provide: SettingsCache,
  useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
  inject: [SETTINGS_REPOSITORY],
},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/delivery-service && npx jest test/e2e/settings.e2e.spec.ts && npx jest`
Expected: e2e PASS; full delivery suite green.

- [ ] **Step 7: Typecheck the service**

Run: `cd services/delivery-service && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add services/delivery-service/src/modules services/delivery-service/test/e2e/settings.e2e.spec.ts services/delivery-service/src
git commit -m "feat(delivery): settings schema/put/reset endpoints (depotAdmin)"
```

---

## Task 6: Gateway route for delivery settings

**Files:**
- Modify: the gateway route map (where `delivery` routes are proxied — search `delivery` in `services/gateway-service/src`).
- Test: extend the gateway route test if one enumerates allowed prefixes.

**Interfaces:**
- Produces: `/{delivery-prefix}/api/v1/settings/*` reachable through the gateway with auth forwarded.

- [ ] **Step 1:** Confirm whether the gateway proxies by prefix wildcard (then no change needed) or an explicit allow-list. Run: `grep -rn "settings\|api/v1" services/gateway-service/src | head`.
- [ ] **Step 2:** If explicit, add the `settings` path to the delivery route group, mirroring an existing delivery route entry.
- [ ] **Step 3:** Run the gateway suite: `cd services/gateway-service && npx jest`. Expected: green.
- [ ] **Step 4: Commit** `git commit -m "feat(gateway): expose delivery settings routes"` (skip if wildcard already covers it — note that in the commit-less step).

---

## Task 7: Web settings page (delivery keys)

**Files:**
- Create: `apps/web/src/lib/settings.ts`
- Create: `apps/web/src/app/dashboard/settings/page.tsx`
- Modify: `apps/web/src/lib/dictionaries/id/*` + `.../en/*` — add a `settings` fragment (register in the locale barrel like the other fragments).
- Modify: the ops nav component (add "Pengaturan" gated by `can('depotAdmin', role)`).

**Interfaces:**
- Consumes: gateway `GET /delivery/api/v1/settings/schema?depotId=`, `PUT /delivery/api/v1/settings`, `DELETE`. Depot list from the existing depots endpoint.
- Produces:
  - `interface SettingsSchema { defs: { key: string; label: string; type: string; unit?: string; min?: number; max?: number; envDefault: number|string }[]; effective: Record<string, number|string> }`
  - `const SETTINGS_SERVICES: { id: string; label: string; base: string }[]` (starts with just delivery; later slices append)
  - `fetchSettingsSchema(base: string, depotId: string | null): Promise<SettingsSchema>`
  - `putSetting(base, body): Promise<void>`, `resetSetting(base, body): Promise<void>`

- [ ] **Step 1: Write the API helpers**

```ts
// apps/web/src/lib/settings.ts
import { apiFetch } from './api'; // match the project's existing fetch wrapper

export interface SettingDef {
  key: string;
  label: string;
  type: 'int' | 'number' | 'money' | 'string';
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
}
export interface SettingsSchema {
  defs: SettingDef[];
  effective: Record<string, number | string>;
}

// One row per service that exposes /settings/schema. Slices 2-5 append here.
export const SETTINGS_SERVICES = [
  { id: 'delivery', label: 'Pengiriman & Kurir', base: '/delivery/api/v1' },
] as const;

export async function fetchSettingsSchema(base: string, depotId: string | null): Promise<SettingsSchema> {
  const q = depotId ? `?depotId=${encodeURIComponent(depotId)}` : '';
  return apiFetch(`${base}/settings/schema${q}`);
}
export async function putSetting(
  base: string,
  body: { scope: 'GLOBAL' | 'DEPOT'; depotId?: string; key: string; value: string },
): Promise<void> {
  await apiFetch(`${base}/settings`, { method: 'PUT', body: JSON.stringify(body) });
}
export async function resetSetting(
  base: string,
  body: { scope: 'GLOBAL' | 'DEPOT'; depotId?: string; key: string },
): Promise<void> {
  await apiFetch(`${base}/settings`, { method: 'DELETE', body: JSON.stringify(body) });
}
```

- [ ] **Step 2: Write the page**

A client page with: a scope switch (Global default vs a depot picked from the depot list), a section per service in `SETTINGS_SERVICES`, and per key: current effective value, an input constrained by `type`/`min`/`max`, a "Simpan" (PUT) and a "Ikut default" (DELETE reset, shown only when an override exists). On save, re-fetch the schema. Match the existing dashboard page shell/styling (copy structure from a sibling `dashboard/*/page.tsx`). Guard the whole page with the existing role check used by other ops pages; redirect if `!can('depotAdmin', role)`.

- [ ] **Step 3: Add the nav entry + dictionary keys**

Add "Pengaturan" → `/dashboard/settings` to the ops nav, wrapped in `can('depotAdmin', role)`. Add `settings` label fragment to id + en dictionaries and register it in each locale's barrel (mirror an existing fragment like `dashC`).

- [ ] **Step 4: Typecheck + build the web app**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: 0 type errors; production build succeeds (watch for the "no non-route exports from page.tsx" rule — keep constants in `lib/settings.ts`, not the page).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/settings.ts apps/web/src/app/dashboard/settings apps/web/src/lib/dictionaries apps/web/src/components
git commit -m "feat(web): per-depot settings editor (delivery tunables)"
```

---

## Task 8: Replicate to order-service

**Same template as Tasks 2–7**, delivery → order. This slice proves the pattern is copy-paste per service.

**Registry keys (`services/order-service/src/config/setting-defs.ts`):**
- `deliveryFee` — label "Ongkir per galon", type `money`, unit "Rp", min 0, max 100000, envDefault 1000.
- `abandonMinutes` — label "Batas keranjang terbengkalai", type `int`, unit "menit", min 5, max 1440, envDefault (read the current `abandonMinutes` env default in `order-config.service.ts:51` and copy it verbatim).

**Steps:** Task 2 (table + repo + migration `20260724181000_service_settings`), Task 3 (registry + service), Task 4 (back `deliveryFee`/`abandonMinutes` getters — `deliveryFee` becomes per-depot; sweep callers), Task 5 (controller + module + boot refresh), Task 6 (gateway), then in **Task 7 web** append `{ id: 'order', label: 'Order & Ongkir', base: '/order/api/v1' }` to `SETTINGS_SERVICES`. TDD each step exactly as delivery; commit per task.

---

## Task 9: Replicate to payout-service

**Registry keys (`services/payout-service/src/config/setting-defs.ts`):**
- `commissionRate` — label "Rate komisi payout", type `number`, unit "rasio (0–1)", min 0, max 1, envDefault 0.05.
- `expenseAutoApproveMaxIdr` — label "Batas auto-approve klaim biaya", type `money`, unit "Rp", min 0, max 10000000, envDefault (copy from `payout-config.service.ts` `expenseAutoApproveMaxIdr`).

Migration `20260724182000_service_settings`. Same 6-step template; append `{ id: 'payout', label: 'Payout & Komisi', base: '/payout/api/v1' }` to web `SETTINGS_SERVICES`.

---

## Task 10: Replicate to loyalty-service

**Registry keys:**
- `earnRateRupiah` — label "Rupiah per 1 poin", type `money`, unit "Rp", min 1, max 1000000, envDefault (copy from `loyalty-config.service.ts` `earnRateRupiah`).
- `pointExpiryMonths` — label "Masa berlaku poin", type `int`, unit "bulan", min 1, max 120, envDefault (copy from `pointExpiryMonths`).

Migration `20260724183000_service_settings`. Same template; append `{ id: 'loyalty', label: 'Loyalty / Poin', base: '/loyalty/api/v1' }`.

---

## Task 11: Replicate to referral-service

**Registry keys:**
- `referrerPoints` — label "Poin untuk pengajak", type `int`, unit "poin", min 0, max 100000, envDefault (copy from `referral-config.service.ts` `referrerPoints`).
- `refereePoints` — label "Poin untuk yang diajak", type `int`, unit "poin", min 0, max 100000, envDefault (copy from `refereePoints`).

Migration `20260724184000_service_settings`. Same template; append `{ id: 'referral', label: 'Referral', base: '/referral/api/v1' }`.

---

## Task 12: Replicate to depot-service

**Registry keys:**
- `gallonDepositIdr` — label "Deposit galon", type `money`, unit "Rp", min 0, max 1000000, envDefault (copy from `depot-config.service.ts` `gallonDepositIdr`).
- `approvalAutoPassIdr` — label "Batas auto-pass approval", type `money`, unit "Rp", min 0, max 100000000, envDefault (copy from `approvalAutoPassIdr`).

(`pricingTimeZone` is a `string` op setting — include only if the user wants TZ editable; default: leave env-only.) Migration `20260724185000_service_settings`. Same template; append `{ id: 'depot', label: 'Depot & Galon', base: '/depot/api/v1' }`.

---

## Task 13: Live migration + rebuild

**Files:** none (ops).

- [ ] **Step 1:** Apply the six `service_settings` migrations to live PG (per [[hydromart-pending-apply]] recipe): per service `prisma migrate deploy` (bulk `migrate-prod.sh` is blocked by the auto-mode classifier). Order irrelevant — all additive, each has `rollback.sql`.
- [ ] **Step 2:** Rebuild the changed images serially: `bash scripts/rebuild-stale.sh delivery order payout loyalty referral depot gateway web` (both compose files), then `--profile tls up -d`.
- [ ] **Step 3:** Smoke: `GET /delivery/api/v1/settings/schema` → 401 unauth; login as SUPER_ADMIN → 200; edit `shiftLengthHours` global to a new value → re-fetch shows it; a driver check-in after edit reflects the new expected end. Confirm empty-override depots still read env defaults.
- [ ] **Step 4: Commit** any compose/env doc tweaks. `git commit -m "chore: document service_settings deploy"`.

---

## Self-Review Notes

- **Spec coverage:** Q1 (shift break/length editable) → Tasks 2–7 (delivery includes both, per-depot). "Semua setting business tunable" → Tasks 8–12 cover order/payout/loyalty/referral/depot; the six-service key inventory matches the config-service audit. Secrets/URLs excluded per Global Constraints.
- **ENV fallback preserved:** every `setting-defs.ts` carries `envDefault`; empty table ⇒ env behavior (tested in Task 1 Step 1 "returns env default before first refresh" and Task 3 "env default" case).
- **Type consistency:** `SettingRow`, `SettingsSource`, `SettingsCache.effective(key,type,envDefault,depotId)`, `SettingDef`, `SETTING_DEF_BY_KEY`, `SettingsService.{schema,put,reset,cache}` names are used identically across Tasks 1→7.
- **Known ceiling (ponytail):** 30s cache TTL means an edit takes up to 30s to propagate across instances (immediate on the instance that wrote it). Fine for business tunables; add a Redis pub/sub invalidation only if instant cross-instance propagation is ever required.
- **Open item to confirm during Task 6:** whether the gateway proxies delivery routes by wildcard (no change) or an allow-list (one-line add).
