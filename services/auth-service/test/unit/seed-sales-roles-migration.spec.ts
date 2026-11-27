import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadOverrides } from '@hydromart/access';

import { CapabilityOverrideRecord } from '../../src/application/ports/capability-override.repository';
import {
  AccessMatrixService,
  customRoleKeyFor,
} from '../../src/application/services/access-matrix.service';
import { Role } from '../../src/domain/customer/role.enum';
import { FakeAudit, FakeCustomRoles, asAudit } from '../support/fake-custom-roles';

const sql = readFileSync(
  join(__dirname, '../../prisma/migrations/20261127100000_seed_sales_roles/migration.sql'),
  'utf8',
);

const roles = [...sql.matchAll(/\('(C_\w+)', '([^']+)', '[^']*', '(\w+)'/g)].map((m) => ({
  key: m[1],
  name: m[2],
  scope: m[3],
}));
const grants = [...sql.matchAll(/\('(\w+)', '(C_\w+)'\)/g)].map((m) => ({
  capability: m[1],
  key: m[2],
}));
const defaults = new Map(
  [...sql.matchAll(/\('(\w+)', ARRAY\[([^\]]+)\]\)/g)].map((m) => [
    m[1],
    m[2].split(',').map((s) => s.trim().replace(/'/g, '')),
  ]),
);

describe('seed_sales_roles migration', () => {
  it('seeds Sales and Sales Lead with the owner-approved capabilities', () => {
    expect(roles.map((r) => r.key)).toEqual(['C_sales', 'C_sales_lead']);
    expect(
      grants
        .filter((g) => g.key === 'C_sales')
        .map((g) => g.capability)
        .sort(),
    ).toEqual(['prospectCrm', 'prospectRead']);
    expect(
      grants
        .filter((g) => g.key === 'C_sales_lead')
        .map((g) => g.capability)
        .sort(),
    ).toEqual(['prospectCrm', 'prospectRead', 'prospectSettings']);
  });

  it('starts from the compiled defaults of 27 Nov 2026 and names only valid, seeded roles', () => {
    expect(Object.fromEntries(defaults)).toEqual({
      prospectRead: ['MARKETING', 'DIREKTUR', 'HEAD_OFFICE', 'SUPER_ADMIN'],
      prospectCrm: ['MARKETING', 'SUPER_ADMIN'],
      prospectSettings: ['SUPER_ADMIN'],
    });
    const builtIn = new Set<string>(Object.values(Role));
    for (const r of [...defaults.values()].flat()) expect(builtIn.has(r)).toBe(true);
    const seeded = new Set(roles.map((r) => r.key));
    for (const g of grants) expect(seeded.has(g.key)).toBe(true);
    for (const g of grants) expect(defaults.has(g.capability)).toBe(true);
  });

  it('passes the same validation the role CRUD applies', async () => {
    const rows = new Map<string, CapabilityOverrideRecord>();
    const overrides = {
      listAll: () => Promise.resolve([...rows.values()]),
      upsert: (capability: string, r: string[]) => {
        rows.set(capability, { capability, roles: r, updatedBy: null, updatedAt: new Date(0) });
        return Promise.resolve();
      },
      applyAll: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    loadOverrides({});
    const service = new AccessMatrixService(
      overrides,
      new FakeCustomRoles(),
      asAudit(new FakeAudit()),
    );
    for (const r of roles) {
      expect(customRoleKeyFor(r.name)).toBe(r.key);
      const made = await service.createRole({ name: r.name, scope: r.scope }, null);
      expect(made.key).toBe(r.key);
    }
    for (const g of grants) {
      const current = rows.get(g.capability)?.roles ?? defaults.get(g.capability)!;
      await service.set(g.capability, [...current, g.key], null); // throws on unknown or CUSTOM_FORBIDDEN
    }
    expect(rows.get('prospectSettings')?.roles).toEqual(['SUPER_ADMIN', 'C_sales_lead']);
    loadOverrides({});
  });
});
