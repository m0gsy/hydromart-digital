import { AuthenticatedUser } from '@hydromart/platform';

import { SettingsController } from '../../src/modules/settings.controller';
import { SettingsService } from '../../src/application/services/settings.service';

/**
 * The forecast model is a setting so it can be changed from the console. That is only true
 * if the write path is actually reachable — and only safe if a GLOBAL write, which moves
 * every depot at once, is refused to anyone without the capability for it.
 */
describe('forecast SettingsController', () => {
  const user = (role: string): AuthenticatedUser =>
    ({ sub: 'u-1', role, phone: '+620000000000' }) as AuthenticatedUser;

  const service = () =>
    ({
      schema: jest.fn().mockResolvedValue({ defs: [], effective: {} }),
      put: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    }) as unknown as SettingsService;

  it('reads the schema for a depot, and for no depot at all', async () => {
    const svc = service();
    const controller = new SettingsController(svc);
    await controller.schema('depot-1');
    await controller.schema();
    expect(svc.schema).toHaveBeenNthCalledWith(1, 'depot-1');
    expect(svc.schema).toHaveBeenNthCalledWith(2, null);
  });

  it('writes a DEPOT override and records who wrote it', async () => {
    const svc = service();
    await new SettingsController(svc).put(
      { scope: 'DEPOT', depotId: 'depot-1', key: 'forecast.demandModel', value: 'moving-average' },
      user('MANAGER'),
    );
    expect(svc.put).toHaveBeenCalledWith({
      scope: 'DEPOT',
      depotId: 'depot-1',
      key: 'forecast.demandModel',
      value: 'moving-average',
      updatedBy: 'u-1',
    });
  });

  it('refuses a GLOBAL write to a role without the capability — that one moves every depot', async () => {
    const svc = service();
    await expect(
      new SettingsController(svc).put(
        { scope: 'GLOBAL', key: 'forecast.demandModel', value: 'moving-average' },
        user('MANAGER'),
      ),
    ).rejects.toThrow();
    expect(svc.put).not.toHaveBeenCalled();
  });

  it('allows a GLOBAL write to a role that holds it', async () => {
    const svc = service();
    await new SettingsController(svc).put(
      { scope: 'GLOBAL', key: 'forecast.churnModel', value: 'recency-only' },
      user('SUPER_ADMIN'),
    );
    expect(svc.put).toHaveBeenCalledWith(expect.objectContaining({ scope: 'GLOBAL', depotId: null }));
  });

  it('resets a DEPOT override back to the parent scope', async () => {
    const svc = service();
    await new SettingsController(svc).reset(
      { scope: 'DEPOT', depotId: 'depot-1', key: 'forecast.demandModel' },
      user('MANAGER'),
    );
    expect(svc.reset).toHaveBeenCalledWith('DEPOT', 'depot-1', 'forecast.demandModel');
  });

  it('applies the same capability check to a GLOBAL reset as to a GLOBAL write', async () => {
    const svc = service();
    await expect(
      new SettingsController(svc).reset({ scope: 'GLOBAL', key: 'forecast.demandModel' }, user('MANAGER')),
    ).rejects.toThrow();
    await new SettingsController(svc).reset(
      { scope: 'GLOBAL', key: 'forecast.demandModel' },
      user('SUPER_ADMIN'),
    );
    expect(svc.reset).toHaveBeenCalledWith('GLOBAL', null, 'forecast.demandModel');
  });
});
