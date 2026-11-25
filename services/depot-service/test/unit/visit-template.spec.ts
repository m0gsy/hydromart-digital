import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CAPABILITY_KEY, StaleWriteError } from '@hydromart/platform';

import { VisitTemplateService } from '../../src/application/services/visit-template.service';
import { SopLookupPort } from '../../src/application/ports/sop-lookup.port';
import {
  VisitTemplateRepository,
  VisitTemplateWrite,
} from '../../src/application/ports/visit-template.repository';
import { VisitTemplateNotFoundError } from '../../src/domain/errors';
import { SopInForce, VisitTemplate } from '../../src/domain/visit-template';
import { DepotConfigService } from '../../src/config/depot-config.service';
import { SopLookupHttpAdapter } from '../../src/infrastructure/http/sop-lookup.http.adapter';
import { VisitTemplatePrismaRepository } from '../../src/infrastructure/prisma/visit-template.prisma.repository';
import { VisitTemplateController } from '../../src/modules/visit-template.controller';
import {
  CreateVisitTemplateDto,
  UpdateVisitTemplateDto,
  VisitTemplateConductQueryDto,
} from '../../src/modules/dto/visit-template.dto';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const SOP1 = '00000000-0000-4000-8000-0000000000a1';
const SOP2 = '00000000-0000-4000-8000-0000000000a2';
const DEPOT = '00000000-0000-4000-8000-0000000000d1';

