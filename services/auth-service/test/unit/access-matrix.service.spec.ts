import { BadRequestException } from '@nestjs/common';

import { CAPABILITIES, can, loadOverrides, rolesFor, type Role as AccessRole } from '@hydromart/access';

import {
  CapabilityOverrideRecord,
  CapabilityOverrideRepository,
} from '../../src/application/ports/capability-override.repository';
import { AccessMatrixService } from '../../src/application/services/access-matrix.service';
import { Role } from '../../src/domain/customer/role.enum';

class FakeOverrides implements CapabilityOverrideRepository {
  rows = new Map<string, CapabilityOverrideRecord>();

  listAll(): Promise<CapabilityOverrideRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  upsert(capability: string, roles: AccessRole[], updatedBy: string | null): Promise<void> {
    this.rows.set(capability, { capability, roles, updatedBy, updatedAt: new Date(0) });
    return Promise.resolve();
  }

  remove(capability: string): Promise<void> {
    this.rows.delete(capability);
    return Promise.resolve();
  }
}

describe('AccessMatrixService', () => {
  let repo: FakeOverrides;
  let service: AccessMatrixService;

  beforeEach(() => {
    repo = new FakeOverrides();
    service = new AccessMatrixService(repo);
    loadOverrides({});
  });

  afterEach(() => loadOverrides({}));

  it('stores an override and makes it live immediately', async () => {
    await service.set('approvals', [Role.SUPERVISOR, Role.MANAGER], 'admin-1');
    expect(repo.rows.get('approvals')?.roles).toEqual([Role.SUPERVISOR, Role.MANAGER]);
    expect(rolesFor('approvals')).toEqual([Role.SUPERVISOR, Role.MANAGER]);
    expect(can('approvals', Role.SUPERVISOR)).toBe(true);
  });

  it('records who made the change', async () => {
    await service.set('approvals', [Role.MANAGER], 'admin-1');
    expect(repo.rows.get('approvals')?.updatedBy).toBe('admin-1');
  });

  it('drops duplicate roles rather than storing them twice', async () => {
    await service.set('approvals', [Role.MANAGER, Role.MANAGER], null);
    expect(repo.rows.get('approvals')?.roles).toEqual([Role.MANAGER]);
  });

  it('resets a capability back to its compiled default', async () => {
    await service.set('approvals', [Role.SUPERVISOR], null);
    await service.reset('approvals');
    expect(repo.rows.has('approvals')).toBe(false);
    expect(rolesFor('approvals')).toEqual(CAPABILITIES.approvals);
  });

  it('treats resetting a never-overridden capability as a no-op, not an error', async () => {
    await expect(service.reset('approvals')).resolves.toBeUndefined();
  });

  it('refuses a capability name the compiled map does not declare', async () => {
    await expect(service.set('inventoryWirte', [Role.MANAGER], null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // …including one that would otherwise resolve through Object's prototype.
    await expect(service.set('constructor', [Role.MANAGER], null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.rows.size).toBe(0);
  });

  it('refuses an unknown role', async () => {
    await expect(service.set('approvals', ['ADMIN_BESAR'], null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.rows.size).toBe(0);
  });

  // The one irreversible edit: handing the key to the lock to nobody.
  it('refuses to remove SUPER_ADMIN from accessMatrixWrite', async () => {
    await expect(
      service.set('accessMatrixWrite', [Role.HEAD_OFFICE], null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.set('accessMatrixWrite', [Role.HEAD_OFFICE, Role.SUPER_ADMIN], null),
    ).resolves.toBeUndefined();
  });

  it('reports defaults, overrides and the effective matrix separately', async () => {
    await service.set('approvals', [Role.SUPERVISOR], null);
    const view = await service.view();
    expect(view.defaults.approvals).toEqual(CAPABILITIES.approvals);
    expect(view.overrides).toEqual({ approvals: [Role.SUPERVISOR] });
    expect(view.effective.approvals).toEqual([Role.SUPERVISOR]);
    expect(view.effective.inventoryWrite).toEqual(CAPABILITIES.inventoryWrite);
  });

  it('serves the patch the other services poll', async () => {
    await service.set('approvals', [Role.SUPERVISOR], null);
    expect(await service.patch()).toEqual({ approvals: [Role.SUPERVISOR] });
  });
});
