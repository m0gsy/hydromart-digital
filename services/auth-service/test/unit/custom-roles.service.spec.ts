import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { startCapabilityRefresh } from '@hydromart/platform';

import {
  can,
  currentCustomRoles,
  currentDepotOverrides,
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
  loadRoleSettings,
  isRoleDisabled,
  roleScopeSetting,
  currentRoleSettings,
} from '@hydromart/access';

import {
  CapabilityOverrideRecord,
  CapabilityOverrideRepository,
} from '../../src/application/ports/capability-override.repository';
import { AccessMatrixService, customRoleKeyFor } from '../../src/application/services/access-matrix.service';
import { AccessController } from '../../src/modules/auth/access.controller';
import { FakeAudit, FakeCustomRoles, asAudit } from '../support/fake-custom-roles';

const DEPOT = '11111111-1111-1111-1111-111111111111';
/** The fake repository stamps every row at epoch, so this is the version a form would have been shown. */
const SEEN = new Date(0).toISOString();
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
    loadRoleSettings([]);
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

  describe('two admins on the same role (stale writes)', () => {
    it('refuses a custom-role edit built on an older copy, or on none', async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await expect(
        service.updateRole('C_kasir', { name: 'Kasir 2', seenUpdatedAt: '2000-01-01T00:00:00.000Z' }, null),
      ).rejects.toThrow('sudah diubah orang lain');
      await expect(service.updateRole('C_kasir', { name: 'Kasir 2' }, null)).rejects.toThrow('sudah diubah orang lain');
      await expect(service.updateRole('C_kasir', { name: 'Kasir 2', seenUpdatedAt: 'junk' }, null)).rejects.toThrow(
        'sudah diubah orang lain',
      );
      // The copy that WAS shown is accepted (control).
      await expect(service.updateRole('C_kasir', { name: 'Kasir 2', seenUpdatedAt: SEEN }, null)).resolves.toBeDefined();
    });

    it('a built-in role with no settings yet has nothing to overwrite; once it has, the form must say what it saw', async () => {
      await service.updateBuiltInRole('HR', { name: 'SDM' }, 'admin');
      await expect(service.updateBuiltInRole('HR', { name: 'SDM 2' }, 'admin')).rejects.toThrow('sudah diubah orang lain');
      await expect(
        service.updateBuiltInRole('HR', { name: 'SDM 2', seenUpdatedAt: '2000-01-01T00:00:00.000Z' }, 'admin'),
      ).rejects.toThrow('sudah diubah orang lain');
      await service.updateBuiltInRole('HR', { name: 'SDM 2', seenUpdatedAt: SEEN }, 'admin');
      expect((await service.listBuiltInRoles())[0].name).toBe('SDM 2');
    });

    it('hands the form the version it must send back', async () => {
      await service.updateBuiltInRole('HR', { name: 'SDM' }, 'admin');
      const view = await service.view();
      expect(view.roleSettings[0]?.updatedAt).toBe(SEEN);
    });
  });

  describe('archived names and racing creates', () => {
    it('frees the NAME of an archived role but not its KEY', async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.archiveRole('C_kasir', null);
      await expect(service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null)).rejects.toThrow('diarsipkan');
      const r = await service.createRole({ name: 'Kasir Baru', scope: 'LOCKED' }, null);
      expect(r.key).toBe('C_kasir_baru');
      await service.createRole({ name: 'Gudang', scope: 'LOCKED' }, null);
      await service.archiveRole('C_gudang', null);
      await expect(service.updateRole('C_kasir_baru', { seenUpdatedAt: SEEN,  name: 'gudang' }, null)).resolves.toMatchObject({
        name: 'gudang',
      });
    });

    it('turns a unique-key race into a 409 and rethrows anything else', async () => {
      jest.spyOn(roles, 'create').mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null)).rejects.toThrow(ConflictException);
      jest.spyOn(roles, 'create').mockRejectedValueOnce(new Error('db down'));
      await expect(service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null)).rejects.toThrow('db down');
    });

    it('keeps the original error when the rollback itself fails', async () => {
      jest.spyOn(overrides, 'applyAll').mockRejectedValueOnce(new Error('tx failed'));
      jest.spyOn(roles, 'archive').mockRejectedValueOnce(new Error('archive failed'));
      await expect(service.createRole({ name: 'Gagal', copyFrom: 'MANAGER' }, null)).rejects.toThrow('tx failed');
    });
  });

  describe('updateRole', () => {
    beforeEach(async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.createRole({ name: 'Gudang', scope: 'LOCKED' }, null);
    });

    it('renames, rescopes and audits before/after', async () => {
      const r = await service.updateRole('C_kasir', { seenUpdatedAt: SEEN,  name: 'Kasir Utama', scope: 'RESOLVED', description: ' x ' }, 'a');
      expect(r).toMatchObject({ name: 'Kasir Utama', scope: 'RESOLVED', description: 'x' });
      expect(currentCustomRoles().find((c) => c.key === 'C_kasir')?.scope).toBe('RESOLVED');
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.role.updated' });
    });

    it('refuses an empty name, a taken name, a bad scope and an unknown role', async () => {
      await expect(service.updateRole('C_kasir', { seenUpdatedAt: SEEN,  name: '  ' }, null)).rejects.toThrow(BadRequestException);
      await expect(service.updateRole('C_kasir', { seenUpdatedAt: SEEN,  name: 'gudang' }, null)).rejects.toThrow(ConflictException);
      await expect(service.updateRole('C_kasir', { seenUpdatedAt: SEEN, scope: 'X' }, null)).rejects.toThrow(BadRequestException);
      await expect(service.updateRole('C_nope', { seenUpdatedAt: SEEN,  name: 'zz' }, null)).rejects.toThrow(NotFoundException);
    });

    it('a rename to its own name is not a clash, and description can be cleared', async () => {
      const r = await service.updateRole('C_kasir', { seenUpdatedAt: SEEN,  name: 'Kasir', description: '' }, null);
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

    it('refuses a rule for a network-wide role, because no guard can honour it', async () => {
      await expect(service.setDepotOverride('dashboard', 'HEAD_OFFICE', DEPOT, 'DENY', null)).rejects.toThrow(
        'hanya untuk peran yang dibatasi depot',
      );
      await expect(service.setDepotOverride('dashboard', 'FINANCE', DEPOT, 'GRANT', null)).rejects.toThrow(
        BadRequestException,
      );
      await service.createRole({ name: 'Pusat', scope: 'GLOBAL' }, null);
      await expect(service.setDepotOverride('dashboard', 'C_pusat', DEPOT, 'GRANT', null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to GRANT a forbidden capability per depot even to a depot-limited built-in role', async () => {
      await expect(service.setDepotOverride('staffAdmin', 'MANAGER', DEPOT, 'GRANT', null)).rejects.toThrow(
        'tidak bisa diberikan per depot',
      );
      // Taking it away is fine.
      await service.setDepotOverride('staffAdmin', 'MANAGER', DEPOT, 'DENY', null);
    });

    it('drops the rules of a role whose reach becomes network-wide', async () => {
      await service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'GRANT', null);
      await service.setDepotOverride('dashboard', 'MANAGER', DEPOT, 'DENY', null);
      expect(currentDepotOverrides()).toHaveLength(2);
      await service.updateRole('C_kasir', { seenUpdatedAt: SEEN, scope: 'GLOBAL' }, 'admin');
      expect(currentDepotOverrides().map((o) => o.roleKey)).toEqual(['MANAGER']);
      expect((audit.entries.at(-1)?.metadata as { droppedDepotRules: number }).droppedDepotRules).toBe(1);
      await service.updateBuiltInRole('MANAGER', { scope: 'GLOBAL' }, 'admin');
      expect(currentDepotOverrides()).toEqual([]);
      // A change that leaves the role depot-limited drops nothing.
      await service.updateBuiltInRole('MANAGER', { scope: 'LOCKED', seenUpdatedAt: SEEN }, 'admin');
      await service.setDepotOverride('dashboard', 'MANAGER', DEPOT, 'DENY', null);
      await service.updateBuiltInRole('MANAGER', { scope: null, seenUpdatedAt: SEEN }, 'admin');
      expect(currentDepotOverrides()).toHaveLength(1);
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

  describe('built-in roles', () => {
    it('renames, describes and rescopes a built-in role, audited with before/after', async () => {
      await service.updateBuiltInRole('MANAGER', { name: ' Manajer Wilayah ', description: 'x', scope: 'LOCKED' }, 'admin');
      expect(roleScopeSetting('MANAGER')).toBe('LOCKED');
      expect(currentRoleSettings()).toEqual([
        { roleKey: 'MANAGER', name: 'Manajer Wilayah', description: 'x', scope: 'LOCKED', disabled: false, updatedAt: SEEN },
      ]);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.builtin.updated' });
      await service.updateBuiltInRole('MANAGER', { scope: null, name: '', seenUpdatedAt: SEEN }, 'admin');
      expect(roleScopeSetting('MANAGER')).toBeUndefined();
      expect((await service.listBuiltInRoles())[0].name).toBeNull();
    });

    it('refuses CUSTOMER, an unknown role, a bad scope and a scope on a fixed role', async () => {
      await expect(service.updateBuiltInRole('CUSTOMER', { name: 'x' }, null)).rejects.toThrow(NotFoundException);
      await expect(service.updateBuiltInRole('C_kasir', { name: 'x' }, null)).rejects.toThrow(NotFoundException);
      await expect(service.updateBuiltInRole('MANAGER', { scope: 'MOON' }, null)).rejects.toThrow(BadRequestException);
      for (const fixed of ['SUPER_ADMIN', 'FRANCHISE_OWNER']) {
        await expect(service.updateBuiltInRole(fixed, { scope: 'LOCKED' }, null)).rejects.toThrow(BadRequestException);
      }
      // A name on a fixed role is fine; only its reach is off limits.
      await service.updateBuiltInRole('SUPER_ADMIN', { name: 'Superuser' }, null);
    });

    it('disables and re-enables a built-in role; refused while held, and for SUPER_ADMIN', async () => {
      roles.holders.set('FINANCE', 2);
      await expect(service.setBuiltInDisabled('FINANCE', true, null)).rejects.toThrow(ConflictException);
      await expect(service.setBuiltInDisabled('SUPER_ADMIN', true, null)).rejects.toThrow(BadRequestException);
      roles.holders.set('FINANCE', 0);
      await service.setBuiltInDisabled('FINANCE', true, 'admin');
      expect(isRoleDisabled('FINANCE')).toBe(true);
      expect(can('refundIssue', 'FINANCE')).toBe(false);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.builtin.disabled' });
      await service.setBuiltInDisabled('FINANCE', false, 'admin');
      expect(isRoleDisabled('FINANCE')).toBe(false);
      expect(can('refundIssue', 'FINANCE')).toBe(true);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.builtin.enabled' });
    });

    it('drops a stored setting for a role that is not built-in', async () => {
      roles.settings.set('C_x', { roleKey: 'C_x', name: null, description: null, scope: null, disabledAt: new Date(1), updatedBy: null, updatedAt: new Date(0) });
      expect((await service.refresh()).roleSettings).toEqual([]);
    });
  });

  describe('copy from a built-in role', () => {
    it('starts from its capabilities and reach, minus the forbidden ones', async () => {
      const r = await service.createRole({ name: 'Manajer Kecil', copyFrom: 'MANAGER' }, 'admin');
      expect(r.scope).toBe('RESOLVED');
      expect(can('approvals', 'C_manajer_kecil')).toBe(can('approvals', 'MANAGER'));
      expect(can('refundIssue', 'C_manajer_kecil')).toBe(true);
      // MANAGER may not hold these, but a role copied from HEAD_OFFICE must not inherit them either.
      const ho = await service.createRole({ name: 'Kantor Kecil', copyFrom: 'HEAD_OFFICE', scope: 'GLOBAL' }, 'admin');
      expect(ho.scope).toBe('GLOBAL');
      for (const cap of ['staffAdmin', 'accessMatrixWrite', 'hierarchyAdmin', 'settingsGlobal'] as const) {
        expect(can(cap, 'C_kantor_kecil')).toBe(false);
      }
      expect(can('hqConsole', 'C_kantor_kecil')).toBe(true);
      expect(audit.entries.at(-1)).toMatchObject({ action: 'access.role.created' });
    });

    it('refuses a source that is CUSTOMER, custom or unknown', async () => {
      for (const copyFrom of ['CUSTOMER', 'C_x', 'WIZARD']) {
        await expect(service.createRole({ name: 'Salinan', copyFrom }, null)).rejects.toThrow(BadRequestException);
      }
    });

    it('rolls the role back if copying the capabilities fails', async () => {
      jest.spyOn(overrides, 'applyAll').mockRejectedValueOnce(new Error('tx failed'));
      await expect(service.createRole({ name: 'Gagal', copyFrom: 'MANAGER' }, null)).rejects.toThrow('tx failed');
      expect(roles.roles.get('C_gagal')?.archivedAt).not.toBeNull();
    });
  });

  describe('auth-service feeds its own refresher the FULL snapshot', () => {
    it('keeps custom roles, depot rules and role settings loaded across a poll tick', async () => {
      await service.createRole({ name: 'Kasir', scope: 'LOCKED' }, null);
      await service.setDepotOverride('dashboard', 'C_kasir', DEPOT, 'GRANT', null);
      await service.updateBuiltInRole('HR', { name: 'SDM' }, null);
      const stop = startCapabilityRefresh(() => service.snapshot(), { ttlMs: 5 });
      await new Promise((r) => setTimeout(r, 40));
      stop();
      expect(currentCustomRoles()).toHaveLength(1);
      expect(currentDepotOverrides()).toHaveLength(1);
      expect(currentRoleSettings()).toHaveLength(1);
    });

    // A bare patch reads as "none of it" and wipes this process's own copy on every tick, while
    // the console (which reads the database) keeps looking right. main.ts is not loaded by any
    // unit test, so the wiring itself is pinned here.
    it('main.ts passes snapshot(), never patch(), to the refresher', () => {
      const main = readFileSync(join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8');
      expect(main).toMatch(/startCapabilityRefresh\(\(\) => matrix\.snapshot\(\)/);
      expect(main).not.toMatch(/startCapabilityRefresh\(\(\) => matrix\.patch\(\)/);
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
        updateBuiltInRole: jest.fn().mockResolvedValue(undefined),
        setBuiltInDisabled: jest.fn().mockResolvedValue(undefined),
        setDepotOverride: jest.fn().mockResolvedValue(undefined),
        resetDepotOverride: jest.fn().mockResolvedValue(undefined),
      };
      const c = new AccessController(m as never);
      const u = { sub: 'admin' } as never;
      await c.listRoles();
      await c.createRole({ name: 'x', scope: 'LOCKED' } as never, u);
      await c.updateRole('C_x', { name: 'y' } as never, u);
      await c.archiveRole('C_x', u);
      await c.setDepotOverride('dashboard', DEPOT, 'C_x', { effect: 'GRANT' } as never, u);
      await c.resetDepotOverride('dashboard', DEPOT, 'C_x', u);
      await c.updateBuiltIn('MANAGER', { name: 'M' } as never, u);
      await c.setBuiltInDisabled('FINANCE', { disabled: true } as never, u);
      expect(m.updateBuiltInRole).toHaveBeenCalledWith('MANAGER', { name: 'M' }, 'admin');
      expect(m.setBuiltInDisabled).toHaveBeenCalledWith('FINANCE', true, 'admin');
      expect(m.createRole).toHaveBeenCalledWith({ name: 'x', scope: 'LOCKED' }, 'admin');
      expect(m.updateRole).toHaveBeenCalledWith('C_x', { name: 'y' }, 'admin');
      expect(m.archiveRole).toHaveBeenCalledWith('C_x', 'admin');
      expect(m.setDepotOverride).toHaveBeenCalledWith('dashboard', 'C_x', DEPOT, 'GRANT', 'admin');
      expect(m.resetDepotOverride).toHaveBeenCalledWith('dashboard', 'C_x', DEPOT, 'admin');
    });
  });
});