class InMemoryTemplates implements VisitTemplateRepository {
  rows: VisitTemplate[] = [];
  private seq = 0;
  private build(id: string, data: VisitTemplateWrite, active: boolean, createdBy: string | null) {
    return {
      id,
      name: data.name,
      active,
      createdBy,
      createdAt: new Date(2026, 10, 27, 0, 0, this.seq),
      updatedAt: new Date(2026, 10, 27, 1, 0, this.seq),
      items: data.items.map((it, position) => ({
        id: `item-${++this.seq}`,
        position,
        text: it.text,
        sopId: it.sopId ?? null,
      })),
    };
  }
  async list(activeOnly: boolean) {
    return this.rows.filter((r) => !activeOnly || r.active);
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(data: VisitTemplateWrite & { createdBy: string }) {
    const row = this.build(`tpl-${++this.seq}`, data, true, data.createdBy);
    this.rows.push(row);
    return row;
  }
  async replace(id: string, data: VisitTemplateWrite & { active: boolean }) {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.rows[i] = this.build(id, data, data.active, this.rows[i].createdBy);
    return this.rows[i];
  }
}

const seen = (t: VisitTemplate) => t.updatedAt.toISOString();

const inForce = (sopId: string): SopInForce => ({
  sopId,
  versionId: `ver-${sopId}`,
  versionNo: 3,
  title: 'SOP isi ulang',
  effectiveFrom: '2026-11-20',
});

describe('VisitTemplateService', () => {
  let repo: InMemoryTemplates;
  let sops: { inForce: jest.Mock };
  let svc: VisitTemplateService;

  beforeEach(() => {
    repo = new InMemoryTemplates();
    sops = { inForce: jest.fn() };
    svc = new VisitTemplateService(repo, sops as unknown as SopLookupPort);
  });

  it('creates a template whose checklist keeps the order it was written in', async () => {
    const t = await svc.create(
      { name: 'Rutin', items: [{ text: 'Lantai bersih' }, { text: 'Filter diganti', sopId: SOP1 }] },
      U1,
    );
    expect(t.createdBy).toBe(U1);
    expect(t.items.map((i) => [i.position, i.text, i.sopId])).toEqual([
      [0, 'Lantai bersih', null],
      [1, 'Filter diganti', SOP1],
    ]);
  });

  it('hides retired templates from conductors but shows them to head office', async () => {
    const a = await svc.create({ name: 'Aktif', items: [{ text: 'satu' }] }, U1);
    const b = await svc.create({ name: 'Lama', items: [{ text: 'satu' }] }, U1);
    await svc.replace(b.id, { name: 'Lama', active: false, items: [{ text: 'satu' }] }, seen(b));

    expect((await svc.list(false)).map((t) => t.id)).toEqual([a.id]);
    expect((await svc.list(true)).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('replaces name, flag and the whole item set', async () => {
    const t = await svc.create({ name: 'Rutin', items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }, U1);
    const saved = await svc.replace(
      t.id,
      { name: 'Rutin 2', active: true, items: [{ text: 'z' }] },
      seen(t),
    );
    expect(saved.name).toBe('Rutin 2');
    expect(saved.items.map((i) => i.text)).toEqual(['z']);
    expect(saved.createdBy).toBe(U1);
  });

  it('answers 404 for replacing a template that is not there', async () => {
    await expect(
      svc.replace(U2, { name: 'x', active: true, items: [{ text: 'y' }] }, new Date().toISOString()),
    ).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
  });

  it('refuses a save built on a copy that has since moved, or one that says nothing', async () => {
    const t = await svc.create({ name: 'Rutin', items: [{ text: 'a' }] }, U1);
    const body = { name: 'Rutin', active: true, items: [{ text: 'b' }] };
    await svc.replace(t.id, body, seen(t)); // the first editor lands...
    await expect(svc.replace(t.id, body, seen(t))).rejects.toBeInstanceOf(StaleWriteError); // ...the second is stale
    await expect(svc.replace(t.id, body)).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('answers 404 when the template vanishes between the read and the write', async () => {
    const t = await svc.create({ name: 'Rutin', items: [{ text: 'a' }] }, U1);
    jest.spyOn(repo, 'replace').mockResolvedValueOnce(null);
    await expect(
      svc.replace(t.id, { name: 'Rutin', active: true, items: [{ text: 'a' }] }, seen(t)),
    ).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
  });

  it('does not hand a retired or unknown template to a conductor', async () => {
    const t = await svc.create({ name: 'Rutin', items: [{ text: 'a' }] }, U1);
    await svc.replace(t.id, { name: 'Rutin', active: false, items: [{ text: 'a' }] }, seen(t));
    await expect(svc.getForConductor(t.id)).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
    await expect(svc.getForConductor(U2)).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
  });

  it('does not ask hr without a depot, or when no item names a SOP', async () => {
    const withSop = await svc.create({ name: 'A', items: [{ text: 'a', sopId: SOP1 }] }, U1);
    const plain = await svc.create({ name: 'B', items: [{ text: 'a' }] }, U1);

    const noDepot = await svc.getForConductor(withSop.id);
    expect(noDepot.sopLookup).toBe('skipped');
    expect(noDepot.items[0].sopInForce).toBeNull();

    expect((await svc.getForConductor(plain.id, DEPOT)).sopLookup).toBe('skipped');
    expect(sops.inForce).not.toHaveBeenCalled();
  });

  it('attaches the SOP version in force, asking once per distinct SOP', async () => {
    const t = await svc.create(
      {
        name: 'A',
        items: [
          { text: 'a', sopId: SOP1 },
          { text: 'b', sopId: SOP1 },
          { text: 'c', sopId: SOP2 },
          { text: 'd' },
        ],
      },
      U1,
    );
    sops.inForce.mockResolvedValue([inForce(SOP1)]); // SOP2 has nothing in force at this depot

    const view = await svc.getForConductor(t.id, DEPOT);

    expect(sops.inForce).toHaveBeenCalledWith(DEPOT, [SOP1, SOP2]);
    expect(view.sopLookup).toBe('ok');
    expect(view.items.map((i) => i.sopInForce?.versionNo ?? null)).toEqual([3, 3, null, null]);
  });

  it('still returns the checklist when hr cannot be asked', async () => {
    const t = await svc.create({ name: 'A', items: [{ text: 'a', sopId: SOP1 }] }, U1);
    sops.inForce.mockResolvedValue(null);

    const view = await svc.getForConductor(t.id, DEPOT);

    expect(view.sopLookup).toBe('unavailable');
    expect(view.items).toHaveLength(1);
    expect(view.items[0].sopInForce).toBeNull();
  });
});

describe('VisitTemplateController', () => {
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    replace: jest.fn(),
    getForConductor: jest.fn(),
  };
  const controller = new VisitTemplateController(svc as never);

  const capOf = (name: keyof VisitTemplateController) =>
    Reflect.getMetadata(CAPABILITY_KEY, VisitTemplateController.prototype[name]);

  it('puts each route behind the right capability', () => {
    expect(capOf('listActive')).toBe('visitConduct');
    expect(capOf('get')).toBe('visitConduct');
    expect(capOf('listAll')).toBe('visitTemplateManage');
    expect(capOf('create')).toBe('visitTemplateManage');
    expect(capOf('replace')).toBe('visitTemplateManage');
  });

  it('declares the static "manage" list before the :id read', () => {
    const names = Object.getOwnPropertyNames(VisitTemplateController.prototype);
    expect(names.indexOf('listAll')).toBeLessThan(names.indexOf('get'));
  });

  it('delegates each route to the service', async () => {
    await controller.listActive();
    expect(svc.list).toHaveBeenLastCalledWith(false);
    await controller.listAll();
    expect(svc.list).toHaveBeenLastCalledWith(true);

    await controller.get(U1, { depotId: DEPOT });
    expect(svc.getForConductor).toHaveBeenCalledWith(U1, DEPOT);

    await controller.create({ name: 'n', items: [{ text: 'tt' }] } as never, { sub: U2 } as never);
    expect(svc.create).toHaveBeenCalledWith({ name: 'n', items: [{ text: 'tt' }] }, U2);

    await controller.replace(U1, {
      name: 'n',
      active: false,
      items: [{ text: 'tt' }],
      seenUpdatedAt: '2026-11-27T00:00:00.000Z',
    } as never);
    expect(svc.replace).toHaveBeenCalledWith(
      U1,
      { name: 'n', active: false, items: [{ text: 'tt' }] },
      '2026-11-27T00:00:00.000Z',
    );
  });
});

describe('visit template DTOs', () => {
  const props = <T extends object>(cls: new () => T, body: object) =>
    validateSync(plainToInstance(cls, body), { whitelist: true }).map((e) => e.property);
  const item = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `butir nomor ${i}` }));

  it('takes 1 to 60 items and a 3 to 120 character name', () => {
    expect(props(CreateVisitTemplateDto, { name: 'Rutin', items: item(1) })).toEqual([]);
    expect(props(CreateVisitTemplateDto, { name: 'Rutin', items: item(60) })).toEqual([]);
    expect(props(CreateVisitTemplateDto, { name: 'Rutin', items: [] })).toContain('items');
    expect(props(CreateVisitTemplateDto, { name: 'Rutin', items: item(61) })).toContain('items');
    expect(props(CreateVisitTemplateDto, { name: 'ab', items: item(1) })).toContain('name');
    expect(props(CreateVisitTemplateDto, { name: 'a'.repeat(121), items: item(1) })).toContain('name');
  });

  it('bounds an item text to 3-300 characters and a SOP to a uuid', () => {
    const one = (it: object) => props(CreateVisitTemplateDto, { name: 'Rutin', items: [it] });
    expect(one({ text: 'ab' })).toContain('items');
    expect(one({ text: 'a'.repeat(301) })).toContain('items');
    expect(one({ text: 'cukup', sopId: 'bukan-uuid' })).toContain('items');
    expect(one({ text: 'cukup', sopId: SOP1 })).toEqual([]);
  });

  it('needs the active flag on a replace, and a uuid depot on the conductor read', () => {
    const stamp = '2026-11-27T00:00:00.000Z';
    expect(props(UpdateVisitTemplateDto, { name: 'Rutin', items: item(1), seenUpdatedAt: stamp })).toContain('active');
    expect(props(UpdateVisitTemplateDto, { name: 'Rutin', items: item(1), active: false })).toContain('seenUpdatedAt');
    expect(props(UpdateVisitTemplateDto, { name: 'Rutin', items: item(1), active: false, seenUpdatedAt: stamp })).toEqual([]);
    expect(props(VisitTemplateConductQueryDto, {})).toEqual([]);
    expect(props(VisitTemplateConductQueryDto, { depotId: DEPOT })).toEqual([]);
    expect(props(VisitTemplateConductQueryDto, { depotId: 'x' })).toContain('depotId');
  });
});

describe('SopLookupHttpAdapter', () => {
  const fetchMock = jest.fn();
  const make = (over: Partial<Record<string, unknown>> = {}) =>
    new SopLookupHttpAdapter({
      hrServiceUrl: 'http://hr:3018',
      internalServiceKey: 'internal-key-01',
      ...over,
    } as unknown as DepotConfigService);
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('asks hr with the internal key and keeps only well-formed rows', async () => {
    fetchMock.mockResolvedValue(
      ok({ items: [inForce(SOP1), { sopId: SOP2 }, null, { ...inForce(SOP2), versionNo: '2' }] }),
    );

    const out = await make().inForce(DEPOT, [SOP1, SOP2]);

    expect(out).toEqual([inForce(SOP1)]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://hr:3018/api/v1/sops/internal/in-force?depotId=${DEPOT}&ids=${SOP1}%2C${SOP2}`,
    );
    expect(init.headers['x-internal-key']).toBe('internal-key-01');
  });

  it('answers an empty list without a call when there is nothing to ask about', async () => {
    await expect(make().inForce(DEPOT, [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no url', { hrServiceUrl: '' }],
    ['no key', { internalServiceKey: '' }],
  ])('answers null without a call when it has %s', async (_n, over) => {
    await expect(make(over).inForce(DEPOT, [SOP1])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers null on a non-2xx, a bad body or a transport error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response);
    await expect(make().inForce(DEPOT, [SOP1])).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(ok({ items: 'nope' }));
    await expect(make().inForce(DEPOT, [SOP1])).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(ok(null));
    await expect(make().inForce(DEPOT, [SOP1])).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(make().inForce(DEPOT, [SOP1])).resolves.toBeNull();
  });
});

describe('VisitTemplatePrismaRepository', () => {
  const visitTemplate = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const visitTemplateItem = { deleteMany: jest.fn() };
  const prisma = {
    visitTemplate,
    visitTemplateItem,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ visitTemplate, visitTemplateItem })),
  };
  const repo = new VisitTemplatePrismaRepository(prisma as never);
  const include = { items: { orderBy: { position: 'asc' } } };

  beforeEach(() => jest.clearAllMocks());

  it('lists active-only or everything, newest first, items in order', async () => {
    await repo.list(true);
    expect(visitTemplate.findMany).toHaveBeenLastCalledWith({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      include,
    });
    await repo.list(false);
    expect(visitTemplate.findMany).toHaveBeenLastCalledWith({
      where: undefined,
      orderBy: { createdAt: 'desc' },
      include,
    });
  });

  it('reads one by id', async () => {
    await repo.findById(U1);
    expect(visitTemplate.findUnique).toHaveBeenCalledWith({ where: { id: U1 }, include });
  });

  it('creates with positions taken from the array order', async () => {
    await repo.create({ name: 'n', createdBy: U2, items: [{ text: 'a' }, { text: 'b', sopId: SOP1 }] });
    expect(visitTemplate.create).toHaveBeenCalledWith({
      data: {
        name: 'n',
        createdBy: U2,
        items: {
          create: [
            { position: 0, text: 'a', sopId: null },
            { position: 1, text: 'b', sopId: SOP1 },
          ],
        },
      },
      include,
    });
  });

  it('replaces the item set inside one transaction', async () => {
    visitTemplate.findUnique.mockResolvedValue({ id: U1 });
    visitTemplate.update.mockResolvedValue({ id: U1 });

    await repo.replace(U1, { name: 'n', active: false, items: [{ text: 'a' }] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(visitTemplateItem.deleteMany).toHaveBeenCalledWith({ where: { templateId: U1 } });
    expect(visitTemplate.update).toHaveBeenCalledWith({
      where: { id: U1 },
      data: { name: 'n', active: false, items: { create: [{ position: 0, text: 'a', sopId: null }] } },
      include,
    });
  });

  it('touches nothing when the template is gone', async () => {
    visitTemplate.findUnique.mockResolvedValue(null);
    await expect(repo.replace(U1, { name: 'n', active: true, items: [{ text: 'a' }] })).resolves.toBeNull();
    expect(visitTemplateItem.deleteMany).not.toHaveBeenCalled();
    expect(visitTemplate.update).not.toHaveBeenCalled();
  });
});
