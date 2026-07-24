import { BadRequestException } from '@nestjs/common';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';

class FakeSettingsRepo implements SettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];
  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
    );
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    this.rows = this.rows.filter(
      (r) => !(r.scope === scope && r.depotId === depotId && r.key === key),
    );
  }
}

const depotId = '11111111-1111-1111-1111-111111111111';

function make(): { svc: SettingsService; repo: FakeSettingsRepo } {
  const repo = new FakeSettingsRepo();
  const cache = new SettingsCache(repo);
  return { svc: new SettingsService(repo, cache), repo };
}

describe('SettingsService (SalaryConfiguration)', () => {
  it('schema() returns defs + effective defaults before any override', async () => {
    const { svc } = make();
    const { defs, effective } = await svc.schema(null);
    expect(defs.some((d) => d.key === 'lateDeductionAmount')).toBe(true);
    expect(effective.lateDeductionAmount).toBe(10000);
    expect(effective.workStartTime).toBe('08:00');
  });

  it('applies a DEPOT override over the global default', async () => {
    const { svc } = make();
    await svc.put({ scope: 'DEPOT', depotId, key: 'lateDeductionAmount', value: '15000', updatedBy: 'u1' });
    const { effective } = await svc.schema(depotId);
    expect(effective.lateDeductionAmount).toBe(15000);
    // A different depot still sees the default.
    const other = await svc.schema('22222222-2222-2222-2222-222222222222');
    expect(other.effective.lateDeductionAmount).toBe(10000);
  });

  it('coerces money to an integer and enforces min/max', async () => {
    const { svc, repo } = make();
    await svc.put({ scope: 'GLOBAL', depotId: null, key: 'lateDeductionAmount', value: '12345.9', updatedBy: 'u1' });
    expect(repo.rows[0].value).toBe('12345');
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'lateToleranceMinutes', value: '999', updatedBy: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown keys and a DEPOT scope with no depotId', async () => {
    const { svc } = make();
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'nope', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow(/Unknown setting/);
    await expect(
      svc.put({ scope: 'DEPOT', depotId: null, key: 'lateDeductionAmount', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow(/depotId required/);
  });

  it('reset() removes an override, falling back to the default', async () => {
    const { svc } = make();
    await svc.put({ scope: 'DEPOT', depotId, key: 'standardWorkingMinutes', value: '600', updatedBy: 'u1' });
    expect((await svc.schema(depotId)).effective.standardWorkingMinutes).toBe(600);
    await svc.reset('DEPOT', depotId, 'standardWorkingMinutes');
    expect((await svc.schema(depotId)).effective.standardWorkingMinutes).toBe(480);
  });
});
