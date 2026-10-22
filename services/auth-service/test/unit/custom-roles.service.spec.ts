import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import {
  can,
  currentCustomRoles,
  currentDepotOverrides,
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
} from '@hydromart/access';

import {
  CapabilityOverrideRecord,
  CapabilityOverrideRepository,
} from '../../src/application/ports/capability-override.repository';
import { AccessMatrixService, customRoleKeyFor } from '../../src/application/services/access-matrix.service';
import { AccessController } from '../../src/modules/auth/access.controller';
import { FakeAudit, FakeCustomRoles, asAudit } from '../support/fake-custom-roles';

const DEPOT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

class FakeOverrides implements CapabilityOverrideRepository {
  rows = new Map<string, CapabilityOverrideRecord>();
  listAll = () => Promise.resolve([...this.rows.values()]);
  upsert(capability: string, roles: string[], updatedBy: string | null): Promise<void> {
    this.rows.set(capability, { capability, roles, updatedBy, updatedAt: new Date(0) });
    return Promise.resolve();
  }
  remove(capability: string): Promise<void> {
    this.rows.delete(capability);
    return Promise.resolve();
  }
  applyAll(changes: { capability: string; roles: string[] | null }[], by: string | null): Promise<void> {
    for (const c of changes) {
      if (c.roles === null) this.rows.delete(c.capability);
      else this.rows.set(c.capability, { capability: c.capability, roles: c.roles, updatedBy: by, updatedAt: new Date(0) });
    }
    return Promise.resolve();
  }
}

