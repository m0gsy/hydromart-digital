import { loadCustomRoles, loadRoleSettings } from '@hydromart/access';
import { StaleWriteError } from '@hydromart/platform';

import {
  LegalEntityService,
  aiGrantableRoles,
} from '../../src/application/services/legal-entity.service';
import {
  DepotLegalEntityPointNotFoundError,
  DepotNotFoundError,
  DuplicateLegalEntityNameError,
  LegalEntityInactiveError,
  LegalEntityNotFoundError,
  LegalEntityRoleNotGrantableError,
} from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import {
  formatCalendarDay,
  normaliseLegalEntityName,
  parseCalendarDay,
} from '../../src/domain/legal-entity';
import { InMemoryDepotRepository } from '../support/fakes';
import { InMemoryLegalEntityRepository } from '../support/legal-entity-fakes';

const DEPOT = {
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
};

const ACTOR = '11111111-1111-4111-8111-111111111111';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const day = (s: string): Date => parseCalendarDay(s)!;

describe('legal entity domain helpers', () => {
  it('reads a calendar day as the UTC midnight a @db.Date holds, and nothing else', () => {
    expect(parseCalendarDay('2026-12-01')?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(parseCalendarDay('2028-02-29')).not.toBeNull();
    expect(parseCalendarDay('2026-02-30')).toBeNull();
    expect(parseCalendarDay('2026-13-01')).toBeNull();
    expect(parseCalendarDay('2026-12-1')).toBeNull();
    expect(parseCalendarDay('1 Dec 2026')).toBeNull();
    expect(formatCalendarDay(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('stores a name trimmed with inner runs of space collapsed', () => {
    expect(normaliseLegalEntityName('  PT   Air\tNusantara ')).toBe('PT Air Nusantara');
  });
});

describe('aiGrantableRoles', () => {
  afterEach(() => {
    loadCustomRoles([]);
    loadRoleSettings([]);
  });

  it('names every role the AI web can be entered with: not CUSTOMER, not SUPER_ADMIN', () => {
    const keys = aiGrantableRoles().map((r) => r.key);
    expect(keys).toContain('HEAD_OFFICE');
    expect(keys).toContain('FRANCHISE_OWNER');
    expect(keys).not.toContain('CUSTOMER');
    expect(keys).not.toContain('SUPER_ADMIN');
  });

  it('carries a super admin rename and the custom roles in the snapshot', () => {
    loadRoleSettings([{ roleKey: 'HEAD_OFFICE', name: 'Kantor Pusat' }, { roleKey: 'FINANCE' }]);
    loadCustomRoles([{ key: 'C_sales', name: 'Sales Indowater', scope: 'GLOBAL' }]);
    const roles = aiGrantableRoles();
    expect(roles.find((r) => r.key === 'HEAD_OFFICE')).toEqual({ key: 'HEAD_OFFICE', name: 'Kantor Pusat', custom: false });
    expect(roles.find((r) => r.key === 'FINANCE')).toEqual({ key: 'FINANCE', name: null, custom: false });
    expect(roles.find((r) => r.key === 'C_sales')).toEqual({ key: 'C_sales', name: 'Sales Indowater', custom: true });
  });
});

describe('LegalEntityService', () => {
  let depots: InMemoryDepotRepository;
  let repo: InMemoryLegalEntityRepository;
  let service: LegalEntityService;

  beforeEach(() => {
    depots = new InMemoryDepotRepository();
    repo = new InMemoryLegalEntityRepository(() => depots.rows);
    service = new LegalEntityService(repo, depots);
  });

  afterEach(() => loadCustomRoles([]));

  const kelola = () => service.create({ name: 'PT Kelola Air', kind: 'OPERATOR' }, ACTOR);

  describe('create', () => {
    it('stores the normalised name with who entered it', async () => {
      const e = await service.create({ name: '  PT   Kelola Air ', kind: 'OPERATOR' }, ACTOR);
      expect(e).toMatchObject({ name: 'PT Kelola Air', kind: 'OPERATOR', active: true, createdBy: ACTOR });
    });

    it('refuses a second entity with the same name in another case', async () => {
      await kelola();
      await expect(service.create({ name: 'pt kelola  air', kind: 'FRANCHISOR' }, ACTOR)).rejects.toBeInstanceOf(
        DuplicateLegalEntityNameError,
      );
    });
  });

  describe('directory', () => {
    it('lists the entities with their AI readers, and the rows the matrix can name', async () => {
      const e = await kelola();
      await service.setAiGrants([{ legalEntityId: e.id, roleKey: 'HEAD_OFFICE', granted: true }], ACTOR);
      const dir = await service.directory();
      expect(dir.entities).toEqual([expect.objectContaining({ id: e.id, aiReadRoles: ['HEAD_OFFICE'] })]);
      expect(dir.roles.map((r) => r.key)).toContain('DIREKTUR');
    });
  });

  describe('update', () => {
    it('is 404 for an entity that does not exist', async () => {
      await expect(service.update(UNKNOWN, { name: 'X' }, undefined, ACTOR)).rejects.toBeInstanceOf(
        LegalEntityNotFoundError,
      );
    });

    it('refuses a rename built on a stale copy', async () => {
      const e = await kelola();
      await expect(service.update(e.id, { name: 'PT Baru' }, undefined, ACTOR)).rejects.toBeInstanceOf(
        StaleWriteError,
      );
      await expect(
        service.update(e.id, { name: 'PT Baru' }, new Date(0).toISOString(), ACTOR),
      ).rejects.toBeInstanceOf(StaleWriteError);
    });

    it('renames and re-kinds with the copy it read, and names what moved', async () => {
      const e = await kelola();
      const res = await service.update(
        e.id,
        { name: ' PT  Kelola Baru ', kind: 'FRANCHISOR' },
        e.updatedAt.toISOString(),
        ACTOR,
      );
      expect(res.after).toMatchObject({ name: 'PT Kelola Baru', kind: 'FRANCHISOR', updatedBy: ACTOR });
      expect(res.changed).toEqual({
        name: { from: 'PT Kelola Air', to: 'PT Kelola Baru' },
        kind: { from: 'OPERATOR', to: 'FRANCHISOR' },
      });
    });

    it('switches off with a bare toggle, no version needed', async () => {
      const e = await kelola();
      const res = await service.update(e.id, { active: false }, undefined, ACTOR);
      expect(res.after?.active).toBe(false);
      expect(res.changed).toEqual({ active: { from: true, to: false } });
    });

    it('writes nothing when nothing changes', async () => {
      const e = await kelola();
      const res = await service.update(
        e.id,
        { name: 'PT Kelola Air', kind: 'OPERATOR', active: true },
        e.updatedAt.toISOString(),
        ACTOR,
      );
      expect(res.after).toBeNull();
      expect(res.changed).toEqual({});
      expect((await repo.findById(e.id))?.updatedAt).toEqual(e.updatedAt);
    });

    it('refuses a rename onto another entity name', async () => {
      await kelola();
      const other = await service.create({ name: 'PT Indo', kind: 'FRANCHISOR' }, ACTOR);
      await expect(
        service.update(other.id, { name: 'PT KELOLA AIR' }, other.updatedAt.toISOString(), ACTOR),
      ).rejects.toBeInstanceOf(DuplicateLegalEntityNameError);
    });
  });

  describe('setAiGrants', () => {
    it('grants and revokes, the last word on a cell winning', async () => {
      const e = await kelola();
      const applied = await service.setAiGrants(
        [
          { legalEntityId: e.id, roleKey: 'FINANCE', granted: true },
          { legalEntityId: e.id, roleKey: 'HEAD_OFFICE', granted: true },
          { legalEntityId: e.id, roleKey: 'FINANCE', granted: false },
        ],
        ACTOR,
      );
      expect(applied).toHaveLength(2);
      expect((await repo.list())[0].aiReadRoles).toEqual(['HEAD_OFFICE']);
    });

    it.each(['CUSTOMER', 'SUPER_ADMIN', 'C_unknown'])('refuses to grant %s', async (roleKey) => {
      const e = await kelola();
      await expect(
        service.setAiGrants([{ legalEntityId: e.id, roleKey, granted: true }], ACTOR),
      ).rejects.toBeInstanceOf(LegalEntityRoleNotGrantableError);
    });

    it('grants a custom role from the snapshot, and revokes a key it no longer knows', async () => {
      const e = await kelola();
      loadCustomRoles([{ key: 'C_sales', name: 'Sales', scope: 'GLOBAL' }]);
      await service.setAiGrants([{ legalEntityId: e.id, roleKey: 'C_sales', granted: true }], ACTOR);
      loadCustomRoles([]);
      await service.setAiGrants([{ legalEntityId: e.id, roleKey: 'C_sales', granted: false }], ACTOR);
      expect((await repo.list())[0].aiReadRoles).toEqual([]);
    });

    it('is 404 when a cell names an entity that does not exist', async () => {
      await expect(
        service.setAiGrants([{ legalEntityId: UNKNOWN, roleKey: 'FINANCE', granted: false }], ACTOR),
      ).rejects.toBeInstanceOf(LegalEntityNotFoundError);
    });
  });

  describe('depots', () => {
    let depotId: string;
    beforeEach(async () => {
      depotId = (await depots.create(DEPOT)).id;
    });

    it('dates a depot to an entity, corrects the same day, and leaves an unchanged day alone', async () => {
      const e = await kelola();
      const other = await service.create({ name: 'PT Indo', kind: 'FRANCHISOR' }, ACTOR);
      const input = { depotIds: [depotId, depotId], legalEntityId: e.id, effectiveFrom: day('2026-01-01') };
      expect(await service.assignDepots(input, ACTOR)).toEqual([{ depotId, replaced: null }]);
      expect(await service.assignDepots(input, ACTOR)).toEqual([]);
      expect(
        await service.assignDepots({ ...input, legalEntityId: other.id }, ACTOR),
      ).toEqual([{ depotId, replaced: e.id }]);
      const [history] = await service.depotHistories();
      expect(history.points).toEqual([
        expect.objectContaining({ legalEntityId: other.id, effectiveFrom: '2026-01-01', recordedBy: ACTOR }),
      ]);
    });

    it('refuses an unknown entity, a switched-off one, and an unknown depot', async () => {
      const e = await kelola();
      const from = day('2026-01-01');
      await expect(
        service.assignDepots({ depotIds: [depotId], legalEntityId: UNKNOWN, effectiveFrom: from }, ACTOR),
      ).rejects.toBeInstanceOf(LegalEntityNotFoundError);
      await expect(
        service.assignDepots({ depotIds: [UNKNOWN], legalEntityId: e.id, effectiveFrom: from }, ACTOR),
      ).rejects.toBeInstanceOf(DepotNotFoundError);
      await service.update(e.id, { active: false }, undefined, ACTOR);
      await expect(
        service.assignDepots({ depotIds: [depotId], legalEntityId: e.id, effectiveFrom: from }, ACTOR),
      ).rejects.toBeInstanceOf(LegalEntityInactiveError);
    });

    it('takes back one point, and is 404 for one that is gone', async () => {
      const e = await kelola();
      await service.assignDepots(
        { depotIds: [depotId], legalEntityId: e.id, effectiveFrom: day('2026-01-01') },
        ACTOR,
      );
      const [{ points }] = await service.depotHistories();
      expect(await service.removeDepotPoint(points[0].id)).toMatchObject({ depotId, legalEntityId: e.id });
      await expect(service.removeDepotPoint(points[0].id)).rejects.toBeInstanceOf(
        DepotLegalEntityPointNotFoundError,
      );
    });
  });
});
