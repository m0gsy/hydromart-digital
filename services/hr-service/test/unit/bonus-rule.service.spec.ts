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
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements BonusRuleRepository {
  rows: BonusRule[] = [];
  private seq = 0;
  async create(data: BonusRuleWrite): Promise<BonusRule> {
    // CA-2-53: the stamp a form edits against. A fake without it cannot tell a stale save
    // from a fresh one, so the guard would look tested when it was not.
    const row = {
      id: `r-${++this.seq}`,
      updatedAt: new Date(this.seq * 1000),
      ...data,
    } as unknown as BonusRule;
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, data: Partial<BonusRuleWrite>): Promise<BonusRule> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: new Date(++this.seq * 1000) });
    return { ...row };
  }
  async findById(id: string): Promise<BonusRule | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listActiveForDepot(): Promise<BonusRule[]> {
    return this.rows;
  }
  async list(scope?: string | null | readonly string[]): Promise<BonusRule[]> {
    if (scope === undefined) return this.rows;
    const depotOf = (r: BonusRule) => (r as unknown as { depotId: string | null }).depotId;
    // Mirrors the Prisma arm: a depot list also carries the global (null-depot) defaults.
    if (Array.isArray(scope)) {
      return this.rows.filter((r) => depotOf(r) === null || scope.includes(depotOf(r) as string));
    }
    return this.rows.filter((r) => depotOf(r) === scope);
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
    // CA-2-53: a save says which version it started from.
    const updated = await svc.update(
      hr,
      r.id,
      {
        bonusType: 'PERFORMANCE',
        name: '  Baru  ',
        metric: 'PRESENT_DAYS',
        op: 'LTE',
        threshold: 5,
        rewardKind: 'PERCENT',
        rewardValue: 10,
        active: false,
      },
      r.updatedAt.toISOString(),
    );
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
    await expect(
      svc.update(manager(DEPOT_A), r.id, { threshold: 1 }, r.updatedAt.toISOString()),
    ).resolves.toMatchObject({ threshold: 1 });
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
    // HR sits above depots, so the unfiltered listing is still the whole network.
    expect(await svc.list(hr)).toHaveLength(2);
    expect(await svc.list(hr, DEPOT_A)).toHaveLength(1);
    expect(await svc.list(hr, null)).toHaveLength(1);
  });

  /*
   * CA-1-31. The listing took no caller at all, so `GET /bonus-rules` with no query handed
   * every depot's bonus rules to anyone with `hrView` — which reaches a MANAGER pinned to
   * one depot. These are the rules that mint bonuses onto payslips.
   */
  it('shows a depot-pinned caller their own rules and the global ones, not another depot’s', async () => {
    const { svc } = make();
    await svc.create(hr, { ...valid, depotId: DEPOT_A });
    await svc.create(hr, { ...valid, depotId: DEPOT_B });
    await svc.create(hr, valid); // global

    const seen = await svc.list(manager(DEPOT_A));
    expect(seen).toHaveLength(2);
    const depots = seen.map((r) => (r as unknown as { depotId: string | null }).depotId);
    expect(depots).toContain(DEPOT_A);
    // The global rule pays out at DEPOT_A too, so hiding it would hide half their own answer.
    expect(depots).toContain(null);
    expect(depots).not.toContain(DEPOT_B);
  });

  it('refuses a depot the caller does not run rather than answering it', async () => {
    const { svc } = make();
    await svc.create(hr, { ...valid, depotId: DEPOT_B });
    await expect(svc.list(manager(DEPOT_A), DEPOT_B)).rejects.toBeInstanceOf(ForbiddenException);
  });

  /*
   * CA-2-53. This rule decides who is paid what, and two people editing it used to produce
   * whichever of them saved last, with the other's change gone and nobody told.
   */
  it('refuses a save built on a copy of the rule that is already out of date', async () => {
    const { svc } = make();
    const r = await svc.create(hr, valid);
    await svc.update(hr, r.id, { threshold: 20 }, r.updatedAt.toISOString());

    await expect(
      svc.update(hr, r.id, { threshold: 5 }, r.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
  });

  it('refuses a rule save that says nothing about what it saw', async () => {
    const { svc } = make();
    const r = await svc.create(hr, valid);
    await expect(svc.update(hr, r.id, { threshold: 5 })).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
  });
});
