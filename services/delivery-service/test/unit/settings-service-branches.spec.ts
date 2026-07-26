import { SettingsCache } from '@hydromart/platform';

import { SettingsService } from '../../src/application/services/settings.service';
import { InMemorySettingsRepository } from '../support/fakes';

/** Gap-fill: the put/reset guard branches the behaviour spec skips. */
describe('SettingsService guard branches', () => {
  function svc(): SettingsService {
    const repo = new InMemorySettingsRepository();
    return new SettingsService(repo, new SettingsCache(repo));
  }

  it('put rejects a DEPOT override without a depotId', async () => {
    await expect(
      svc().put({ scope: 'DEPOT', depotId: null, key: 'shiftLengthHours', value: '6', updatedBy: 'u1' }),
    ).rejects.toThrow('depotId required');
  });

  it('put rejects a value below the registry minimum', async () => {
    await expect(
      svc().put({ scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '0', updatedBy: 'u1' }),
    ).rejects.toThrow('below min');
  });

  it('put stores a DEPOT-scoped override under its depotId', async () => {
    const s = svc();
    await s.put({ scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6', updatedBy: 'u1' });
    const out = await s.schema('d1');
    expect(out.effective.shiftLengthHours).toBe(6);
    const other = await s.schema('d2');
    expect(other.effective.shiftLengthHours).toBe(8); // env default, override is depot-scoped
  });

  it('reset removes a GLOBAL override', async () => {
    const s = svc();
    await s.put({ scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '6', updatedBy: 'u1' });
    await s.reset('GLOBAL', null, 'shiftLengthHours');
    const out = await s.schema(null);
    expect(out.effective.shiftLengthHours).toBe(8);
  });
});
