import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '@hydromart/platform';

import { LegalEntityService } from '../../src/application/services/legal-entity.service';
import { DepotConfigService } from '../../src/config/depot-config.service';
import { LegalEntityNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { LegalEntityController } from '../../src/modules/legal-entity.controller';
import {
  AssignDepotsDto,
  CreateLegalEntityDto,
  UpdateLegalEntityDto,
} from '../../src/modules/dto/legal-entity.dto';
import { InMemoryDepotRepository } from '../support/fakes';
import { InMemoryLegalEntityRepository } from '../support/legal-entity-fakes';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const user = { sub: ACTOR, role: 'HEAD_OFFICE' } as unknown as AuthenticatedUser;

describe('LegalEntityController', () => {
  const fetchMock = jest.fn();
  let depots: InMemoryDepotRepository;
  let controller: LegalEntityController;
  let depotId: string;

  /** What reached the audit ingest, in order. */
  const trail = (): Array<{ action: string; target: string; metadata: Record<string, unknown> }> =>
    fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body));

  beforeEach(async () => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
    depots = new InMemoryDepotRepository();
    const repo = new InMemoryLegalEntityRepository(() => depots.rows);
    const config = { authServiceUrl: 'http://auth:3001', internalServiceKey: 'k' } as DepotConfigService;
    controller = new LegalEntityController(new LegalEntityService(repo, depots), config);
    depotId = (
      await depots.create({
        code: 'JKT-01',
        name: 'Depot Cikini',
        ownershipType: OwnershipType.HKP,
        address: 'Jl. Cikini Raya No. 1',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        lat: -6.19,
        lng: 106.84,
        serviceRadiusKm: 5,
        deliveryFee: 5000,
        minOrderAmount: null,
        ownerId: null,
        operatingHours: {},
        holidays: [],
      })
    ).id;
  });

  const create = () => controller.create({ name: 'PT Kelola Air', kind: 'OPERATOR' }, user);

  it('creates an entity and trails it', async () => {
    const e = await create();
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'legal_entity.create',
        target: 'PT Kelola Air',
        metadata: { legalEntityId: e.id, kind: 'OPERATOR' },
      }),
    ]);
    expect((await controller.directory()).entities).toHaveLength(1);
  });

  it('trails a rename with what moved, and a save that changes nothing not at all', async () => {
    const e = await create();
    fetchMock.mockClear();
    expect(await controller.update(e.id, { name: 'PT Kelola Air', seenUpdatedAt: e.updatedAt.toISOString() }, user)).toEqual(e);
    expect(fetchMock).not.toHaveBeenCalled();
    const after = await controller.update(e.id, { name: 'PT Kelola Baru', seenUpdatedAt: e.updatedAt.toISOString() }, user);
    expect(after.name).toBe('PT Kelola Baru');
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'legal_entity.update',
        metadata: { legalEntityId: e.id, changed: { name: { from: 'PT Kelola Air', to: 'PT Kelola Baru' } } },
      }),
    ]);
  });

  it('sets matrix cells, trails them and answers with the directory', async () => {
    const e = await create();
    fetchMock.mockClear();
    const dir = await controller.setAiGrants(
      { changes: [{ legalEntityId: e.id, roleKey: 'FINANCE', granted: true }] },
      user,
    );
    expect(dir.entities[0].aiReadRoles).toEqual(['FINANCE']);
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'legal_entity.ai_grants.update',
        target: '1 cell(s)',
        metadata: { changes: [{ legalEntityId: e.id, roleKey: 'FINANCE', granted: true }] },
      }),
    ]);
  });

  it('dates depots, trails only a write that happened, and refuses a day that is not one', async () => {
    const e = await create();
    fetchMock.mockClear();
    const body = { depotIds: [depotId], legalEntityId: e.id, effectiveFrom: '2026-12-01', seen: [] };
    expect(await controller.assignDepots(body, user)).toEqual([{ depotId, replaced: null }]);
    expect(
      await controller.assignDepots({ ...body, seen: [{ id: depotId, legalEntityId: e.id }] }, user),
    ).toEqual([]);
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'legal_entity.depots.assign',
        metadata: { legalEntityId: e.id, effectiveFrom: '2026-12-01', depots: [{ depotId, replaced: null }] },
      }),
    ]);
    await expect(controller.assignDepots({ ...body, effectiveFrom: '2026-02-30' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const [history] = await controller.depotHistories();
    expect(history.points).toHaveLength(1);
  });

  it('takes back a point and trails what it was', async () => {
    const e = await create();
    await controller.assignDepots(
      { depotIds: [depotId], legalEntityId: e.id, effectiveFrom: '2026-12-01', seen: [] },
      user,
    );
    const [{ points }] = await controller.depotHistories();
    fetchMock.mockClear();
    await controller.removeDepotPoint(points[0].id, { legalEntityId: e.id }, user);
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'legal_entity.depots.remove',
        metadata: { depotId, legalEntityId: e.id, effectiveFrom: '2026-12-01' },
      }),
    ]);
  });

  it('answers hr-service with name, kind and on/off, and 404 for an unknown id', async () => {
    const e = await create();
    expect(await controller.internalSummary(e.id)).toEqual({
      id: e.id,
      name: 'PT Kelola Air',
      kind: 'OPERATOR',
      active: true,
    });
    await expect(controller.internalSummary(UNKNOWN)).rejects.toBeInstanceOf(LegalEntityNotFoundError);
  });
});

describe('legal entity DTOs', () => {
  const check = async <T extends object>(cls: new () => T, body: object) =>
    validate(plainToInstance(cls, body) as object);

  it('trims a name but passes a non-string on to be refused, not crashed on', async () => {
    expect(plainToInstance(CreateLegalEntityDto, { name: '  PT A  ', kind: 'OPERATOR' }).name).toBe('PT A');
    expect(await check(CreateLegalEntityDto, { name: 123, kind: 'OPERATOR' })).not.toHaveLength(0);
    expect(await check(CreateLegalEntityDto, { name: '   ', kind: 'OPERATOR' })).not.toHaveLength(0);
  });

  it('refuses an explicit null on a patch, and lets an absent field through', async () => {
    expect(await check(UpdateLegalEntityDto, { active: false })).toHaveLength(0);
    for (const body of [{ name: null }, { kind: null }, { active: null }]) {
      expect(await check(UpdateLegalEntityDto, body)).not.toHaveLength(0);
    }
  });

  it('wants what the screen saw for the day, and a real calendar day', async () => {
    const base = { depotIds: [UNKNOWN], legalEntityId: UNKNOWN, effectiveFrom: '2026-12-01' };
    expect(await check(AssignDepotsDto, { ...base, seen: [] })).toHaveLength(0);
    expect(await check(AssignDepotsDto, base)).not.toHaveLength(0);
    expect(await check(AssignDepotsDto, { ...base, seen: [{ id: 'x', legalEntityId: UNKNOWN }] })).not.toHaveLength(0);
    expect(await check(AssignDepotsDto, { ...base, effectiveFrom: '2026-02-30', seen: [] })).not.toHaveLength(0);
  });
});