describe('custom roles', () => {
  let overrides: FakeOverrides;
  let roles: FakeCustomRoles;
  let audit: FakeAudit;
  let service: AccessMatrixService;

  beforeEach(() => {
    overrides = new FakeOverrides();
    roles = new FakeCustomRoles();
    audit = new FakeAudit();
    service = new AccessMatrixService(overrides, roles, asAudit(audit));
  });
  afterEach(() => {
    loadOverrides({});
    loadCustomRoles([]);
    loadDepotOverrides([]);
  });

  describe('customRoleKeyFor', () => {
    it.each([
      ['Kasir Depot', 'C_kasir_depot'],
      ['  Kasir!! ', 'C_kasir'],
      ['Étoile', 'C_etoile'],
      ['---', ''],
      ['a'.repeat(80), `C_${'a'.repeat(40)}`],
    ])('%s -> %s', (name, key) => expect(customRoleKeyFor(name)).toBe(key));
  });

  describe('createRole', () => {
    it('creates, goes live in this process, and is audited', async () => {
      const r = await service.createRole({ name: 'Kasir Depot', scope: 'LOCKED' }, 'admin');
      expect(r.key).toBe('C_kasir_depot');
      expect(currentCustomRoles()).toEqual([{ key: 'C_kasir_depot', name: 'Kasir Depot', scope: 'LOCKED' }]);
      expect(audit.entries[0]).toMatchObject({ action: 'access.role.created', customerId: 'admin' });
    });

    it('refuses a name that yields no key, a bad scope, and a duplicate (any case)', async () => {
      await expect(service.createRole({ name: '!!', scope: 'LOCKED' }, null)).rejects.toThrow(BadRequestException);
      await expect(service.createRole({ name: 'Kasir', scope: 'EVERYWHERE' }, null)).rejects.toThrow(
        BadRequestException,
      );
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await expect(service.createRole({ name: 'KASIR', scope: 'GLOBAL' }, null)).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    beforeEach(async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.createRole({ name: 'Gudang', scope: 'LOCKED' }, null);
    });

    it('renames, rescopes and audits before/after', async () => {
      const r = await service.updateRole('C_kasir', { name: 'Kasir Utama', scope: 'RESOLVED', description: ' x ' }, 'a');
      expect(r).toMatchObject({ name: 'Kasir Utama', scope: 'RESOLVED', description: 'x' });
      expect(currentCustomRoles().find((c) => c.key === 'C_kasir')?.scope).toBe('RESOLVED');
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.role.updated' });
    });

    it('refuses an empty name, a taken name, a bad scope and an unknown role', async () => {
      await expect(service.updateRole('C_kasir', { name: '  ' }, null)).rejects.toThrow(BadRequestException);
      await expect(service.updateRole('C_kasir', { name: 'gudang' }, null)).rejects.toThrow(ConflictException);
      await expect(service.updateRole('C_kasir', { scope: 'X' }, null)).rejects.toThrow(BadRequestException);
      await expect(service.updateRole('C_nope', { name: 'zz' }, null)).rejects.toThrow(NotFoundException);
    });

    it('a rename to its own name is not a clash, and description can be cleared', async () => {
      const r = await service.updateRole('C_kasir', { name: 'Kasir', description: '' }, null);
      expect(r.description).toBeNull();
    });
  });

  describe('archiveRole', () => {
    beforeEach(async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.set('dashboard', ['C_kasir', 'MANAGER'], null);
      await service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'GRANT', null);
    });

    it('is refused while an account holds the role', async () => {
      roles.holders.set('C_kasir', 3);
      await expect(service.archiveRole('C_kasir', null)).rejects.toThrow(ConflictException);
      expect(currentCustomRoles()).toHaveLength(1);
    });

    it('archives, and the role then holds nothing at all', async () => {
      expect(can('dashboard', 'C_kasir')).toBe(true);
      await service.archiveRole('C_kasir', 'admin');
      expect(currentCustomRoles()).toEqual([]);
      expect(can('dashboard', 'C_kasir')).toBe(false);
      expect(can('dashboard', 'C_kasir', [DEPOT])).toBe(false);
      expect(currentDepotOverrides()).toEqual([]);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.role.archived' });
    });

    it('cannot be archived twice, and an archived key cannot be used in the matrix', async () => {
      await service.archiveRole('C_kasir', null);
      await expect(service.archiveRole('C_kasir', null)).rejects.toThrow(NotFoundException);
      await expect(service.set('dashboard', ['C_kasir'], null)).rejects.toThrow(BadRequestException);
    });
  });

  describe('matrix validation', () => {
    beforeEach(async () => {
      await service.createRole({ name: 'Kasir', scope: 'GLOBAL' }, null);
    });

    it('lets an active custom role into a capability list, live immediately', async () => {
      await service.set('dashboard', ['C_kasir'], 'admin');
      expect(can('dashboard', 'C_kasir')).toBe(true);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.matrix.changed' });
    });

    it.each(['accessMatrixWrite', 'staffAdmin', 'hierarchyAdmin', 'settingsGlobal'])(
      'refuses %s for a custom role, singly and in a batch',
      async (cap) => {
        await expect(service.set(cap, ['SUPER_ADMIN', 'C_kasir'], null)).rejects.toThrow(BadRequestException);
        await expect(
          service.applyAll([{ capability: cap, roles: ['SUPER_ADMIN', 'C_kasir'] }], null),
        ).rejects.toThrow(BadRequestException);
        expect(overrides.rows.size).toBe(0);
      },
    );

    it('refuses an unknown custom key and an unknown built-in', async () => {
      await expect(service.set('dashboard', ['C_ghost'], null)).rejects.toThrow('Peran tidak dikenal: C_ghost');
      await expect(service.set('dashboard', ['WIZARD'], null)).rejects.toThrow('Peran tidak dikenal: WIZARD');
    });

    it('audits a batch with before and after for each capability, and a reset with null after', async () => {
      await service.applyAll(
        [
          { capability: 'dashboard', roles: ['C_kasir'] },
          { capability: 'approvals', roles: null },
        ],
        'admin',
      );
      const entry = audit.entries.at(-1) as unknown as { metadata: { changes: { capability: string; after: unknown }[] } };
      expect(entry.metadata.changes.map((c) => c.capability)).toEqual(['dashboard', 'approvals']);
      expect(entry.metadata.changes[1].after).toBeNull();
      await service.reset('dashboard', 'admin');
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.matrix.reset' });
      expect(can('dashboard', 'C_kasir')).toBe(false);
    });
  });

  describe('per-depot overrides', () => {
    beforeEach(async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
    });

    it('GRANT works only at that depot; DENY beats the global list; reset undoes it', async () => {
      await service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'GRANT', 'admin');
      expect(can('dashboard', 'C_kasir', [DEPOT])).toBe(true);
      expect(can('dashboard', 'C_kasir', [OTHER])).toBe(false);

      await service.set('dashboard', ['MANAGER'], null);
      await service.setDepotOverride('dashboard', 'MANAGER', DEPOT, 'DENY', 'admin');
      expect(can('dashboard', 'MANAGER', [DEPOT])).toBe(false);
      expect(can('dashboard', 'MANAGER', [OTHER])).toBe(true);

      await service.resetDepotOverride('dashboard', 'MANAGER', DEPOT, 'admin');
      expect(can('dashboard', 'MANAGER', [DEPOT])).toBe(true);
      expect(audit.entries.map((e) => e.action)).toEqual(
        expect.arrayContaining(['access.depotOverride.set', 'access.depotOverride.reset']),
      );
    });

    it('refuses a bad effect, an unknown capability, SUPER_ADMIN and a forbidden capability', async () => {
      await expect(service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'MAYBE', null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setDepotOverride('nope', 'C_kasir', DEPOT, 'GRANT', null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setDepotOverride('dashboard', 'SUPER_ADMIN', DEPOT, 'DENY', null)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setDepotOverride('staffAdmin', 'C_kasir', DEPOT, 'GRANT', null)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('snapshot and view', () => {
    it('serves from cache within the TTL and carries all three parts', async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'GRANT', null);
      const listAll = jest.spyOn(roles, 'listAll');
      const snap = await service.snapshot();
      expect(snap.customRoles).toHaveLength(1);
      expect(snap.depotOverrides).toHaveLength(1);
      await service.snapshot();
      expect(listAll).not.toHaveBeenCalled();
      const view = await service.view();
      expect(view.customRoles).toHaveLength(1);
      expect(view.depotOverrides).toHaveLength(1);
      expect(await service.listRoles()).toHaveLength(1);
    });

    it('drops depot rows whose custom role is no longer active', async () => {
      roles.depot.set('k', { capability: 'dashboard', roleKey: 'C_gone', depotId: DEPOT, effect: 'GRANT', updatedBy: null, updatedAt: new Date(0) });
      const snap = await service.refresh();
      expect(snap.depotOverrides).toEqual([]);
    });
  });

  describe('AccessController delegation', () => {
    it('forwards every role and depot route with the actor', async () => {
      const m = {
        listRoles: jest.fn().mockResolvedValue([]),
        createRole: jest.fn().mockResolvedValue({}),
        updateRole: jest.fn().mockResolvedValue({}),
        archiveRole: jest.fn().mockResolvedValue(undefined),
        setDepotOverride: jest.fn().mockResolvedValue(undefined),
        resetDepotOverride: jest.fn().mockResolvedValue(undefined),
      };
      const c = new AccessController(m as never);
      const u = { sub: 'admin' } as never;
      await c.listRoles();
      await c.createRole({ name: 'x', scope: 'LOCKED' } as never, u);
      await c.updateRole('C_x', { name: 'y' } as never, u);
      await c.archiveRole('C_x', u);
      await c.setDepotOverride('dashboard', DEPOT, { roleKey: 'C_x', effect: 'GRANT' } as never, u);
      await c.resetDepotOverride('dashboard', DEPOT, 'C_x', u);
      expect(m.createRole).toHaveBeenCalledWith({ name: 'x', scope: 'LOCKED' }, 'admin');
      expect(m.updateRole).toHaveBeenCalledWith('C_x', { name: 'y' }, 'admin');
      expect(m.archiveRole).toHaveBeenCalledWith('C_x', 'admin');
      expect(m.setDepotOverride).toHaveBeenCalledWith('dashboard', 'C_x', DEPOT, 'GRANT', 'admin');
      expect(m.resetDepotOverride).toHaveBeenCalledWith('dashboard', 'C_x', DEPOT, 'admin');
    });
  });
});
