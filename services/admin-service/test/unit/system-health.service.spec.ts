import { SystemHealthService } from '../../src/application/services/system-health.service';
import { FakeHealthProbe, buildTestConfig } from '../support/fakes';

describe('SystemHealthService', () => {
  it('probes every configured service and rolls up up/down counts', async () => {
    const probe = new FakeHealthProbe();
    // order-service is down; auth-service defaults to up.
    probe.results.set('http://order:3004', { status: 'down', latencyMs: 3000, httpStatus: null });
    const service = new SystemHealthService(buildTestConfig(), probe);

    const result = await service.check();

    // buildTestConfig configures exactly auth + order URLs.
    expect(probe.probed.sort()).toEqual(['http://auth:3001', 'http://order:3004']);
    expect(result.total).toBe(2);
    expect(result.upCount).toBe(1);
    const auth = result.services.find((s) => s.name === 'auth-service');
    const order = result.services.find((s) => s.name === 'order-service');
    expect(auth?.status).toBe('up');
    expect(order).toMatchObject({ status: 'down', httpStatus: null });
    expect(typeof result.checkedAt).toBe('string');
  });

  it('never throws when a probe reports an unreachable service', async () => {
    const probe = new FakeHealthProbe();
    probe.results.set('http://auth:3001', { status: 'down', latencyMs: 3000, httpStatus: null });
    probe.results.set('http://order:3004', { status: 'down', latencyMs: 3000, httpStatus: null });
    const service = new SystemHealthService(buildTestConfig(), probe);

    const result = await service.check();
    expect(result.upCount).toBe(0);
    expect(result.services.every((s) => s.status === 'down')).toBe(true);
  });
});
