import { randomUUID } from 'node:crypto';
import * as platform from '@hydromart/platform';
import { AuthenticatedUser } from '@hydromart/platform';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  DepotFixedCostRepository,
  UpsertDepotFixedCostData,
} from '../../src/application/ports/depot-fixed-cost.repository';
import { DepotService } from '../../src/application/services/depot.service';
import { DepotFixedCostService } from '../../src/application/services/depot-fixed-cost.service';
import { DepotFixedCost } from '../../src/domain/depot-fixed-cost';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotFixedCostPrismaRepository } from '../../src/infrastructure/prisma/depot-fixed-cost.prisma.repository';
import { DepotFixedCostController } from '../../src/modules/depot-fixed-cost.controller';
import {
  DepotFixedCostsQueryDto,
  ImportDepotFixedCostRowDto,
  ImportDepotFixedCostsDto,
} from '../../src/modules/dto/depot-fixed-cost.dto';
import { InMemoryDepotRepository } from '../support/fakes';

const HQ = { sub: '00000000-0000-4000-8000-000000000001', role: 'FINANCE' } as AuthenticatedUser;

class InMemoryCosts implements DepotFixedCostRepository {
  rows: DepotFixedCost[] = [];
  constructor(private readonly names: Map<string, { code: string; name: string }>) {}

  async find(depotId: string, month: string, category: string) {
    return this.rows.find((r) => r.depotId === depotId && r.month === month && r.category === category) ?? null;
  }

  async listForMonth(month: string, depotId?: string) {
    return this.rows.filter((r) => r.month === month && (!depotId || r.depotId === depotId));
  }

  async upsert(d: UpsertDepotFixedCostData) {
    const hit = await this.find(d.depotId, d.month, d.category);
    if (hit) return void Object.assign(hit, { amountIdr: d.amountIdr, note: d.note });
    const depot = this.names.get(d.depotId)!;
    this.rows.push({
      id: randomUUID(),
      depotId: d.depotId,
      depotCode: depot.code,
      depotName: depot.name,
      month: d.month,
      category: d.category,
      amountIdr: d.amountIdr,
      note: d.note,
      updatedAt: new Date(),
    });
  }
}

const row = (over: Partial<ImportDepotFixedCostRowDto> = {}): ImportDepotFixedCostRowDto =>
  ({ depotCode: 'JKT-01', month: '2026-11', category: 'Sewa', amountIdr: 3_500_000, ...over }) as ImportDepotFixedCostRowDto;

