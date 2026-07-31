import { BadRequestException } from '@nestjs/common';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';
import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';

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
    await expect(svc.reset('DEPOT', null, 'lateDeductionAmount')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normalises the depot to null for a GLOBAL reset', async () => {
    const { repo, svc } = make();
    await svc.reset('GLOBAL', '11111111-1111-1111-1111-111111111111', 'lateDeductionAmount');
    expect(repo.removed).toEqual({ scope: 'GLOBAL', depotId: null, key: 'lateDeductionAmount' });
  });
});

describe('SettingsService.put guards', () => {
  const key = 'lateToleranceMinutes';

  it('rejects a DEPOT override with no depot and a value under the minimum', async () => {
    const { svc } = make();
    await expect(
      svc.put({ scope: 'DEPOT', depotId: null, key, value: '5', updatedBy: 'u' }),
    ).rejects.toThrow(/depotId required/);
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key, value: '-1', updatedBy: 'u' }),
    ).rejects.toThrow(/below min/);
  });

  // No shipped def is global-only today, but the console reads the same flag to hide the
  // per-depot control — the server has to reject the scope regardless.
  it('rejects a per-depot override of a global-only setting', async () => {
    const def = SETTING_DEF_BY_KEY[key];
    def.global = true;
    try {
      await expect(
        svc0().put({ scope: 'DEPOT', depotId: 'd1', key, value: '5', updatedBy: 'u' }),
      ).rejects.toThrow(/global-only/);
    } finally {
      delete def.global;
    }
  });
});

function svc0(): SettingsService {
  return make().svc;
}
