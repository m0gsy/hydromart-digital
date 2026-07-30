import { startCapabilityRefresh, resetCapabilityRefreshStatus } from './capability-refresh';
import { configureDepotScope, resetDepotScope } from './depot-scope-resolver';
import { rbacHealth } from './rbac-health';

/**
 * The whole point of this block is the UNCONFIGURED case: a service whose bootstrap
 * missed a line keeps answering 200 while serving compiled defaults and one-depot scopes.
 * These assertions are what makes that visible from outside the process.
 */
describe('rbacHealth', () => {
  afterEach(() => {
    resetCapabilityRefreshStatus();
    resetDepotScope();
  });

  it('reports a service whose bootstrap wired neither', () => {
    expect(rbacHealth()).toEqual({
      capabilityMatrix: { overrides: null, ageSeconds: null, stale: false },
      depotScope: { configured: false, cached: 0 },
    });
  });

  it('reports the loaded matrix once a refresh has succeeded', async () => {
    const stop = startCapabilityRefresh(async () => ({ dashboard: ['SUPER_ADMIN'] }));
    await Promise.resolve();
    await Promise.resolve();
    stop();

    const { capabilityMatrix } = rbacHealth();
    expect(capabilityMatrix.overrides).toBe(1);
    expect(capabilityMatrix.stale).toBe(false);
    expect(capabilityMatrix.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  // Stale means "the source is down and we are serving the last snapshot" — not an
  // outage, but the reason a revoked permission might still work for one TTL.
  it('flags a failing source as stale without losing the last snapshot', async () => {
    let fail = false;
    const stop = startCapabilityRefresh(
      async () => {
        if (fail) throw new Error('auth-service down');
        return { dashboard: ['SUPER_ADMIN'] };
      },
      { ttlMs: 1 },
    );
    await new Promise((r) => setTimeout(r, 5));
    fail = true;
    await new Promise((r) => setTimeout(r, 15));
    stop();

    const { capabilityMatrix } = rbacHealth();
    expect(capabilityMatrix.stale).toBe(true);
    expect(capabilityMatrix.overrides).toBe(1);
  });

  it('reports the depot-scope resolver once configured', () => {
    configureDepotScope(async () => []);
    expect(rbacHealth().depotScope).toEqual({ configured: true, cached: 0 });
  });
});