describe('DepotFixedCostService', () => {
  let repo: InMemoryCosts;
  let service: DepotFixedCostService;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    const depots = new DepotService(depotRepo);
    const names = new Map<string, { code: string; name: string }>();
    for (const [code, name] of [['JKT-01', 'Depot Cikini'], ['BDG-01', 'Depot Bandung']]) {
      const d = await depots.create({
        code, name, ownershipType: OwnershipType.HKP, address: 'a', city: 'c', province: 'p',
        lat: -6.19, lng: 106.84, serviceRadiusKm: 5, deliveryFee: 5000, minOrderAmount: null,
        ownerId: null, operatingHours: {}, holidays: [],
      });
      names.set(d.id, { code, name });
    }
    repo = new InMemoryCosts(names);
    service = new DepotFixedCostService(repo, depotRepo);
  });

  const statuses = (r: { results: { status: string }[] }) => r.results.map((x) => x.status);

  it('creates, normalises the category, then skips an identical re-upload and updates a changed one', async () => {
    const first = await service.import([row({ category: '  Sewa  Gedung ' }), row({ category: 'Listrik', amountIdr: 0 })], HQ);
    expect(statuses(first)).toEqual(['created', 'created']);
    expect(repo.rows.map((r) => r.category)).toEqual(['sewa gedung', 'listrik']);

    const again = await service.import([row({ category: 'sewa gedung' })], HQ);
    expect(statuses(again)).toEqual(['skipped']);

    const changed = await service.import([row({ category: 'sewa gedung', amountIdr: 4_000_000, note: ' naik ' })], HQ);
    expect(statuses(changed)).toEqual(['updated']);
    expect(repo.rows[0]).toMatchObject({ amountIdr: 4_000_000, note: 'naik' });
    expect(changed.results[0]!.id).toBe(repo.rows[0]!.id);
  });

  it.each([
    [{ depotCode: '  ' }, 'Kode depot kosong'],
    [{ depotCode: 'XXX' }, 'tidak ditemukan'],
    [{ month: '2026-13' }, 'YYYY-MM'],
    [{ month: '2019-12' }, 'YYYY-MM'],
    [{ month: '2099-01' }, 'YYYY-MM'],
    [{ category: '   ' }, 'Kategori kosong'],
    [{ category: 'x'.repeat(41) }, 'maksimal 40'],
    [{ amountIdr: -1 }, 'bilangan bulat'],
    [{ amountIdr: 1.5 }, 'bilangan bulat'],
    [{ amountIdr: 2_147_483_648 }, 'bilangan bulat'],
    [{ note: 'n'.repeat(201) }, 'Catatan maksimal'],
  ])('fails only the bad row: %j', async (over, message) => {
    const out = await service.import([row(over), row({ category: 'ok' })], HQ);
    expect(statuses(out)).toEqual(['failed', 'created']);
    expect(out.results[0]!.message).toContain(message);
  });

  it('refuses the same depot, month and category twice in one file', async () => {
    const out = await service.import([row(), row({ category: 'SEWA', amountIdr: 1 })], HQ);
    expect(statuses(out)).toEqual(['created', 'failed']);
    expect(out.results[1]!.message).toContain('baris 1');
    expect(repo.rows[0]!.amountIdr).toBe(3_500_000);
  });

  it('lists one month with totals per depot, optionally for one depot', async () => {
    await service.import(
      [row(), row({ category: 'listrik', amountIdr: 500_000 }), row({ depotCode: 'BDG-01', amountIdr: 1_000_000 }), row({ month: '2026-10' })],
      HQ,
    );
    const all = await service.list('2026-11');
    expect(all.totalIdr).toBe(5_000_000);
    expect(all.byDepot.map((d) => [d.depotCode, d.totalIdr])).toEqual([['JKT-01', 4_000_000], ['BDG-01', 1_000_000]]);
    expect(all.rows).toHaveLength(3);
    const one = await service.list('2026-11', repo.rows.find((r) => r.depotCode === 'BDG-01')!.depotId);
    expect(one.totalIdr).toBe(1_000_000);
    expect((await service.list('2030-01')).totalIdr).toBe(0);
  });

  it('accepts the bounds: 2020-01 and the same month next year', async () => {
    const next = `${Number(new Date().getUTCFullYear()) + 1}-12`;
    const out = await service.import([row({ month: '2020-01' }), row({ month: next, category: 'b' })], HQ);
    expect(statuses(out)).toEqual(['created', 'created']);
  });

  it('turns a unique-key race into an update instead of a raw error', async () => {
    const real = repo.upsert.bind(repo);
    let first = true;
    repo.upsert = async (d) => {
      if (first) {
        first = false;
        await real({ ...d, amountIdr: 1 }); // the other import wins the insert
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      return real(d);
    };
    const out = await service.import([row()], HQ);
    expect(statuses(out)).toEqual(['updated']);
    expect(repo.rows[0]!.amountIdr).toBe(3_500_000);
    expect(out.results[0]!.id).toBe(repo.rows[0]!.id);
    repo.upsert = async () => { throw new Error('db down'); };
    expect(statuses(await service.import([row({ category: 'z' })], HQ))).toEqual(['failed']);
  });

  it('puts the months, depot count and verdict counts in the audit event', async () => {
    const audit = jest.spyOn(platform, 'recordAuditEvent').mockResolvedValue(undefined as never);
    await service.import([row(), row({ month: '2026-10' }), row({ amountIdr: -1, category: 'q' })], HQ);
    expect(audit.mock.calls[0]![1].metadata).toEqual({
      months: ['2026-10', '2026-11'], depots: 1, created: 2, updated: 0, skipped: 0, failed: 1,
    });
    audit.mockRestore();
  });

  it('the controller hands the query and the rows to the service', async () => {
    const controller = new DepotFixedCostController(service);
    const out = await controller.import({ rows: [row()] }, HQ);
    expect(out.created).toBe(1);
    expect((await controller.list({ month: '2026-11' })).rows).toHaveLength(1);
  });
});

