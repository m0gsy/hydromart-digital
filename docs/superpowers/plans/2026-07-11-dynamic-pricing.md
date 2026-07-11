# Dynamic Pricing (M-R3.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let depot managers define time/condition-based price adjustments per depot that apply automatically at checkout.

**Architecture:** Extend depot-service (already the pricing authority — owns `Depot` + per-depot `sellPrice` + the `/inventory/prices` endpoint order-service calls). A new `PricingRule` entity + pure resolution domain serve the winning active rule; the existing prices endpoint carries it; order-service applies it to its resolved base price (`override ?? catalog basePrice`). A staff console authors rules.

**Tech Stack:** NestJS + Prisma (service-local generated client), TypeScript, Jest (ts-jest, in-memory port fakes — no DB in tests), Next.js 15 App Router + vitest (web).

## Global Constraints

- **Exactly one rule per product per checkout** — no stacking/compounding (mirrors BR-015 one-voucher). Precedence: product-specific > depot-wide, then higher `priority`, then newest `createdAt`.
- **Fail-open at checkout** — any depot-service error ⇒ no adjustment ⇒ catalog/override base price. Never block an order.
- **Single timezone** `PRICING_TZ`, default `Asia/Jakarta` (WIB). Multi-TZ deferred.
- **Targeting = depot-wide (`productId=null`) or product-specific only.** No category targeting (depot-service has no product→category map).
- **Money helper `money()`** rounds to 2dp — keep using it for final unit prices.
- Every service keeps its Prisma generator `output` at the service-local dir; run `npm run db:generate` (or the service's `prisma:generate`) after a schema change.
- **`.env` gotcha:** e2e config validation reads the gitignored per-service `.env`; a new required env var must be added there for local `npm test`. `PRICING_TZ` has a default, so no `.env` change needed.
- New backend logic ⇒ Jest unit/e2e with in-memory fakes; new web pure logic ⇒ vitest. Commit per task.
- depot-service lint gotcha: `npm run lint` mis-globs generated Prisma files — run `npx eslint "src/**/*.ts" "test/**/*.ts"` directly.

---

### Task 1: PricingRule schema, enum, migration (depot-service)

**Files:**
- Modify: `services/depot-service/prisma/schema.prisma`
- Create: `services/depot-service/prisma/migrations/0007_pricing_rules/migration.sql`
- Create: `services/depot-service/prisma/migrations/0007_pricing_rules/rollback.sql`

**Interfaces:**
- Produces: Prisma `PricingRule` model + `PricingAdjustType` enum, table `pricing_rules`.

- [ ] **Step 1: Add the enum + model to `schema.prisma`** (after the existing models):

```prisma
enum PricingAdjustType {
  PERCENT
  FIXED
}

model PricingRule {
  id          String            @id @default(uuid()) @db.Uuid
  depotId     String            @db.Uuid
  productId   String?           @db.Uuid
  adjustType  PricingAdjustType
  value       Decimal           @db.Decimal(12, 2)
  daysOfWeek  Int[]
  startMinute Int?
  endMinute   Int?
  validFrom   DateTime?
  validUntil  DateTime?
  priority    Int               @default(0)
  active      Boolean           @default(true)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([depotId])
  @@map("pricing_rules")
}
```

- [ ] **Step 2: Write `migration.sql`:**

```sql
-- 0007_pricing_rules
CREATE TYPE "PricingAdjustType" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depotId" UUID NOT NULL,
    "productId" UUID,
    "adjustType" "PricingAdjustType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_rules_depotId_idx" ON "pricing_rules"("depotId");
```

- [ ] **Step 3: Write `rollback.sql`:**

```sql
DROP TABLE IF EXISTS "pricing_rules";
DROP TYPE IF EXISTS "PricingAdjustType";
```

- [ ] **Step 4: Regenerate the client + validate:**

Run: `cd services/depot-service && npx prisma generate && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀" and client regenerated.

- [ ] **Step 5: Commit**

```bash
git add services/depot-service/prisma
git commit -m "feat(depot): PricingRule schema + 0007 migration (dynamic pricing)"
```

---

### Task 2: Pricing-rule domain (depot-service)

**Files:**
- Create: `services/depot-service/src/domain/pricing-rule.ts`
- Test: `services/depot-service/test/unit/pricing-rule.spec.ts`

**Interfaces:**
- Produces:
  - `enum PricingAdjustType { PERCENT='PERCENT', FIXED='FIXED' }`
  - `interface PricingRuleRecord { id; depotId; productId: string|null; adjustType: PricingAdjustType; value: number; daysOfWeek: number[]; startMinute: number|null; endMinute: number|null; validFrom: Date|null; validUntil: Date|null; priority: number; active: boolean; createdAt: Date; updatedAt: Date }`
  - `localParts(now: Date, timeZone: string): { weekday: number; minute: number }` — weekday 0=Sun..6=Sat, minute 0..1439, in `timeZone`.
  - `isRuleActive(rule: PricingRuleRecord, now: Date, timeZone: string): boolean`
  - `resolveRule(rules: PricingRuleRecord[], productId: string, now: Date, timeZone: string): PricingRuleRecord | null`

- [ ] **Step 1: Write the failing test** `test/unit/pricing-rule.spec.ts`:

```ts
import {
  PricingAdjustType,
  PricingRuleRecord,
  isRuleActive,
  localParts,
  resolveRule,
} from '../../src/domain/pricing-rule';

const TZ = 'Asia/Jakarta'; // UTC+7, no DST

function rule(over: Partial<PricingRuleRecord>): PricingRuleRecord {
  return {
    id: 'r1',
    depotId: 'd1',
    productId: null,
    adjustType: PricingAdjustType.PERCENT,
    value: -10,
    daysOfWeek: [],
    startMinute: null,
    endMinute: null,
    validFrom: null,
    validUntil: null,
    priority: 0,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('localParts', () => {
  it('converts UTC to the depot timezone weekday + minute', () => {
    // 2026-07-11 is a Saturday. 02:30 UTC = 09:30 WIB (UTC+7) → still Saturday.
    const p = localParts(new Date('2026-07-11T02:30:00Z'), TZ);
    expect(p.weekday).toBe(6); // Saturday
    expect(p.minute).toBe(9 * 60 + 30);
  });

  it('rolls the weekday forward across the UTC/local date boundary', () => {
    // 2026-07-11 20:00 UTC = 2026-07-12 03:00 WIB → Sunday.
    const p = localParts(new Date('2026-07-11T20:00:00Z'), TZ);
    expect(p.weekday).toBe(0); // Sunday
    expect(p.minute).toBe(3 * 60);
  });
});

describe('isRuleActive', () => {
  const now = new Date('2026-07-11T05:00:00Z'); // 12:00 WIB Saturday, minute 720

  it('is active with no window constraints', () => {
    expect(isRuleActive(rule({}), now, TZ)).toBe(true);
  });

  it('is inactive when the flag is off', () => {
    expect(isRuleActive(rule({ active: false }), now, TZ)).toBe(false);
  });

  it('matches only listed days of week', () => {
    expect(isRuleActive(rule({ daysOfWeek: [6] }), now, TZ)).toBe(true); // Sat
    expect(isRuleActive(rule({ daysOfWeek: [1, 2] }), now, TZ)).toBe(false);
  });

  it('matches the time-of-day window (end exclusive)', () => {
    expect(isRuleActive(rule({ startMinute: 600, endMinute: 780 }), now, TZ)).toBe(true); // 10:00–13:00
    expect(isRuleActive(rule({ startMinute: 0, endMinute: 720 }), now, TZ)).toBe(false); // ends at 12:00 (exclusive)
  });

  it('matches the valid date range (inclusive)', () => {
    expect(isRuleActive(rule({ validFrom: new Date('2026-07-01T00:00:00Z') }), now, TZ)).toBe(true);
    expect(isRuleActive(rule({ validUntil: new Date('2026-07-01T00:00:00Z') }), now, TZ)).toBe(false);
  });
});

describe('resolveRule', () => {
  const now = new Date('2026-07-11T05:00:00Z');

  it('returns null when no rule matches', () => {
    expect(resolveRule([], 'p1', now, TZ)).toBeNull();
    expect(resolveRule([rule({ active: false })], 'p1', now, TZ)).toBeNull();
  });

  it('prefers a product-specific rule over a depot-wide one', () => {
    const wide = rule({ id: 'wide', productId: null, priority: 100 });
    const specific = rule({ id: 'specific', productId: 'p1', priority: 0 });
    expect(resolveRule([wide, specific], 'p1', now, TZ)?.id).toBe('specific');
  });

  it('breaks ties by priority then newest', () => {
    const a = rule({ id: 'a', productId: 'p1', priority: 1, createdAt: new Date('2026-01-01T00:00:00Z') });
    const b = rule({ id: 'b', productId: 'p1', priority: 2, createdAt: new Date('2026-01-01T00:00:00Z') });
    const c = rule({ id: 'c', productId: 'p1', priority: 2, createdAt: new Date('2026-02-01T00:00:00Z') });
    expect(resolveRule([a, b, c], 'p1', now, TZ)?.id).toBe('c');
  });

  it('applies a depot-wide rule to any product', () => {
    const wide = rule({ id: 'wide', productId: null });
    expect(resolveRule([wide], 'anything', now, TZ)?.id).toBe('wide');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/depot-service && npx jest test/unit/pricing-rule.spec.ts`
Expected: FAIL — cannot find module `../../src/domain/pricing-rule`.

- [ ] **Step 3: Write `src/domain/pricing-rule.ts`:**

```ts
export enum PricingAdjustType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export interface PricingRuleRecord {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  /** 0=Sun..6=Sat; empty = every day. */
  daysOfWeek: number[];
  /** Minutes since local midnight; null = all day. endMinute is exclusive. */
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Weekday (0=Sun..6=Sat) and minute-of-day for `now` in the given IANA timezone. */
export function localParts(now: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  return { weekday, minute };
}

/** True when `rule` is enabled and `now` falls inside its day / time-of-day / date window. */
export function isRuleActive(rule: PricingRuleRecord, now: Date, timeZone: string): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && now < rule.validFrom) return false;
  if (rule.validUntil && now > rule.validUntil) return false;

  const { weekday, minute } = localParts(now, timeZone);
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(weekday)) return false;
  if (rule.startMinute !== null && minute < rule.startMinute) return false;
  if (rule.endMinute !== null && minute >= rule.endMinute) return false;
  return true;
}

/**
 * The single winning rule for a product at `now`, or null. Considers active,
 * in-window rules that target this product OR the whole depot (productId=null).
 * Precedence: product-specific beats depot-wide, then higher priority, then newest.
 */
export function resolveRule(
  rules: PricingRuleRecord[],
  productId: string,
  now: Date,
  timeZone: string,
): PricingRuleRecord | null {
  const candidates = rules.filter(
    (r) =>
      (r.productId === productId || r.productId === null) && isRuleActive(r, now, timeZone),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aSpecific = a.productId === null ? 0 : 1;
    const bSpecific = b.productId === null ? 0 : 1;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return candidates[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/depot-service && npx jest test/unit/pricing-rule.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add services/depot-service/src/domain/pricing-rule.ts services/depot-service/test/unit/pricing-rule.spec.ts
git commit -m "feat(depot): pricing-rule domain (window match + precedence)"
```

---

### Task 3: PricingRule repository port + Prisma adapter + fake (depot-service)

**Files:**
- Create: `services/depot-service/src/application/ports/pricing-rule.repository.ts`
- Create: `services/depot-service/src/infrastructure/prisma/pricing-rule.prisma.repository.ts`
- Modify: `services/depot-service/src/application/tokens.ts` (add `PricingRuleRepository` token)
- Modify: `services/depot-service/test/support/fakes.ts` (add `FakePricingRuleRepository`)

**Interfaces:**
- Consumes: `PricingRuleRecord`, `PricingAdjustType` from Task 2.
- Produces:
  - `interface CreatePricingRuleData { depotId; productId: string|null; adjustType: PricingAdjustType; value: number; daysOfWeek: number[]; startMinute: number|null; endMinute: number|null; validFrom: Date|null; validUntil: Date|null; priority: number; active: boolean }`
  - `interface UpdatePricingRuleData { productId?: string|null; adjustType?; value?; daysOfWeek?; startMinute?: number|null; endMinute?: number|null; validFrom?: Date|null; validUntil?: Date|null; priority?; active? }`
  - `interface PricingRuleRepository { create(d): Promise<PricingRuleRecord>; findById(id): Promise<PricingRuleRecord|null>; listForDepot(depotId): Promise<PricingRuleRecord[]>; listActiveForDepot(depotId): Promise<PricingRuleRecord[]>; update(id, patch): Promise<PricingRuleRecord>; delete(id): Promise<void> }`
  - `DEPOT_TOKENS.PricingRuleRepository` token.
  - `FakePricingRuleRepository` implementing the port (in-memory).

- [ ] **Step 1: Write the port** `src/application/ports/pricing-rule.repository.ts`:

```ts
import { PricingAdjustType, PricingRuleRecord } from '../../domain/pricing-rule';

export interface CreatePricingRuleData {
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
}

export interface UpdatePricingRuleData {
  productId?: string | null;
  adjustType?: PricingAdjustType;
  value?: number;
  daysOfWeek?: number[];
  startMinute?: number | null;
  endMinute?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  priority?: number;
  active?: boolean;
}

export interface PricingRuleRepository {
  create(data: CreatePricingRuleData): Promise<PricingRuleRecord>;
  findById(id: string): Promise<PricingRuleRecord | null>;
  /** All rules for a depot (incl. inactive) for the admin console. */
  listForDepot(depotId: string): Promise<PricingRuleRecord[]>;
  /** Only enabled rules; time-window filtering happens in the domain. */
  listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]>;
  update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 2: Add the token** to `src/application/tokens.ts` — add inside the existing `DEPOT_TOKENS` object:

```ts
  PricingRuleRepository: Symbol('PricingRuleRepository'),
```

- [ ] **Step 3: Write the Prisma adapter** `src/infrastructure/prisma/pricing-rule.prisma.repository.ts` (follow the existing `inventory.prisma.repository.ts` mapping style — Decimal→number via `Number(row.value)`):

```ts
import { Injectable } from '@nestjs/common';

import { PricingAdjustType, PricingRuleRecord } from '../../domain/pricing-rule';
import {
  CreatePricingRuleData,
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../../application/ports/pricing-rule.repository';
import { PrismaService } from './prisma.service';

interface RuleRow {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: string;
  value: unknown; // Prisma Decimal
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PricingRulePrismaRepository implements PricingRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRule(row: RuleRow): PricingRuleRecord {
    return {
      id: row.id,
      depotId: row.depotId,
      productId: row.productId,
      adjustType: row.adjustType as PricingAdjustType,
      value: Number(row.value),
      daysOfWeek: row.daysOfWeek,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      priority: row.priority,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePricingRuleData): Promise<PricingRuleRecord> {
    const row = await this.prisma.pricingRule.create({ data });
    return this.toRule(row as unknown as RuleRow);
  }

  async findById(id: string): Promise<PricingRuleRecord | null> {
    const row = await this.prisma.pricingRule.findUnique({ where: { id } });
    return row ? this.toRule(row as unknown as RuleRow) : null;
  }

  async listForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    const rows = await this.prisma.pricingRule.findMany({
      where: { depotId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toRule(r as unknown as RuleRow));
  }

  async listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    const rows = await this.prisma.pricingRule.findMany({ where: { depotId, active: true } });
    return rows.map((r) => this.toRule(r as unknown as RuleRow));
  }

  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const row = await this.prisma.pricingRule.update({ where: { id }, data: patch });
    return this.toRule(row as unknown as RuleRow);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.pricingRule.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Add `FakePricingRuleRepository`** to `test/support/fakes.ts` (append; import the port + domain types at the top of the file alongside the existing imports):

```ts
// --- add to imports ---
import { PricingRuleRecord } from '../../src/domain/pricing-rule';
import {
  CreatePricingRuleData,
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../../src/application/ports/pricing-rule.repository';

// --- add to the body ---
export class FakePricingRuleRepository implements PricingRuleRepository {
  rows: PricingRuleRecord[] = [];
  private seq = 0;

  async create(data: CreatePricingRuleData): Promise<PricingRuleRecord> {
    const now = new Date('2026-01-01T00:00:00Z');
    const rule: PricingRuleRecord = { id: `rule-${++this.seq}`, createdAt: now, updatedAt: now, ...data };
    this.rows.push(rule);
    return rule;
  }
  async findById(id: string): Promise<PricingRuleRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rows.filter((r) => r.depotId === depotId);
  }
  async listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rows.filter((r) => r.depotId === depotId && r.active);
  }
  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('not found');
    Object.assign(row, patch);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd services/depot-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/depot-service/src/application/ports/pricing-rule.repository.ts \
  services/depot-service/src/infrastructure/prisma/pricing-rule.prisma.repository.ts \
  services/depot-service/src/application/tokens.ts \
  services/depot-service/test/support/fakes.ts
git commit -m "feat(depot): PricingRule repository port + prisma adapter + fake"
```

---

### Task 4: PricingService — CRUD + price resolution (depot-service)

**Files:**
- Create: `services/depot-service/src/application/services/pricing.service.ts`
- Modify: `services/depot-service/src/config/depot-config.service.ts` (add `pricingTimeZone`)
- Modify: `services/depot-service/src/config/env.validation.ts` (add `PRICING_TZ`)
- Modify: `services/depot-service/src/domain/errors.ts` (add `PricingRuleNotFoundError`, `InvalidPricingWindowError`)
- Test: `services/depot-service/test/unit/pricing.service.spec.ts`

**Interfaces:**
- Consumes: `PricingRuleRepository` (Task 3), `resolveRule` (Task 2), `InventoryRepository.findPrices`, `DepotRepository.findById`.
- Produces:
  - `interface ResolvedProductPrice { productId: string; sellPrice?: number; adjustType?: PricingAdjustType; value?: number }`
  - `interface CreateRuleInput` (same fields as `CreatePricingRuleData` minus `depotId`).
  - `class PricingService` with:
    - `create(depotId, input, ): Promise<PricingRuleRecord>`
    - `list(depotId): Promise<PricingRuleRecord[]>`
    - `update(id, patch): Promise<PricingRuleRecord>`
    - `remove(id): Promise<void>`
    - `resolvePrices(depotId, productIds, now?): Promise<ResolvedProductPrice[]>`
- `DepotConfigService.pricingTimeZone: string`.

- [ ] **Step 1: Add errors** to `src/domain/errors.ts` (follow the existing `DomainError`/`HTTP_STATUS` pattern used by e.g. `InventoryItemNotFoundError` / `NegativeStockError`):

```ts
export class PricingRuleNotFoundError extends DomainError {
  constructor() {
    super('PRICING_RULE_NOT_FOUND', 'Pricing rule not found.', HTTP_STATUS.NOT_FOUND);
  }
}

export class InvalidPricingWindowError extends DomainError {
  constructor(message = 'Invalid pricing rule window.') {
    super('INVALID_PRICING_WINDOW', message, HTTP_STATUS.UNPROCESSABLE);
  }
}
```

(Match the exact `super(...)` argument order the other errors in this file use; if it is `(message, code, status)` reorder accordingly.)

- [ ] **Step 2: Add config** — in `src/config/depot-config.service.ts` add a getter mirroring the existing `depotServiceUrl` one:

```ts
get pricingTimeZone(): string {
  return this.config.get<string>('PRICING_TZ', 'Asia/Jakarta');
}
```

In `src/config/env.validation.ts` add to the Joi schema (mirror an existing optional-with-default string key):

```ts
PRICING_TZ: Joi.string().default('Asia/Jakarta'),
```

- [ ] **Step 3: Write the failing test** `test/unit/pricing.service.spec.ts`:

```ts
import { PricingAdjustType } from '../../src/domain/pricing-rule';
import { PricingService, CreateRuleInput } from '../../src/application/services/pricing.service';
import { PricingRuleNotFoundError, InvalidPricingWindowError, DepotNotFoundError } from '../../src/domain/errors';
import { FakePricingRuleRepository } from '../support/fakes';

// Minimal inventory + depot repo fakes sufficient for pricing (findPrices / findById).
class InvStub {
  prices = new Map<string, number>(); // productId -> sellPrice
  async findPrices(_depotId: string, productIds: string[]) {
    return productIds
      .filter((id) => this.prices.has(id))
      .map((id) => ({ productId: id, sellPrice: this.prices.get(id)! }));
  }
}
class DepotStub {
  exists = true;
  async findById() {
    return this.exists ? ({ id: 'd1', name: 'Depot' } as never) : null;
  }
}

function make() {
  const rules = new FakePricingRuleRepository();
  const inv = new InvStub();
  const depots = new DepotStub();
  const config = { pricingTimeZone: 'Asia/Jakarta' } as never;
  const service = new PricingService(rules as never, inv as never, depots as never, config);
  return { service, rules, inv, depots };
}

const baseInput: CreateRuleInput = {
  productId: null,
  adjustType: PricingAdjustType.PERCENT,
  value: -10,
  daysOfWeek: [],
  startMinute: null,
  endMinute: null,
  validFrom: null,
  validUntil: null,
  priority: 0,
  active: true,
};

describe('PricingService CRUD', () => {
  it('rejects create for an unknown depot', async () => {
    const { service, depots } = make();
    depots.exists = false;
    await expect(service.create('d1', baseInput)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects an inverted time window', async () => {
    const { service } = make();
    await expect(
      service.create('d1', { ...baseInput, startMinute: 600, endMinute: 300 }),
    ).rejects.toBeInstanceOf(InvalidPricingWindowError);
  });

  it('rejects an inverted date range', async () => {
    const { service } = make();
    await expect(
      service.create('d1', {
        ...baseInput,
        validFrom: new Date('2026-07-10T00:00:00Z'),
        validUntil: new Date('2026-07-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidPricingWindowError);
  });

  it('creates, lists, updates, and removes a rule', async () => {
    const { service } = make();
    const created = await service.create('d1', baseInput);
    expect(await service.list('d1')).toHaveLength(1);
    const updated = await service.update(created.id, { value: -20 });
    expect(updated.value).toBe(-20);
    await service.remove(created.id);
    expect(await service.list('d1')).toHaveLength(0);
  });

  it('throws when updating a missing rule', async () => {
    const { service } = make();
    await expect(service.update('nope', { value: 1 })).rejects.toBeInstanceOf(PricingRuleNotFoundError);
  });
});

describe('PricingService.resolvePrices', () => {
  const at = new Date('2026-07-11T05:00:00Z'); // Sat 12:00 WIB

  it('merges sellPrice override and the winning rule per product', async () => {
    const { service, rules, inv } = make();
    inv.prices.set('p1', 15000);
    await service.create('d1', { ...baseInput, productId: 'p1', adjustType: PricingAdjustType.PERCENT, value: -10 });
    await service.create('d1', { ...baseInput, productId: null, adjustType: PricingAdjustType.FIXED, value: -500 });

    const out = await service.resolvePrices('d1', ['p1', 'p2'], at);
    const p1 = out.find((r) => r.productId === 'p1')!;
    expect(p1.sellPrice).toBe(15000);
    expect(p1.adjustType).toBe(PricingAdjustType.PERCENT); // product-specific beats depot-wide
    expect(p1.value).toBe(-10);

    const p2 = out.find((r) => r.productId === 'p2')!;
    expect(p2.sellPrice).toBeUndefined(); // no override
    expect(p2.adjustType).toBe(PricingAdjustType.FIXED); // depot-wide applies
    expect(p2.value).toBe(-500);
    void rules;
  });

  it('omits a product with neither an override nor a rule', async () => {
    const { service } = make();
    const out = await service.resolvePrices('d1', ['p9'], at);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/depot-service && npx jest test/unit/pricing.service.spec.ts`
Expected: FAIL — cannot find `pricing.service`.

- [ ] **Step 5: Write `src/application/services/pricing.service.ts`:**

```ts
import { Inject, Injectable } from '@nestjs/common';

import { PricingAdjustType, PricingRuleRecord, resolveRule } from '../../domain/pricing-rule';
import {
  DepotNotFoundError,
  InvalidPricingWindowError,
  PricingRuleNotFoundError,
} from '../../domain/errors';
import {
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../ports/pricing-rule.repository';
import { InventoryRepository } from '../ports/inventory.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DepotConfigService } from '../../config/depot-config.service';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateRuleInput {
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
}

export interface ResolvedProductPrice {
  productId: string;
  sellPrice?: number;
  adjustType?: PricingAdjustType;
  value?: number;
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DEPOT_TOKENS.PricingRuleRepository) private readonly rules: PricingRuleRepository,
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  private validateWindow(input: {
    startMinute: number | null;
    endMinute: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
  }): void {
    if (
      input.startMinute !== null &&
      input.endMinute !== null &&
      input.endMinute <= input.startMinute
    ) {
      throw new InvalidPricingWindowError('End time must be after start time.');
    }
    if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
      throw new InvalidPricingWindowError('Valid-until must not precede valid-from.');
    }
  }

  async create(depotId: string, input: CreateRuleInput): Promise<PricingRuleRecord> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    this.validateWindow(input);
    return this.rules.create({ depotId, ...input });
  }

  async list(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rules.listForDepot(depotId);
  }

  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const existing = await this.rules.findById(id);
    if (!existing) {
      throw new PricingRuleNotFoundError();
    }
    this.validateWindow({
      startMinute: patch.startMinute ?? existing.startMinute,
      endMinute: patch.endMinute ?? existing.endMinute,
      validFrom: patch.validFrom ?? existing.validFrom,
      validUntil: patch.validUntil ?? existing.validUntil,
    });
    return this.rules.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.rules.findById(id);
    if (!existing) {
      throw new PricingRuleNotFoundError();
    }
    await this.rules.delete(id);
  }

  /**
   * Per-product resolved pricing for checkout: the static sellPrice override (if any)
   * plus the single winning active rule (if any). A product with neither is omitted;
   * order-service then falls back to the catalog base price.
   */
  async resolvePrices(
    depotId: string,
    productIds: string[],
    now: Date = new Date(),
  ): Promise<ResolvedProductPrice[]> {
    if (productIds.length === 0) return [];
    const [overrides, activeRules] = await Promise.all([
      this.inventory.findPrices(depotId, productIds),
      this.rules.listActiveForDepot(depotId),
    ]);
    const overrideByProduct = new Map(overrides.map((o) => [o.productId, o.sellPrice]));
    const tz = this.config.pricingTimeZone;

    const out: ResolvedProductPrice[] = [];
    for (const productId of productIds) {
      const sellPrice = overrideByProduct.get(productId);
      const rule = resolveRule(activeRules, productId, now, tz);
      if (sellPrice === undefined && !rule) continue;
      out.push({
        productId,
        ...(sellPrice !== undefined ? { sellPrice } : {}),
        ...(rule ? { adjustType: rule.adjustType, value: rule.value } : {}),
      });
    }
    return out;
  }
}
```

Note: `DepotRepository.findById(depotId, false)` — the `false` matches the existing signature used in `inventory.service.ts` (include-inactive flag). Verify the arity against `depot.repository.ts` and adjust if it takes a single arg.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/depot-service && npx jest test/unit/pricing.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/depot-service/src/application/services/pricing.service.ts \
  services/depot-service/src/domain/errors.ts \
  services/depot-service/src/config
git commit -m "feat(depot): PricingService CRUD + resolvePrices (override + rule merge)"
```

---

### Task 5: Pricing controller + prices-route delegation + module wiring + e2e (depot-service)

**Files:**
- Create: `services/depot-service/src/modules/dto/pricing-rule.dto.ts`
- Create: `services/depot-service/src/modules/pricing.controller.ts`
- Modify: `services/depot-service/src/modules/inventory.controller.ts` (prices route → PricingService; return type)
- Modify: `services/depot-service/src/modules/depot.module.ts` (wire PricingService, repo provider, controller)
- Test: `services/depot-service/test/e2e/pricing.e2e.spec.ts`

**Interfaces:**
- Consumes: `PricingService`, `ResolvedProductPrice` (Task 4).
- Produces: routes `POST/GET/PATCH/DELETE /api/v1/depots/:depotId/pricing/rules[/:ruleId]` (@Roles DEPOT_MANAGER, SUPER_ADMIN); modified `GET /api/v1/depots/:depotId/inventory/prices` returning `ResolvedProductPrice[]`.

- [ ] **Step 1: Write the DTOs** `src/modules/dto/pricing-rule.dto.ts`:

```ts
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { PricingAdjustType } from '../../domain/pricing-rule';

export class CreatePricingRuleDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsEnum(PricingAdjustType)
  adjustType!: PricingAdjustType;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdatePricingRuleDto extends CreatePricingRuleDto {
  @IsOptional()
  @IsEnum(PricingAdjustType)
  declare adjustType?: PricingAdjustType;

  @IsOptional()
  @IsNumber()
  declare value?: number;
}
```

- [ ] **Step 2: Write the controller** `src/modules/pricing.controller.ts` (maps DTO strings → domain: `productId ?? null`, date strings → `Date`, defaults for arrays/priority/active):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { PricingService } from '../application/services/pricing.service';
import { PricingRuleRecord } from '../domain/pricing-rule';
import { UpdatePricingRuleData } from '../application/ports/pricing-rule.repository';
import { CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/pricing-rule.dto';

const PRICING_ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

function toDate(v?: string): Date | null {
  return v ? new Date(v) : null;
}

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Roles(...PRICING_ADMIN_ROLES)
  @Post('rules')
  @ApiOperation({ summary: 'Create a dynamic pricing rule for a depot (staff)' })
  create(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreatePricingRuleDto,
  ): Promise<PricingRuleRecord> {
    return this.pricing.create(depotId, {
      productId: dto.productId ?? null,
      adjustType: dto.adjustType,
      value: dto.value,
      daysOfWeek: dto.daysOfWeek ?? [],
      startMinute: dto.startMinute ?? null,
      endMinute: dto.endMinute ?? null,
      validFrom: toDate(dto.validFrom),
      validUntil: toDate(dto.validUntil),
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
    });
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Get('rules')
  @ApiOperation({ summary: "List a depot's pricing rules (staff)" })
  list(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<PricingRuleRecord[]> {
    return this.pricing.list(depotId);
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Patch('rules/:ruleId')
  @ApiOperation({ summary: 'Update a pricing rule (staff)' })
  update(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdatePricingRuleDto,
  ): Promise<PricingRuleRecord> {
    const patch: UpdatePricingRuleData = {};
    if (dto.productId !== undefined) patch.productId = dto.productId ?? null;
    if (dto.adjustType !== undefined) patch.adjustType = dto.adjustType;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.daysOfWeek !== undefined) patch.daysOfWeek = dto.daysOfWeek;
    if (dto.startMinute !== undefined) patch.startMinute = dto.startMinute;
    if (dto.endMinute !== undefined) patch.endMinute = dto.endMinute;
    if (dto.validFrom !== undefined) patch.validFrom = toDate(dto.validFrom);
    if (dto.validUntil !== undefined) patch.validUntil = toDate(dto.validUntil);
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.active !== undefined) patch.active = dto.active;
    return this.pricing.update(ruleId, patch);
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Delete('rules/:ruleId')
  @ApiOperation({ summary: 'Delete a pricing rule (staff)' })
  async remove(@Param('ruleId', ParseUUIDPipe) ruleId: string): Promise<{ deleted: boolean }> {
    await this.pricing.remove(ruleId);
    return { deleted: true };
  }
}
```

- [ ] **Step 3: Delegate the prices route to PricingService** — in `inventory.controller.ts`:
  - Add `import { PricingService, ResolvedProductPrice } from '../application/services/pricing.service';`
  - Change the `DepotInventoryController` constructor to also inject it:
    ```ts
    constructor(
      private readonly inventory: InventoryService,
      private readonly pricing: PricingService,
    ) {}
    ```
  - Replace the `prices(...)` handler body + return type:
    ```ts
    @Public()
    @Get('prices')
    @ApiOperation({ summary: 'Per-depot resolved prices (override + active rule) for products (public)' })
    prices(
      @Param('depotId', ParseUUIDPipe) depotId: string,
      @Query('productIds') productIds?: string,
    ): Promise<ResolvedProductPrice[]> {
      const ids = (productIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return this.pricing.resolvePrices(depotId, ids);
    }
    ```
  - The old `import { DepotProductPrice } from ...` may still be used by nothing else here — leave the `StockMovementRecord` import intact; drop `DepotProductPrice` from that import if it becomes unused (tsc will flag it).

- [ ] **Step 4: Wire the module** — in `depot.module.ts`:
  - Import `PricingService`, `PricingRulePrismaRepository`, `PricingController`.
  - Add to `providers`: `PricingService` and `{ provide: DEPOT_TOKENS.PricingRuleRepository, useClass: PricingRulePrismaRepository }`.
  - Add `PricingController` to `controllers`.

- [ ] **Step 5: Write the e2e** `test/e2e/pricing.e2e.spec.ts` — follow the existing `inventory` e2e harness (Test module with fakes, JWT signed from ConfigService secret, seed `process.env` before compile). Cover:

```ts
// Pseudocode structure — mirror test/e2e/inventory.e2e.spec.ts exactly for setup.
// 1. DEPOT_MANAGER token → POST /api/v1/depots/:depotId/pricing/rules { adjustType:'PERCENT', value:-10 } → 201
// 2. CUSTOMER token → same POST → 403
// 3. GET /api/v1/depots/:depotId/pricing/rules (manager) → 200, array length 1
// 4. PATCH rules/:id { value:-20 } (manager) → 200, value -20
// 5. DELETE rules/:id (manager) → 200 { deleted:true }
// 6. Public GET /api/v1/depots/:depotId/inventory/prices?productIds=<pid>
//    with an active depot-wide FIXED -500 rule seeded → row { productId, adjustType:'FIXED', value:-500 }
```

Register `FakePricingRuleRepository` for `DEPOT_TOKENS.PricingRuleRepository` and reuse the depot fake so `depots.findById` succeeds. Seed one rule via the service or fake before the prices assertion.

- [ ] **Step 6: Run the full depot suite**

Run: `cd services/depot-service && npx jest`
Expected: all suites pass (existing 49 + new pricing unit + e2e).

- [ ] **Step 7: Lint + typecheck + build**

Run: `cd services/depot-service && npx tsc --noEmit && npx eslint "src/**/*.ts" "test/**/*.ts" && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add services/depot-service/src/modules services/depot-service/test/e2e/pricing.e2e.spec.ts
git commit -m "feat(depot): pricing rule CRUD API + prices endpoint carries active rule"
```

---

### Task 6: applyAdjustment domain (order-service)

**Files:**
- Create: `services/order-service/src/domain/pricing.ts`
- Test: `services/order-service/test/unit/pricing.spec.ts`

**Interfaces:**
- Produces:
  - `type PriceAdjustType = 'PERCENT' | 'FIXED'`
  - `interface PriceAdjustment { adjustType: PriceAdjustType; value: number }`
  - `applyAdjustment(base: number, adj: PriceAdjustment | null): number` — clamped `>= 0`, not rounded (caller applies `money()`).

- [ ] **Step 1: Write the failing test** `test/unit/pricing.spec.ts`:

```ts
import { applyAdjustment } from '../../src/domain/pricing';

describe('applyAdjustment', () => {
  it('returns the base unchanged when there is no adjustment', () => {
    expect(applyAdjustment(15000, null)).toBe(15000);
  });

  it('applies a percentage discount', () => {
    expect(applyAdjustment(20000, { adjustType: 'PERCENT', value: -10 })).toBe(18000);
  });

  it('applies a percentage surge', () => {
    expect(applyAdjustment(20000, { adjustType: 'PERCENT', value: 5 })).toBe(21000);
  });

  it('applies a fixed delta', () => {
    expect(applyAdjustment(20000, { adjustType: 'FIXED', value: -2000 })).toBe(18000);
  });

  it('clamps to zero (never negative)', () => {
    expect(applyAdjustment(1500, { adjustType: 'FIXED', value: -3000 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/order-service && npx jest test/unit/pricing.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `src/domain/pricing.ts`:**

```ts
export type PriceAdjustType = 'PERCENT' | 'FIXED';

export interface PriceAdjustment {
  adjustType: PriceAdjustType;
  value: number;
}

/**
 * Applies a dynamic-pricing adjustment to a base unit price. PERCENT scales
 * (value = signed percent, -10 = 10% off, +5 = 5% surge); FIXED adds a signed
 * rupiah delta. Never returns below 0. The caller rounds with money().
 */
export function applyAdjustment(base: number, adj: PriceAdjustment | null): number {
  if (!adj) return base;
  const raw = adj.adjustType === 'PERCENT' ? base * (1 + adj.value / 100) : base + adj.value;
  return Math.max(0, raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/order-service && npx jest test/unit/pricing.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/order-service/src/domain/pricing.ts services/order-service/test/unit/pricing.spec.ts
git commit -m "feat(order): applyAdjustment pricing domain helper"
```

---

### Task 7: Consume the resolved rule at checkout (order-service)

**Files:**
- Modify: `services/order-service/src/application/ports/depot-pricing.port.ts`
- Modify: `services/order-service/src/infrastructure/http/depot-pricing.http.adapter.ts`
- Modify: `services/order-service/src/application/services/order.service.ts` (~lines 106-119)
- Modify: `services/order-service/test/support/fakes.ts` (`FakeDepotPricing`)
- Modify/Test: `services/order-service/test/unit/order.service.spec.ts` (add rule-applied case)

**Interfaces:**
- Consumes: `applyAdjustment`, `PriceAdjustType` (Task 6).
- Produces:
  - `interface DepotPrice { sellPrice?: number; adjustType?: PriceAdjustType; value?: number }`
  - `DepotPricingPort.getPrices(depotId, productIds): Promise<Map<string, DepotPrice>>`

- [ ] **Step 1: Change the port** `depot-pricing.port.ts`:

```ts
import { PriceAdjustType } from '../../domain/pricing';

/** A depot's resolved pricing for one product: optional override + optional active rule. */
export interface DepotPrice {
  sellPrice?: number;
  adjustType?: PriceAdjustType;
  value?: number;
}

/**
 * Reads per-depot resolved prices (static override + the winning active pricing
 * rule) from depot-service. Fails OPEN: any error returns an empty map, so
 * checkout falls back to the catalog base price with no adjustment.
 */
export interface DepotPricingPort {
  getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>>;
}
```

- [ ] **Step 2: Update the adapter** `depot-pricing.http.adapter.ts` — change the parsed body + map value:

```ts
// return type:
async getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>> {
  const prices = new Map<string, DepotPrice>();
  if (productIds.length === 0) return prices;
  // ...unchanged url + fetch + timeout...
  const body = (await res.json()) as {
    productId: string;
    sellPrice?: number;
    adjustType?: 'PERCENT' | 'FIXED';
    value?: number;
  }[];
  for (const row of body) {
    prices.set(row.productId, {
      ...(typeof row.sellPrice === 'number' ? { sellPrice: row.sellPrice } : {}),
      ...(row.adjustType ? { adjustType: row.adjustType, value: row.value ?? 0 } : {}),
    });
  }
  // ...unchanged catch/finally...
}
```

Add `import { DepotPrice } from '../../application/ports/depot-pricing.port';`.

- [ ] **Step 3: Apply at checkout** — in `order.service.ts`, add `import { applyAdjustment } from '../../domain/pricing';` and replace the override/unitPrice block (currently lines ~106-129):

```ts
    // Per-depot resolved prices: static override + the winning active pricing rule.
    // Fails OPEN — an empty map means every line uses the catalog base with no rule.
    const prices = depot
      ? await this.depotPricing.getPrices(
          depot.id,
          lines.map((l) => l.productId),
        )
      : new Map<string, import('../ports/depot-pricing.port').DepotPrice>();

    const items: CreateOrderItemData[] = [];
    for (const line of lines) {
      const product = await this.priced(line.productId);
      const priceRow = prices.get(product.id);
      const base = priceRow?.sellPrice ?? product.basePrice;
      const adj = priceRow?.adjustType
        ? { adjustType: priceRow.adjustType, value: priceRow.value ?? 0 }
        : null;
      const unitPrice = money(applyAdjustment(base, adj));
      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice,
        quantity: line.quantity,
        lineTotal: money(unitPrice * line.quantity),
      });
    }
```

(Prefer a top-of-file `import { DepotPrice } from '../ports/depot-pricing.port';` and use `new Map<string, DepotPrice>()` instead of the inline `import(...)` type — match the file's existing import style.)

- [ ] **Step 4: Update `FakeDepotPricing`** in `test/support/fakes.ts` to store `DepotPrice` and keep the existing `setOverride` working, plus a `setRule` helper:

```ts
import { DepotPrice, DepotPricingPort } from '../../src/application/ports/depot-pricing.port';

export class FakeDepotPricing implements DepotPricingPort {
  /** depotId -> (productId -> resolved price). */
  overrides = new Map<string, Map<string, DepotPrice>>();
  calls: { depotId: string; productIds: string[] }[] = [];

  private forDepot(depotId: string): Map<string, DepotPrice> {
    let m = this.overrides.get(depotId);
    if (!m) {
      m = new Map<string, DepotPrice>();
      this.overrides.set(depotId, m);
    }
    return m;
  }

  setOverride(depotId: string, productId: string, sellPrice: number): void {
    const row = this.forDepot(depotId).get(productId) ?? {};
    this.forDepot(depotId).set(productId, { ...row, sellPrice });
  }

  setRule(depotId: string, productId: string, adjustType: 'PERCENT' | 'FIXED', value: number): void {
    const row = this.forDepot(depotId).get(productId) ?? {};
    this.forDepot(depotId).set(productId, { ...row, adjustType, value });
  }

  async getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>> {
    this.calls.push({ depotId, productIds });
    const forDepot = this.overrides.get(depotId) ?? new Map<string, DepotPrice>();
    const result = new Map<string, DepotPrice>();
    for (const id of productIds) {
      const row = forDepot.get(id);
      if (row) result.set(id, row);
    }
    return result;
  }
}
```

(Adjust to match the fake's existing shape — keep any other members it already exposes.)

- [ ] **Step 5: Add a checkout test** in `test/unit/order.service.spec.ts` mirroring the existing per-depot-override test, asserting a seeded PERCENT rule discounts the unit price:

```ts
it('applies an active depot pricing rule to the unit price at checkout', async () => {
  // arrange: route to a depot, product basePrice e.g. 20000, no sellPrice override
  depotPricing.setRule(DEPOT_ID, PRODUCT_ID, 'PERCENT', -10);
  // ...perform checkout as the existing override test does...
  // assert: the created order item unitPrice === money(18000)
});
```

- [ ] **Step 6: Run the order suite + typecheck**

Run: `cd services/order-service && npx jest && npx tsc --noEmit`
Expected: all pass (existing 64 + new pricing unit + checkout-rule case), no type errors.

- [ ] **Step 7: Lint + build**

Run: `cd services/order-service && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add services/order-service/src
git add services/order-service/test
git commit -m "feat(order): apply active depot pricing rule at checkout (fail-open)"
```

---

### Task 8: Web pricing helpers + endpoints + roles + types (apps/web)

**Files:**
- Modify: `apps/web/src/lib/endpoints.ts` (add `pricing`)
- Modify: `apps/web/src/lib/roles.ts` (add `canManagePricing`)
- Modify: `apps/web/src/lib/types.ts` (add `PricingRule`, `PricingRulePayload`)
- Create: `apps/web/src/lib/pricing.ts` (`toRulePayload`, `EMPTY_RULE_FORM`, `RuleForm`)
- Test: `apps/web/test/pricing.test.ts`; Modify `apps/web/test/roles.test.ts`

**Interfaces:**
- Produces:
  - `endpoints.pricing.{rules(depotId), create(depotId), detail(depotId, id)}`
  - `canManagePricing(role): boolean` (DEPOT_MANAGER/SUPER_ADMIN)
  - `toRulePayload(form: RuleForm): { ok: true; value: PricingRulePayload } | { ok: false; error: string }`

- [ ] **Step 1: Add endpoints** to `endpoints.ts` (after `inventory`):

```ts
  pricing: {
    // Dynamic pricing rules for one depot (staff). All under the depots segment.
    rules: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    create: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    // PATCH to update, DELETE to remove.
    detail: (depotId: string, id: string) =>
      `/depots/api/v1/depots/${depotId}/pricing/rules/${id}`,
  },
```

- [ ] **Step 2: Add the role helper** to `roles.ts` (reuse the existing `DEPOT_ADMIN` set):

```ts
/** Whether a role may manage dynamic pricing rules (mirrors depot-service manager+super-admin). */
export function canManagePricing(role: string | null | undefined): boolean {
  return role != null && DEPOT_ADMIN.has(role);
}
```

- [ ] **Step 3: Add types** to `types.ts`:

```ts
export type PricingAdjustType = 'PERCENT' | 'FIXED';

export interface PricingRule {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: string | null;
  validUntil: string | null;
  priority: number;
  active: boolean;
}

export interface PricingRulePayload {
  productId?: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: string | null;
  validUntil: string | null;
  priority: number;
  active: boolean;
}
```

- [ ] **Step 4: Write the failing test** `test/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_RULE_FORM, toRulePayload } from '../src/lib/pricing';

describe('toRulePayload', () => {
  it('builds a minimal depot-wide percentage rule', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, adjustType: 'PERCENT', value: '-10' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.adjustType).toBe('PERCENT');
      expect(r.value.value).toBe(-10);
      expect(r.value.productId).toBeNull();
      expect(r.value.daysOfWeek).toEqual([]);
      expect(r.value.startMinute).toBeNull();
    }
  });

  it('rejects a non-numeric value', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, value: 'abc' });
    expect(r.ok).toBe(false);
  });

  it('parses HH:MM times into minutes and rejects end <= start', () => {
    const ok = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', startTime: '10:00', endTime: '13:30' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.startMinute).toBe(600);
      expect(ok.value.endMinute).toBe(810);
    }
    const bad = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', startTime: '13:00', endTime: '10:00' });
    expect(bad.ok).toBe(false);
  });

  it('rejects an inverted date range', () => {
    const r = toRulePayload({
      ...EMPTY_RULE_FORM,
      value: '-5',
      validFrom: '2026-07-10',
      validUntil: '2026-07-01',
    });
    expect(r.ok).toBe(false);
  });

  it('collects selected days of week', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', daysOfWeek: [1, 3, 5] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.daysOfWeek).toEqual([1, 3, 5]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/pricing.test.ts`
Expected: FAIL — cannot resolve `../src/lib/pricing`.

- [ ] **Step 6: Write `src/lib/pricing.ts`:**

```ts
// Pure helpers for the dynamic-pricing console. Covered by test/pricing.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { PricingAdjustType, PricingRulePayload } from './types';

export interface RuleForm {
  productId: string; // blank = depot-wide
  adjustType: PricingAdjustType;
  value: string;
  daysOfWeek: number[];
  startTime: string; // HH:MM, blank = all day
  endTime: string;
  validFrom: string; // YYYY-MM-DD, blank = open
  validUntil: string;
  priority: string;
  active: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = {
  productId: '',
  adjustType: 'PERCENT',
  value: '',
  daysOfWeek: [],
  startTime: '',
  endTime: '',
  validFrom: '',
  validUntil: '',
  priority: '',
  active: true,
};

function toMinutes(hhmm: string): number | null {
  if (hhmm.trim() === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN as unknown as number;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN as unknown as number;
  return h * 60 + min;
}

/** Coerce the string form into an API payload, or return the first validation error. */
export function toRulePayload(
  form: RuleForm,
): { ok: true; value: PricingRulePayload } | { ok: false; error: string } {
  if (form.adjustType !== 'PERCENT' && form.adjustType !== 'FIXED') {
    return { ok: false, error: 'Pick an adjustment type.' };
  }
  const value = Number(form.value);
  if (form.value.trim() === '' || !Number.isFinite(value)) {
    return { ok: false, error: 'Value must be a number.' };
  }

  const startMinute = toMinutes(form.startTime);
  const endMinute = toMinutes(form.endTime);
  if (Number.isNaN(startMinute) || Number.isNaN(endMinute)) {
    return { ok: false, error: 'Times must be HH:MM.' };
  }
  if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  const validFrom = form.validFrom.trim() || null;
  const validUntil = form.validUntil.trim() || null;
  if (validFrom && validUntil && validUntil < validFrom) {
    return { ok: false, error: 'Valid-until must not precede valid-from.' };
  }

  const priority = form.priority.trim() === '' ? 0 : Number(form.priority);
  if (!Number.isInteger(priority)) {
    return { ok: false, error: 'Priority must be a whole number.' };
  }

  return {
    ok: true,
    value: {
      productId: form.productId.trim() || null,
      adjustType: form.adjustType,
      value,
      daysOfWeek: [...form.daysOfWeek].sort((a, b) => a - b),
      startMinute,
      endMinute,
      validFrom,
      validUntil,
      priority,
      active: form.active,
    },
  };
}
```

- [ ] **Step 7: Add a roles case** to `test/roles.test.ts`:

```ts
import { canManagePricing } from '../src/lib/roles';
// ...
it('canManagePricing allows manager + super-admin only', () => {
  expect(canManagePricing('DEPOT_MANAGER')).toBe(true);
  expect(canManagePricing('SUPER_ADMIN')).toBe(true);
  expect(canManagePricing('CUSTOMER')).toBe(false);
  expect(canManagePricing(null)).toBe(false);
});
```

- [ ] **Step 8: Run web unit tests + typecheck**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: PASS (existing 56 + new pricing 5 + roles 1).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib apps/web/test/pricing.test.ts apps/web/test/roles.test.ts
git commit -m "feat(web): pricing endpoints, canManagePricing, toRulePayload helper"
```

---

### Task 9: Web pricing console page + discovery link (apps/web)

**Files:**
- Create: `apps/web/src/app/dashboard/pricing/page.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx` (add a discovery link, gated by `canManagePricing`)

**Interfaces:**
- Consumes: `endpoints.pricing`, `endpoints.depots.browse`, `canManagePricing`, `toRulePayload`/`EMPTY_RULE_FORM`, `PricingRule`/`Depot` types, the `api` client, `useAuth`.

- [ ] **Step 1: Write the page** `src/app/dashboard/pricing/page.tsx` — model it on `src/app/dashboard/depots/page.tsx` (client component, `RequireAuth`, depot picker via `endpoints.depots.browse`, list via `endpoints.pricing.rules(depotId)`, create via `endpoints.pricing.create`, edit via PATCH `endpoints.pricing.detail`, delete via DELETE with `window.confirm`). Gate the whole screen on `canManagePricing(user?.role)` — non-managers see a "Pricing managers only" state. Form fields: product id (optional = depot-wide), adjust type (PERCENT/FIXED), value, day-of-week checkboxes (0–6), start/end time (`<input type="time">`), valid-from/until (`<input type="date">`), priority, active. On submit call `toRulePayload(form)`; show its `error` inline; POST/PATCH `value` on success then reload. Render each rule as a card: target (product id or "All products"), adjustment (`-10%` / `Rp-2000`), window summary (days + time + dates), priority, active badge, Edit/Delete actions. Reuse the same Tailwind class vocabulary and loading/empty/error states as the depots page. Keep customer-facing price display OUT of scope.

- [ ] **Step 2: Add a discovery link** on `dashboard/page.tsx` — next to the existing depot/inventory/campaign links, add (gated):

```tsx
{canManagePricing(user?.role) && (
  <Link href="/dashboard/pricing" className={/* same class as the other dashboard links */}>
    Dynamic pricing
  </Link>
)}
```

Import `canManagePricing` from `@/lib/roles` (match the file's existing import alias).

- [ ] **Step 3: Typecheck + lint + build**

Run: `cd apps/web && npx tsc --noEmit && npm run lint && npm run build`
Expected: clean; `/dashboard/pricing` appears in the prerendered route list.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/pricing/page.tsx apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): /dashboard/pricing dynamic pricing console"
```

---

### Task 10: Full-workspace verification + memory

**Files:**
- Modify: `C:/Users/IDEAPAD SLIM 3/.claude/projects/g--VsCode-Hydromart/memory/hydromart-current-state.md` (append M-R3.4 summary)

- [ ] **Step 1: Root gates**

Run (repo root): `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green — depot + order test counts up by the new specs, web up by ~6, everything else unchanged.

- [ ] **Step 2: Apply the migration if Docker is up**

Run: `npm run db:migrate` (idempotent `prisma migrate deploy`).
Expected: `0007_pricing_rules` applied to `hydromart_depot`. If Docker is down, note it as pending (migration is validated + committed regardless).

- [ ] **Step 3: Append the milestone summary** to `hydromart-current-state.md` — one paragraph: `M-R3.4 Dynamic Pricing DONE` with the commit hashes, the depot/order/web test-count deltas, the exactly-one-rule + fail-open + single-TZ + no-category ceilings.

- [ ] **Step 4: Commit**

```bash
git add "C:/Users/IDEAPAD SLIM 3/.claude/projects/g--VsCode-Hydromart/memory/hydromart-current-state.md"
git commit -m "docs(memory): record M-R3.4 dynamic pricing"
```

---

## Self-Review

- **Spec coverage:** §1 data model → Task 1; §2 resolution → Task 2; §3 wiring (endpoint + order-service apply) → Tasks 5, 6, 7; §4 admin CRUD → Task 5; §5 web console → Tasks 8, 9; testing → per-task; ceilings → carried in code comments + Task 10 memory note. All covered.
- **Placeholder scan:** the only prose-only steps are Task 5 Step 5 (e2e — explicitly says "mirror inventory e2e" with the concrete assertion list) and Task 9 Step 1 (page — "model on depots page" with the concrete field/behavior list). Both reference an existing, named template rather than leaving logic undefined. Acceptable given the plan can't restate a 200-line React page verbatim; everything with non-trivial logic (domain, service, helper) has full code.
- **Type consistency:** `PricingAdjustType` (depot enum) vs `PriceAdjustType` (order string union) are deliberately distinct — order-service does not import depot domain; the wire format is the shared `'PERCENT'|'FIXED'` strings. `resolvePrices`/`ResolvedProductPrice` (depot) ↔ `DepotPrice` (order) match field-for-field on the wire (`sellPrice?`, `adjustType?`, `value?`). `DEPOT_TOKENS.PricingRuleRepository` defined in Task 3, consumed in Tasks 4/5.
