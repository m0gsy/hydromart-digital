import { BadRequestException } from '@nestjs/common';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';

class FakeSettingsRepo implements SettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];
  removed?: { scope: string; depotId: string | null; key: string };
  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    this.removed = { scope, depotId, key };
  }
}

function make() {
  const repo = new FakeSettingsRepo();
  return { repo, svc: new SettingsService(repo, new SettingsCache(repo)) };
}

describe('SettingsService.reset', () => {
  it('rejects a DEPOT reset with no depotId', async () => {
    const { svc } = make();
    await expect(svc.reset('DEPOT', null, 'lateDeductionAmount')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalises the depot to null for a GLOBAL reset', async () => {
    const { repo, svc } = make();
    await svc.reset('GLOBAL', '11111111-1111-1111-1111-111111111111', 'lateDeductionAmount');
    expect(repo.removed).toEqual({ scope: 'GLOBAL', depotId: null, key: 'lateDeductionAmount' });
  });
});
