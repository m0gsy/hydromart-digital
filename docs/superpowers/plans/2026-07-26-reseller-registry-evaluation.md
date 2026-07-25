# Reseller Registry + Per-Depot Achievement Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register bulk resellers ("agen") per depot with a monthly volume target and show a per-depot achievement dashboard (volume / target% / growth / activity) derived from existing orders.

**Architecture:** Reseller = a facet of an existing customer. `customer-service` owns the registry + monthly target (`ResellerProfile`, one row keyed by the customer's id). `order-service` gains ONE pure read-time rollup method (reusing the existing `ordersForDepot` repo call + `gallonQty`/`isDelivered` helpers — no schema/repo change) that returns monthly + previous-month gallon volume, order count, and last-order time for a set of customerIds. The web console reads targets from customer-service and actuals from order-service, then computes the display metrics with a pure helper. Mirrors the existing `DepotTarget` "goals stored, actuals derived at read time" pattern.

**Tech Stack:** NestJS (hexagonal) + Prisma + PostgreSQL (per-service DB), Next.js 15 web, Jest for services (`test/unit/*.spec.ts`), Vitest for web (`test/*.test.ts`). Tests run under `rtk proxy npx ...`.

## Global Constraints

- Reseller identity reuses an existing `CustomerProfile.customerId` — the registry never creates auth accounts (MVP; new-account onboarding is deferred).
- Target unit is **gallons/month** (`monthlyTargetQty: Int`), not IDR.
- One **home depot** per reseller (`homeDepotId`) — no cross-depot resellers in MVP.
- Status thresholds: `< 100%` = **di bawah**, `>= 100%` = **tercapai**, `>= 120%` = **lampaui**; target `0` = **no-target** (never divide).
- RBAC: `HEAD_OFFICE`, `DEPOT_MANAGER`, `SUPER_ADMIN` only (follow the `order-service` report-controller precedent — `@Roles(...)` literals, no new capability). Web gate is a pure `canViewResellers(role) = isHq(role) || isDepotManager(role)` helper.
- Reseller-specific pricing is OUT of scope (phase 2).
- All new copy is Indonesian, matching the ops-console tone.

---

### Task 1: `ResellerProfile` model + migration (customer-service)

**Files:**
- Modify: `services/customer-service/prisma/schema.prisma` (append model, after `Favorite`)
- Create: `services/customer-service/prisma/migrations/<timestamp>_reseller_profiles/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma model `ResellerProfile { customerId, homeDepotId, monthlyTargetQty, active, joinDate, note, createdAt, updatedAt }` and the generated client accessor `prisma.resellerProfile`.

- [ ] **Step 1: Add the model to the schema**

Append to `services/customer-service/prisma/schema.prisma`:

```prisma
/// A bulk reseller ("agen"): an existing customer who buys in bulk from one home depot
/// and resells. Registry + monthly gallon target only — achievement volume is derived at
/// read time from order-service (mirrors DepotTarget: goals stored, actuals derived).
model ResellerProfile {
  customerId       String   @id @db.Uuid // = existing CustomerProfile.customerId
  homeDepotId      String   @db.Uuid
  /// Monthly target in gallons (units, not IDR). 0 = no target set.
  monthlyTargetQty Int      @default(0)
  active           Boolean  @default(true)
  joinDate         DateTime @db.Date
  note             String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([homeDepotId])
  @@map("reseller_profiles")
}
```

- [ ] **Step 2: Generate the migration**

Run: `cd services/customer-service && npx prisma migrate dev --name reseller_profiles`
Expected: a new `migrations/<timestamp>_reseller_profiles/migration.sql` creating `reseller_profiles`, and the client regenerates. If no shadow DB is available, use `npx prisma migrate diff` per the repo's existing migration workflow and hand-place the SQL (see any existing migration for the exact form).

- [ ] **Step 3: Verify the client typechecks**

Run: `cd services/customer-service && npx tsc --noEmit`
Expected: PASS (0 errors); `prisma.resellerProfile` is now a known accessor.

- [ ] **Step 4: Commit**

```bash
git add services/customer-service/prisma
git commit -m "feat(reseller): add ResellerProfile model + migration"
```

---

### Task 2: Registry port + Prisma repository + service (customer-service)

**Files:**
- Create: `services/customer-service/src/application/ports/reseller.repository.ts`
- Create: `services/customer-service/src/infrastructure/prisma/reseller.prisma.repository.ts`
- Create: `services/customer-service/src/application/services/reseller.service.ts`
- Modify: `services/customer-service/src/application/tokens.ts` (add token)
- Modify: `services/customer-service/src/domain/errors.ts` (add `ResellerNotFoundError`, `ResellerExistsError`, `CustomerNotFoundError` if absent)
- Test: `services/customer-service/test/unit/reseller.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.resellerProfile` (Task 1); `CUSTOMER_TOKENS` (existing); the existing `ProfileRepository` to assert the customer exists.
- Produces:
  - `interface Reseller { customerId: string; homeDepotId: string; monthlyTargetQty: number; active: boolean; joinDate: Date; note: string | null; createdAt: Date; updatedAt: Date; }`
  - `interface ResellerRepository { list(filter: { homeDepotId?: string; active?: boolean }): Promise<Reseller[]>; findById(customerId): Promise<Reseller | null>; create(data): Promise<Reseller>; update(customerId, patch): Promise<Reseller>; }`
  - `ResellerService` with `list`, `get`, `register`, `update`.

- [ ] **Step 1: Write the port**

Create `services/customer-service/src/application/ports/reseller.repository.ts`:

```ts
export interface Reseller {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  active: boolean;
  joinDate: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateResellerData {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  joinDate: Date;
  note?: string | null;
}

export interface UpdateResellerData {
  homeDepotId?: string;
  monthlyTargetQty?: number;
  active?: boolean;
  note?: string | null;
}

export interface ResellerRepository {
  /** Registry rows, newest first. Filter by home depot and/or active flag. */
  list(filter: { homeDepotId?: string; active?: boolean }): Promise<Reseller[]>;
  findById(customerId: string): Promise<Reseller | null>;
  create(data: CreateResellerData): Promise<Reseller>;
  update(customerId: string, patch: UpdateResellerData): Promise<Reseller>;
}
```

- [ ] **Step 2: Add the DI token**

In `services/customer-service/src/application/tokens.ts`, add inside `CUSTOMER_TOKENS`:

```ts
  ResellerRepository: Symbol('ResellerRepository'),
```

- [ ] **Step 3: Add domain errors**

In `services/customer-service/src/domain/errors.ts`, add (match the existing error-class style in that file):

```ts
export class ResellerNotFoundError extends Error {
  constructor() {
    super('Reseller tidak ditemukan');
  }
}
export class ResellerExistsError extends Error {
  constructor() {
    super('Customer ini sudah terdaftar sebagai reseller');
  }
}
export class CustomerNotFoundError extends Error {
  constructor() {
    super('Customer tidak ditemukan');
  }
}
```

(If any already exists, reuse it — do not duplicate.)

- [ ] **Step 4: Write the failing service test**

Create `services/customer-service/test/unit/reseller.service.spec.ts`:

```ts
import { ResellerService } from '../../src/application/services/reseller.service';
import { Reseller, ResellerRepository } from '../../src/application/ports/reseller.repository';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../src/domain/errors';

function row(over: Partial<Reseller> = {}): Reseller {
  return {
    customerId: 'c1',
    homeDepotId: 'd1',
    monthlyTargetQty: 100,
    active: true,
    joinDate: new Date('2026-01-01'),
    note: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeRepo(): jest.Mocked<ResellerRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
}

// Minimal ProfileRepository stub: only `exists` is used by the service.
function makeProfiles(exists: boolean) {
  return { exists: jest.fn().mockResolvedValue(exists) } as any;
}

describe('ResellerService', () => {
  it('registers a reseller for an existing customer', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));

    const out = await svc.register({
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      joinDate: new Date('2026-01-01'),
    });

    expect(out.customerId).toBe('c1');
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects a customerId that is not a customer', async () => {
    const repo = makeRepo();
    const svc = new ResellerService(repo, makeProfiles(false));
    await expect(
      svc.register({ customerId: 'x', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('rejects registering the same customer twice', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(
      svc.register({ customerId: 'c1', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(ResellerExistsError);
  });

  it('throws when updating an unknown reseller', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(svc.update('nope', { active: false })).rejects.toBeInstanceOf(ResellerNotFoundError);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd services/customer-service && rtk proxy npx jest test/unit/reseller.service.spec.ts`
Expected: FAIL ("Cannot find module '../../src/application/services/reseller.service'").

- [ ] **Step 6: Write the Prisma repository**

Create `services/customer-service/src/infrastructure/prisma/reseller.prisma.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../../application/ports/reseller.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class ResellerPrismaRepository implements ResellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: { homeDepotId?: string; active?: boolean }): Promise<Reseller[]> {
    return this.prisma.resellerProfile.findMany({
      where: {
        ...(filter.homeDepotId ? { homeDepotId: filter.homeDepotId } : {}),
        ...(filter.active != null ? { active: filter.active } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(customerId: string): Promise<Reseller | null> {
    return this.prisma.resellerProfile.findUnique({ where: { customerId } });
  }

  create(data: CreateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.create({
      data: {
        customerId: data.customerId,
        homeDepotId: data.homeDepotId,
        monthlyTargetQty: data.monthlyTargetQty,
        joinDate: data.joinDate,
        note: data.note ?? null,
      },
    });
  }

  update(customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.update({ where: { customerId }, data: patch });
  }
}
```

- [ ] **Step 7: Write the service**

Create `services/customer-service/src/application/services/reseller.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../ports/reseller.repository';
import { ProfileRepository } from '../ports/profile.repository';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../domain/errors';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Reseller registry. A reseller must be an existing customer; each customer can be a
 * reseller at most once (customerId is the PK). Deactivation is soft (active=false).
 */
@Injectable()
export class ResellerService {
  constructor(
    @Inject(CUSTOMER_TOKENS.ResellerRepository) private readonly resellers: ResellerRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  list(filter: { homeDepotId?: string; active?: boolean }): Promise<Reseller[]> {
    return this.resellers.list(filter);
  }

  async get(customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    return found;
  }

  async register(data: CreateResellerData): Promise<Reseller> {
    if (!(await this.profiles.exists(data.customerId))) throw new CustomerNotFoundError();
    if (await this.resellers.findById(data.customerId)) throw new ResellerExistsError();
    return this.resellers.create(data);
  }

  async update(customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    if (!(await this.resellers.findById(customerId))) throw new ResellerNotFoundError();
    return this.resellers.update(customerId, patch);
  }
}
```

Note: `ProfileRepository` must expose `exists(customerId: string): Promise<boolean>`. Check `services/customer-service/src/application/ports/profile.repository.ts` — if there is no `exists`, add one (`exists(customerId): Promise<boolean>` → `count({ where: { customerId } }) > 0`) to the port and `ProfilePrismaRepository`, matching that file's style.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd services/customer-service && rtk proxy npx jest test/unit/reseller.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add services/customer-service/src services/customer-service/test
git commit -m "feat(reseller): registry port, prisma repo, service + unit tests"
```

---

### Task 3: Registry DTOs + controller + module wiring (customer-service)

**Files:**
- Create: `services/customer-service/src/modules/dto/reseller.dto.ts`
- Create: `services/customer-service/src/modules/reseller.controller.ts`
- Modify: `services/customer-service/src/modules/customer.module.ts` (register provider + controller)

**Interfaces:**
- Consumes: `ResellerService` (Task 2), the domain error classes (Task 2), `Role`/`Roles`/`CurrentUser` from `@hydromart/platform`.
- Produces: REST routes `GET/POST /v1/resellers`, `GET/PATCH /v1/resellers/:customerId`.

- [ ] **Step 1: Write the DTOs**

Create `services/customer-service/src/modules/dto/reseller.dto.ts` (mirror the class-validator style of `address.dto.ts`):

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class RegisterResellerDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsUUID() homeDepotId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) monthlyTargetQty!: number;
  @ApiProperty({ example: '2026-01-01' }) @IsISO8601() joinDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateResellerDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() homeDepotId?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) monthlyTargetQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListResellerQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() depotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 2: Write the controller**

Create `services/customer-service/src/modules/reseller.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ResellerService } from '../application/services/reseller.service';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../domain/errors';
import { ListResellerQueryDto, RegisterResellerDto, UpdateResellerDto } from './dto/reseller.dto';

const RESELLER_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Resellers')
@ApiBearerAuth()
@Roles(...RESELLER_ROLES)
@Controller({ path: 'resellers', version: '1' })
export class ResellerController {
  constructor(private readonly resellers: ResellerService) {}

  @Get()
  @ApiOperation({ summary: 'List resellers (optionally by depot / active)' })
  list(@Query() q: ListResellerQueryDto) {
    return this.resellers.list({ homeDepotId: q.depotId, active: q.active });
  }

  @Get(':customerId')
  @ApiOperation({ summary: 'Get one reseller' })
  async get(@Param('customerId', ParseUUIDPipe) customerId: string) {
    try {
      return await this.resellers.get(customerId);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Register an existing customer as a reseller' })
  async register(@Body() dto: RegisterResellerDto) {
    try {
      return await this.resellers.register({
        customerId: dto.customerId,
        homeDepotId: dto.homeDepotId,
        monthlyTargetQty: dto.monthlyTargetQty,
        joinDate: new Date(dto.joinDate),
        note: dto.note,
      });
    } catch (e) {
      if (e instanceof CustomerNotFoundError) throw new BadRequestException(e.message);
      if (e instanceof ResellerExistsError) throw new ConflictException(e.message);
      throw e;
    }
  }

  @Patch(':customerId')
  @ApiOperation({ summary: 'Edit a reseller (target / depot / note / active)' })
  async update(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateResellerDto,
  ) {
    try {
      return await this.resellers.update(customerId, dto);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }
}
```

- [ ] **Step 3: Wire the module**

In `services/customer-service/src/modules/customer.module.ts`:
- import `ResellerService`, `ResellerPrismaRepository`, `ResellerController`;
- add `ResellerService` to `providers`;
- add `{ provide: CUSTOMER_TOKENS.ResellerRepository, useClass: ResellerPrismaRepository }` to `providers`;
- add `ResellerController` to `controllers`.

- [ ] **Step 4: Typecheck**

Run: `cd services/customer-service && npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 5: Commit**

```bash
git add services/customer-service/src
git commit -m "feat(reseller): registry REST controller + module wiring"
```

---

### Task 4: Reseller rollup in order-service (pure, read-time)

**Files:**
- Modify: `services/order-service/src/application/services/report.service.ts` (add interfaces + `resellerRollup` method)
- Test: `services/order-service/test/unit/reseller-rollup.spec.ts`

**Interfaces:**
- Consumes: the existing `OrderRepository.ordersForDepot(depotId, range): Promise<OrderRecord[]>` and the file-local `gallonQty(order)` / `isDelivered(status)` helpers (already in report.service.ts).
- Produces:
  - `interface ResellerRollupRow { customerId: string; volumeQty: number; prevVolumeQty: number; orderCount: number; lastOrderAt: string | null; }`
  - `interface ResellerRollupReport { depotId: string; month: string; rows: ResellerRollupRow[]; }`
  - `ReportService.resellerRollup(depotId: string, month: string, customerIds: string[]): Promise<ResellerRollupReport>`

- [ ] **Step 1: Write the failing test**

Create `services/order-service/test/unit/reseller-rollup.spec.ts`:

```ts
import { ReportService } from '../../src/application/services/report.service';
import { OrderStatus } from '../../src/domain/order-status';

function order(over: any) {
  return {
    id: over.id ?? 'o',
    customerId: over.customerId,
    status: over.status ?? OrderStatus.DELIVERED,
    createdAt: new Date(over.createdAt),
    total: 0,
    driverName: null,
    items: [{ productName: 'Galon 19L', unit: 'galon', quantity: over.qty ?? 0 }],
    ...over,
  };
}

describe('ReportService.resellerRollup', () => {
  it('sums gallons this month and previous month per reseller, with order count + last order', async () => {
    const repo: any = {
      ordersForDepot: jest.fn(async (_depotId: string, range: { from: Date; to: Date }) => {
        const isJuly = range.from.getUTCMonth() === 6; // 0-based: July = 6
        if (isJuly) {
          return [
            order({ customerId: 'r1', qty: 5, createdAt: '2026-07-03T00:00:00Z', id: 'a' }),
            order({ customerId: 'r1', qty: 7, createdAt: '2026-07-20T00:00:00Z', id: 'b' }),
            order({ customerId: 'other', qty: 99, createdAt: '2026-07-10T00:00:00Z' }),
            order({ customerId: 'r1', qty: 3, createdAt: '2026-07-15T00:00:00Z', status: OrderStatus.CANCELLED }),
          ];
        }
        // June (previous month)
        return [order({ customerId: 'r1', qty: 4, createdAt: '2026-06-10T00:00:00Z' })];
      }),
    };
    const svc = new ReportService(repo);

    const out = await svc.resellerRollup('d1', '2026-07', ['r1']);

    expect(out.rows).toHaveLength(1);
    const r = out.rows[0];
    expect(r.customerId).toBe('r1');
    expect(r.volumeQty).toBe(12); // 5 + 7, cancelled 3 excluded
    expect(r.prevVolumeQty).toBe(4);
    expect(r.orderCount).toBe(2);
    expect(r.lastOrderAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('returns no rows when customerIds is empty', async () => {
    const repo: any = { ordersForDepot: jest.fn() };
    const svc = new ReportService(repo);
    const out = await svc.resellerRollup('d1', '2026-07', []);
    expect(out.rows).toEqual([]);
    expect(repo.ordersForDepot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/order-service && rtk proxy npx jest test/unit/reseller-rollup.spec.ts`
Expected: FAIL ("resellerRollup is not a function").

- [ ] **Step 3: Add the interfaces**

In `services/order-service/src/application/services/report.service.ts`, add near the other report interfaces:

```ts
/** One reseller's monthly rollup (design: reseller achievement). All figures are gallons. */
export interface ResellerRollupRow {
  customerId: string;
  volumeQty: number;
  prevVolumeQty: number;
  orderCount: number;
  lastOrderAt: string | null;
}

export interface ResellerRollupReport {
  depotId: string;
  /** Reported month, 'YYYY-MM'. */
  month: string;
  rows: ResellerRollupRow[];
}
```

- [ ] **Step 4: Add the method**

Add to the `ReportService` class body (uses the existing `gallonQty` / `isDelivered` file helpers and `ordersForDepot`):

```ts
  /**
   * Per-reseller monthly achievement (design: reseller evaluation). For the requested
   * customerIds within one depot: delivered gallon volume this month + previous month
   * (drives growth), delivered order count, and the last delivered order time. Read-time
   * only — no stored actuals. Empty customerIds short-circuits to no rows.
   */
  async resellerRollup(
    depotId: string,
    month: string,
    customerIds: string[],
  ): Promise<ResellerRollupReport> {
    if (customerIds.length === 0) return { depotId, month, rows: [] };
    const wanted = new Set(customerIds);

    const from = new Date(`${month}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const prevFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));

    const [thisRows, prevRows] = await Promise.all([
      this.orders.ordersForDepot(depotId, { from, to }),
      this.orders.ordersForDepot(depotId, { from: prevFrom, to: from }),
    ]);

    const delivered = (rows: typeof thisRows) =>
      rows.filter((o) => wanted.has(o.customerId) && isDelivered(o.status));

    const prevVol = new Map<string, number>();
    for (const o of delivered(prevRows)) {
      prevVol.set(o.customerId, (prevVol.get(o.customerId) ?? 0) + gallonQty(o));
    }

    const agg = new Map<string, { volumeQty: number; orderCount: number; lastOrderAt: Date | null }>();
    for (const o of delivered(thisRows)) {
      const cur = agg.get(o.customerId) ?? { volumeQty: 0, orderCount: 0, lastOrderAt: null };
      cur.volumeQty += gallonQty(o);
      cur.orderCount += 1;
      if (!cur.lastOrderAt || o.createdAt > cur.lastOrderAt) cur.lastOrderAt = o.createdAt;
      agg.set(o.customerId, cur);
    }

    const rows: ResellerRollupRow[] = customerIds.map((customerId) => {
      const a = agg.get(customerId);
      return {
        customerId,
        volumeQty: a?.volumeQty ?? 0,
        prevVolumeQty: prevVol.get(customerId) ?? 0,
        orderCount: a?.orderCount ?? 0,
        lastOrderAt: a?.lastOrderAt ? a.lastOrderAt.toISOString() : null,
      };
    });

    return { depotId, month, rows };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd services/order-service && rtk proxy npx jest test/unit/reseller-rollup.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/order-service/src services/order-service/test
git commit -m "feat(reseller): read-time monthly rollup in order-service ReportService"
```

---

### Task 5: Rollup DTO + report-controller route (order-service)

**Files:**
- Modify: `services/order-service/src/modules/dto/report.dto.ts` (add `ResellerRollupQueryDto`)
- Modify: `services/order-service/src/modules/report.controller.ts` (add route)

**Interfaces:**
- Consumes: `ReportService.resellerRollup` (Task 4).
- Produces: `GET /v1/reports/reseller-rollup?depotId=&month=YYYY-MM&customerIds=a,b,c`.

- [ ] **Step 1: Add the query DTO**

In `services/order-service/src/modules/dto/report.dto.ts`, add (match the file's existing DTO style):

```ts
export class ResellerRollupQueryDto {
  @ApiProperty() @IsUUID() depotId!: string;
  @ApiProperty({ example: '2026-07' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
  /** Comma-separated reseller customerIds. */
  @ApiProperty({ example: 'uuid1,uuid2' }) @IsString() customerIds!: string;
}
```

Ensure `IsUUID`, `IsString`, `Matches`, `ApiProperty` are imported at the top of the file (add any missing).

- [ ] **Step 2: Add the controller route**

In `services/order-service/src/modules/report.controller.ts`, import `ResellerRollupQueryDto` and add a route inside `ReportController` (default `@Roles(...REPORT_ROLES)` from the class already covers HEAD_OFFICE/DEPOT_MANAGER/SUPER_ADMIN):

```ts
  @Get('reseller-rollup')
  @ApiOperation({ summary: 'Per-reseller monthly achievement rollup (volume/prev/orders/last)' })
  resellerRollup(@Query() q: ResellerRollupQueryDto) {
    const ids = q.customerIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.reports.resellerRollup(q.depotId, q.month, ids);
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd services/order-service && npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 4: Commit**

```bash
git add services/order-service/src
git commit -m "feat(reseller): expose reseller-rollup report endpoint"
```

---

### Task 6: Web types + endpoints + pure evaluation helper

**Files:**
- Create: `apps/web/src/lib/reseller.ts` (types + `evaluateReseller` pure helper)
- Modify: `apps/web/src/lib/endpoints.ts` (add `resellers` block + `reports.resellerRollup`)
- Modify: `apps/web/src/lib/roles.ts` (add `canViewResellers`)
- Test: `apps/web/test/reseller.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface Reseller { customerId; homeDepotId; monthlyTargetQty; active; joinDate; note; createdAt; updatedAt }` (all `string` except `monthlyTargetQty: number`, `active: boolean`).
  - `interface ResellerRollupRow { customerId: string; volumeQty: number; prevVolumeQty: number; orderCount: number; lastOrderAt: string | null }`
  - `evaluateReseller(input): ResellerMetrics` where `ResellerMetrics = { attainmentPct: number | null; status: 'no-target'|'di-bawah'|'tercapai'|'lampaui'; growthPct: number; pasif: boolean }`
  - `endpoints.resellers.{ list, create, detail }`, `endpoints.reports.resellerRollup(...)`
  - `canViewResellers(role)`

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/test/reseller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateReseller } from '../src/lib/reseller';

const asOf = new Date('2026-07-31T00:00:00Z');

describe('evaluateReseller', () => {
  it('computes attainment + tercapai status', () => {
    const m = evaluateReseller({ volumeQty: 100, prevVolumeQty: 80, monthlyTargetQty: 100, lastOrderAt: '2026-07-20T00:00:00Z', asOf });
    expect(m.attainmentPct).toBe(100);
    expect(m.status).toBe('tercapai');
    expect(m.growthPct).toBe(25);
    expect(m.pasif).toBe(false);
  });

  it('flags lampaui at >=120% and positive growth from zero', () => {
    const m = evaluateReseller({ volumeQty: 60, prevVolumeQty: 0, monthlyTargetQty: 50, lastOrderAt: '2026-07-25T00:00:00Z', asOf });
    expect(m.status).toBe('lampaui');
    expect(m.growthPct).toBe(100);
  });

  it('reports no-target and never divides when target is 0', () => {
    const m = evaluateReseller({ volumeQty: 30, prevVolumeQty: 10, monthlyTargetQty: 0, lastOrderAt: '2026-07-25T00:00:00Z', asOf });
    expect(m.attainmentPct).toBeNull();
    expect(m.status).toBe('no-target');
  });

  it('marks di-bawah and pasif when stale / never ordered', () => {
    const m = evaluateReseller({ volumeQty: 10, prevVolumeQty: 40, monthlyTargetQty: 100, lastOrderAt: null, asOf });
    expect(m.status).toBe('di-bawah');
    expect(m.growthPct).toBe(-75);
    expect(m.pasif).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && rtk proxy npx vitest run test/reseller.test.ts`
Expected: FAIL ("Cannot find module '../src/lib/reseller'").

- [ ] **Step 3: Write the types + helper**

Create `apps/web/src/lib/reseller.ts`:

```ts
// Reseller ("agen") registry types + pure achievement-evaluation helper. Mirrors the
// customer-service ResellerProfile and the order-service reseller-rollup response; the
// server stays authority for the raw figures, this file only derives display metrics.

export interface Reseller {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  active: boolean;
  joinDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResellerRollupRow {
  customerId: string;
  volumeQty: number;
  prevVolumeQty: number;
  orderCount: number;
  lastOrderAt: string | null;
}

export type ResellerStatus = 'no-target' | 'di-bawah' | 'tercapai' | 'lampaui';

export interface ResellerMetrics {
  /** volume / target * 100, rounded. null when no target is set (never divides). */
  attainmentPct: number | null;
  status: ResellerStatus;
  /** (volume - prev) / prev * 100, rounded. From-zero growth: +100 if volume>0 else 0. */
  growthPct: number;
  /** No order at all, or last order older than inactiveDays. */
  pasif: boolean;
}

export const RESELLER_STATUS_LABEL: Record<ResellerStatus, string> = {
  'no-target': 'Tanpa target',
  'di-bawah': 'Di bawah',
  tercapai: 'Tercapai',
  lampaui: 'Lampaui',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateReseller(input: {
  volumeQty: number;
  prevVolumeQty: number;
  monthlyTargetQty: number;
  lastOrderAt: string | null;
  asOf?: Date;
  inactiveDays?: number;
}): ResellerMetrics {
  const { volumeQty, prevVolumeQty, monthlyTargetQty, lastOrderAt } = input;
  const asOf = input.asOf ?? new Date();
  const inactiveDays = input.inactiveDays ?? 30;

  const attainmentPct =
    monthlyTargetQty <= 0 ? null : Math.round((volumeQty / monthlyTargetQty) * 100);

  let status: ResellerStatus;
  if (attainmentPct === null) status = 'no-target';
  else if (attainmentPct >= 120) status = 'lampaui';
  else if (attainmentPct >= 100) status = 'tercapai';
  else status = 'di-bawah';

  const growthPct =
    prevVolumeQty <= 0
      ? volumeQty > 0
        ? 100
        : 0
      : Math.round(((volumeQty - prevVolumeQty) / prevVolumeQty) * 100);

  const pasif =
    lastOrderAt == null || (asOf.getTime() - new Date(lastOrderAt).getTime()) / DAY_MS > inactiveDays;

  return { attainmentPct, status, growthPct, pasif };
}
```

- [ ] **Step 4: Add endpoints**

In `apps/web/src/lib/endpoints.ts`, add a top-level `resellers` block (near `favorites`):

```ts
  // Reseller ("agen") registry (customer-service). Staff-only (HQ + depot-manager).
  resellers: {
    list: (q: { depotId?: string; active?: boolean } = {}) => {
      const p = new URLSearchParams();
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.active != null) p.set('active', String(q.active));
      const qs = p.toString();
      return `/customers/api/v1/resellers${qs ? `?${qs}` : ''}`;
    },
    create: '/customers/api/v1/resellers',
    detail: (customerId: string) => `/customers/api/v1/resellers/${customerId}`, // GET / PATCH
  },
```

And inside the existing `reports` block, add:

```ts
    // Per-reseller monthly achievement rollup (volume/prev/orders/last order).
    resellerRollup: (q: { depotId: string; month: string; customerIds: string[] }) =>
      `/orders/api/v1/reports/reseller-rollup?${new URLSearchParams({
        depotId: q.depotId,
        month: q.month,
        customerIds: q.customerIds.join(','),
      })}`,
```

- [ ] **Step 5: Add the role gate**

In `apps/web/src/lib/roles.ts`, add after `isSuperAdmin`:

```ts
/** Reseller registry gate: HQ + depot managers (mirrors the order-service report roles). */
export const canViewResellers = (role: string | null | undefined) =>
  isHq(role) || isDepotManager(role);
```

- [ ] **Step 6: Run helper test + typecheck**

Run: `cd apps/web && rtk proxy npx vitest run test/reseller.test.ts`
Expected: PASS (4 tests).
Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib apps/web/test/reseller.test.ts
git commit -m "feat(reseller): web types, endpoints, role gate + evaluation helper"
```

---

### Task 7: Reseller console page (`/hq/resellers`)

**Files:**
- Create: `apps/web/src/app/hq/resellers/page.tsx`
- (Optional, only if a nav registry exists) Modify the HQ nav list to add a "Reseller" link. Grep for an existing HQ route label (e.g. `hq/franchise-applications`) to find the nav file; if links are file-routed with no central registry, skip.

**Interfaces:**
- Consumes: `endpoints.resellers.list`, `endpoints.reports.resellerRollup`, `endpoints.resellers.create`, `endpoints.resellers.detail`; `evaluateReseller`, `RESELLER_STATUS_LABEL`, `Reseller`, `ResellerRollupRow` (Task 6); `useAuth`, `canViewResellers`, `currentPeriod` (from `lib/hr` or inline), UI atoms (`Card`, `SectionHeader`, `Badge`, `Button`, `Skeleton`, `ErrorState`), `useAsync`, `api`.

- [ ] **Step 1: Build the page**

Create `apps/web/src/app/hq/resellers/page.tsx`. It: guards with `canViewResellers`; picks the depot (HQ = depot switcher / query param; manager = own `customer.depotId`); loads the registry list for that depot; loads the rollup for the same depot + current month using the loaded resellers' `customerId`s; joins them per reseller; renders a table of name/target/volume/attainment badge/growth/last-order using `evaluateReseller`. Follow the exact data-loading + layout idioms of an existing report page — model it on `apps/web/src/app/hr/employees/[id]/page.tsx` (already uses `useAuth`, `useAsync`, `api.get(url, true)`, `Card`, `SectionHeader`, `Badge`, `Skeleton`, `ErrorState`).

Reference skeleton (fill against the real UI atoms in `@/components/ui`):

```tsx
'use client';

import { useMemo, useState } from 'react';

import { Badge, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { canViewResellers, isHq } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import {
  evaluateReseller,
  RESELLER_STATUS_LABEL,
  type Reseller,
  type ResellerRollupRow,
} from '@/lib/reseller';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ResellersPage() {
  const { customer } = useAuth();
  const canView = canViewResellers(customer?.role);
  // HQ chooses a depot; a manager is pinned to their own.
  const [depotId, setDepotId] = useState<string>(isHq(customer?.role) ? '' : (customer?.depotId ?? ''));
  const month = currentMonth();

  const registry = useAsync<Reseller[]>(
    () => (depotId ? api.get<Reseller[]>(endpoints.resellers.list({ depotId }), true) : Promise.resolve([])),
    [depotId],
  );

  const ids = useMemo(() => (registry.data ?? []).map((r) => r.customerId), [registry.data]);
  const rollup = useAsync<{ rows: ResellerRollupRow[] }>(
    () =>
      ids.length && depotId
        ? api.get(endpoints.reports.resellerRollup({ depotId, month, customerIds: ids }), true)
        : Promise.resolve({ rows: [] }),
    [depotId, month, ids.join(',')],
  );

  if (!canView) return <div className="mx-auto max-w-4xl"><ErrorState message="Akses ditolak" /></div>;

  const byId = new Map((rollup.data?.rows ?? []).map((r) => [r.customerId, r]));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader title="Reseller (Agen)" subtitle={`Pencapaian ${month}`} />
      {/* HQ: render a depot picker that sets depotId. Managers: omit. */}
      {registry.loading && <Skeleton className="h-64" />}
      {registry.error && <ErrorState message={registry.error} onRetry={registry.reload} />}
      {registry.data && registry.data.length === 0 && depotId && (
        <p className="text-sm text-muted">Belum ada reseller di depot ini.</p>
      )}
      {registry.data && registry.data.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)] p-0">
          {registry.data.map((r) => {
            const roll = byId.get(r.customerId);
            const m = evaluateReseller({
              volumeQty: roll?.volumeQty ?? 0,
              prevVolumeQty: roll?.prevVolumeQty ?? 0,
              monthlyTargetQty: r.monthlyTargetQty,
              lastOrderAt: roll?.lastOrderAt ?? null,
            });
            return (
              <div key={r.customerId} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div>
                  <div className="font-semibold">{r.customerId}</div>
                  <div className="text-muted">
                    {roll?.volumeQty ?? 0} / {r.monthlyTargetQty} galon
                    {m.attainmentPct != null && <> · {m.attainmentPct}%</>}
                    {' · '}growth {m.growthPct >= 0 ? '↑' : '↓'} {Math.abs(m.growthPct)}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.pasif && <Badge tone="danger">Pasif</Badge>}
                  <Badge tone={m.status === 'lampaui' || m.status === 'tercapai' ? 'success' : m.status === 'no-target' ? 'neutral' : 'danger'}>
                    {RESELLER_STATUS_LABEL[m.status]}
                  </Badge>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
```

Note the reseller row shows `customerId` as a placeholder name — a customer-name lookup (via `endpoints.auth.customerLookup` or a batch name endpoint) is a nice-to-have; MVP shows the id. Confirm the real `useAuth` shape exposes `customer.role` and `customer.depotId` (it does in the HR page); adjust field names if the auth context differs.

- [ ] **Step 2: Typecheck + lint**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.
Run: `cd apps/web && npx eslint src/app/hq/resellers/page.tsx`
Expected: 0 problems.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/hq/resellers
git commit -m "feat(reseller): HQ/manager reseller achievement console page"
```

---

### Task 8: Register-reseller form + full verification pass

**Files:**
- Modify: `apps/web/src/app/hq/resellers/page.tsx` (add a "Tambah reseller" form: customerId (phone→id via `endpoints.auth.customerLookup`), homeDepotId, monthlyTargetQty, joinDate → POST `endpoints.resellers.create`; refresh registry on success)

**Interfaces:**
- Consumes: `endpoints.resellers.create`, `endpoints.auth.customerLookup` (existing phone→customer resolver), the toast + form atoms already used across the console.

- [ ] **Step 1: Add the create form**

Add a `Card` above the list with inputs bound to local state and a submit that calls:

```tsx
await api.post(endpoints.resellers.create, {
  customerId, homeDepotId: depotId, monthlyTargetQty: Number(target), joinDate: new Date(joinDate).toISOString(),
}, true);
```

then `registry.reload()`. Resolve `customerId` from a phone via `api.get(endpoints.auth.customerLookup(phone), true)` (staff-only resolver, already used for voucher grant). Surface 400 (not a customer) / 409 (already a reseller) via the existing `useToast`.

- [ ] **Step 2: Full backend verification**

Run each and confirm green:
- `cd services/customer-service && rtk proxy npx jest` → all pass (incl. reseller.service.spec).
- `cd services/order-service && rtk proxy npx jest test/unit/reseller-rollup.spec.ts` → pass.
- `cd services/customer-service && npx tsc --noEmit` → 0.
- `cd services/order-service && npx tsc --noEmit` → 0.

- [ ] **Step 3: Full web verification**

- `cd apps/web && rtk proxy npx vitest run test/reseller.test.ts` → pass.
- `cd apps/web && npx tsc --noEmit` → 0.
- `cd apps/web && npx eslint src/app/hq/resellers src/lib/reseller.ts` → 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/hq/resellers
git commit -m "feat(reseller): register-reseller form + verification pass"
```

---

## Self-Review

**Spec coverage:**
- Registry per depot (register/edit/deactivate) → Tasks 1–3, 8 (active flag = soft deactivate).
- Monthly volume target per reseller → `monthlyTargetQty`, Tasks 1–3.
- Achievement dashboard: volume / attainment% / growth / activity → Tasks 4 (rollup) + 6 (`evaluateReseller`) + 7 (render).
- Read-time actuals, no snapshot table → Task 4 (`resellerRollup`, no schema change).
- RBAC HEAD_OFFICE/DEPOT_MANAGER/SUPER_ADMIN → Task 3/5 `@Roles`, Task 6 `canViewResellers`.
- Edge cases (not a customer → 400; duplicate → 409; target 0 → no divide; zero orders → 0/pasif) → Tasks 2, 3, 6 tests.
- Deferred: reseller pricing, agent-service, cross-depot, new-account onboarding → explicitly out; note in Task 8 that register requires an existing customer.

**Placeholder scan:** No TBD/TODO left as work items. The only intentional simplifications are called out: reseller row shows `customerId` (name lookup optional), and depot-scoping trusts the role (manager passes own depotId) — both noted inline as MVP ceilings, not gaps.

**Type consistency:** `ResellerRollupRow` fields (`customerId`, `volumeQty`, `prevVolumeQty`, `orderCount`, `lastOrderAt`) match across order-service (Task 4) and web (Task 6). `evaluateReseller` input/output identical in test (Task 6 Step 1) and impl (Step 3). `monthlyTargetQty` is `Int`/`number` throughout. `endpoints.reports.resellerRollup` query params (`depotId`, `month`, `customerIds`) match `ResellerRollupQueryDto` (Task 5).