describe('depot fixed cost DTOs', () => {
  it('keeps a wrong cell for the service to report, but rejects a bad month filter and over-long files', async () => {
    const ok = plainToInstance(ImportDepotFixedCostsDto, { rows: [{ depotCode: 'A', month: 'bad', category: 'c', amountIdr: 1 }] });
    expect(await validate(ok)).toHaveLength(0);
    const tooMany = plainToInstance(ImportDepotFixedCostsDto, {
      rows: Array.from({ length: 501 }, () => ({ depotCode: 'A', month: '2026-11', category: 'c', amountIdr: 1 })),
    });
    expect(await validate(tooMany)).not.toHaveLength(0);
    expect(await validate(plainToInstance(DepotFixedCostsQueryDto, { month: '2026-13' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DepotFixedCostsQueryDto, { month: '2026-11', depotId: 'nope' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DepotFixedCostsQueryDto, { month: '2026-11' }))).toHaveLength(0);
    expect(await validate(plainToInstance(DepotFixedCostsQueryDto, { month: '2019-12' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DepotFixedCostsQueryDto, { month: '2099-01' }))).not.toHaveLength(0);
  });
});

describe('DepotFixedCostPrismaRepository', () => {
  const model = { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() };
  const repo = new DepotFixedCostPrismaRepository({ depotFixedCost: model } as never);
  const dbRow = {
    id: 'c1', depotId: 'd1', month: '2026-11', category: 'sewa', amountIdr: 5, note: null,
    updatedAt: new Date(0), updatedBy: 'u', createdAt: new Date(0), depot: { code: 'JKT-01', name: 'Cikini' },
  };
  beforeEach(() => jest.clearAllMocks());

  it('finds by the composite key and maps the depot name in', async () => {
    model.findUnique.mockResolvedValue(dbRow);
    expect(await repo.find('d1', '2026-11', 'sewa')).toEqual({
      id: 'c1', depotId: 'd1', depotCode: 'JKT-01', depotName: 'Cikini', month: '2026-11',
      category: 'sewa', amountIdr: 5, note: null, updatedAt: new Date(0),
    });
    expect(model.findUnique.mock.calls[0][0].where).toEqual({
      depotId_month_category: { depotId: 'd1', month: '2026-11', category: 'sewa' },
    });
    model.findUnique.mockResolvedValue(null);
    expect(await repo.find('d1', '2026-11', 'x')).toBeNull();
  });

  it('lists a month, narrowed to one depot only when asked', async () => {
    model.findMany.mockResolvedValue([dbRow]);
    expect(await repo.listForMonth('2026-11')).toHaveLength(1);
    expect(model.findMany.mock.calls[0][0].where).toEqual({ month: '2026-11' });
    await repo.listForMonth('2026-11', 'd1');
    expect(model.findMany.mock.calls[1][0].where).toEqual({ month: '2026-11', depotId: 'd1' });
  });

  it('upserts splitting the key from the values', async () => {
    const data = { depotId: 'd1', month: '2026-11', category: 'sewa', amountIdr: 5, note: null, updatedBy: 'u' };
    await repo.upsert(data);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { depotId_month_category: { depotId: 'd1', month: '2026-11', category: 'sewa' } },
      create: data,
      update: { amountIdr: 5, note: null, updatedBy: 'u' },
    });
  });
});
