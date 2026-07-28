import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { BonusRule } from '../../prisma/generated/client';
import {
  BonusRuleRepository,
  BonusRuleWrite,
} from '../../src/application/ports/bonus-rule.repository';
import {
  BonusRuleService,
  BonusRuleInput,
} from '../../src/application/services/bonus-rule.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'DEPOT_MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements BonusRuleRepository {
  rows: BonusRule[] = [];
  private seq = 0;
  async create(data: BonusRuleWrite): Promise<BonusRule> {
    const row = { id: `r-${++this.seq}`, ...data } as unknown as BonusRule;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<BonusRuleWrite>): Promise<BonusRule> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string): Promise<BonusRule | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listActiveForDepot(): Promise<BonusRule[]> {
    return this.rows;
  }
  async list(depotId?: string | null): Promise<BonusRule[]> {
    if (depotId === undefined) return this.rows;
    return this.rows.filter(
      (r) => (r as unknown as { depotId: string | null }).depotId === depotId,
    );
  }
}

const valid: BonusRuleInput = {
  bonusType: 'ATTENDANCE',
  name: '  Rajin  ',
  metric: 'ATTENDANCE_RATE',
  op: 'GTE',
  threshold: 100,
  rewardKind: 'FIXED',
  rewardValue: 50000,
};

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new BonusRuleService(repo) };
}

describe('BonusRuleService.create', () => {
  it('creates a global rule (trims the name, defaults active=true)', async () => {
    const { svc } = make();
    const r = await svc.create(hr, valid);
    expect(r).toMatchObject({ depotId: null, name: 'Rajin', active: true, createdBy: 'hr-1' });
  });

  it('honours an explicit active=false', async () => {
    const { svc } = make();
    const r = await svc.create(hr, { ...valid, active: false });
    expect(r.active).toBe(false);
  });

  it('enforces depot access for a depot-scoped rule', async () => {
    const { svc } = make();
    await expect(svc.create(manager(DEPOT_B), { ...valid, depotId: DEPOT_A })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      svc.create(manager(DEPOT_A), { ...valid, depotId: DEPOT_A }),
    ).resolves.toMatchObject({ depotId: DEPOT_A });
  });

  it('rejects every malformed field', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...valid, name: '   ' })).rejects.toThrow(/name wajib/);
    await expect(svc.create(hr, { ...valid, bonusType: 'NOPE' })).rejects.toThrow(
      /bonusType harus/,
    );
    await expect(svc.create(hr, { ...valid, metric: 'NOPE' })).rejects.toThrow(/metric harus/);
    await expect(svc.create(hr, { ...valid, op: 'NOPE' })).rejects.toThrow(/op harus/);
    await expect(svc.create(hr, { ...valid, rewardKind: 'NOPE' })).rejects.toThrow(
      /rewardKind harus/,
    );
    await expect(svc.create(hr, { ...valid, rewardValue: -1 })).rejects.toThrow(/negatif/);
  });
});

describe('BonusRuleService.update', () => {
  it('404s on a missing rule', async () => {
    const { svc } = make();
    await expect(svc.update(hr, 'nope', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('patches every provided field', async () => {
    const { svc } = make();
    const r = await svc.create(hr, valid);
    const updated = await svc.update(hr, r.id, {
      bonusType: 'PERFORMANCE',
      name: '  Baru  ',
      metric: 'PRESENT_DAYS',
      op: 'LTE',
      threshold: 5,
      rewardKind: 'PERCENT',
      rewardValue: 10,
      active: false,
    });
    expect(updated).toMatchObject({
      bonusType: 'PERFORMANCE',
      name: 'Baru',
      metric: 'PRESENT_DAYS',
      op: 'LTE',
      threshold: 5,
      rewardKind: 'PERCENT',
      rewardValue: 10,
      active: false,
    });
  });

  it('enforces depot access against the existing rule’s depot', async () => {
    const { svc } = make();
    const r = await svc.create(hr, { ...valid, depotId: DEPOT_A });
    await expect(svc.update(manager(DEPOT_B), r.id, { threshold: 1 })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(svc.update(manager(DEPOT_A), r.id, { threshold: 1 })).resolves.toMatchObject({
      threshold: 1,
    });
  });

  it('re-validates on partial update', async () => {
    const { svc } = make();
    const r = await svc.create(hr, valid);
    await expect(svc.update(hr, r.id, { op: 'NOPE' })).rejects.toThrow(/op harus/);
  });
});

describe('BonusRuleService.list', () => {
  it('delegates to the repo', async () => {
    const { svc } = make();
    await svc.create(hr, { ...valid, depotId: DEPOT_A });
    await svc.create(hr, valid);
    expect(await svc.list()).toHaveLength(2);
    expect(await svc.list(DEPOT_A)).toHaveLength(1);
    expect(await svc.list(null)).toHaveLength(1);
  });
});
