import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { REMOTE_DATASETS } from '../../src/infrastructure/http/erasure-executor.registry';

/**
 * G-150: three of six executors answered 404/400 because the registry named a route that
 * the owning controller never declared. Each service is its own repo-local package, so the
 * only place the two sides meet is the path string — pin it against the controller source.
 */
const SERVICE_DIR: Record<string, string> = {
  CRM_SERVICE_URL: 'crm-service',
  DELIVERY_SERVICE_URL: 'delivery-service',
  ORDER_SERVICE_URL: 'order-service',
  LOYALTY_SERVICE_URL: 'loyalty-service',
  DEPOT_SERVICE_URL: 'depot-service',
  ADMIN_SERVICE_URL: 'admin-service',
};

function controllerSources(dir: string): string[] {
  const modules = join(__dirname, '../../../', dir, 'src/modules');
  if (!existsSync(modules)) return [];
  return readdirSync(modules)
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => readFileSync(join(modules, f), 'utf8'));
}

describe('erasure registry paths', () => {
  it.each(REMOTE_DATASETS.map((d) => [d.dataset, d] as const))(
    '%s points at a route its owner declares',
    (_name, d) => {
      const dir = SERVICE_DIR[d.envKey];
      expect(dir).toBeDefined();
      const [, , , prefix, ...rest] = d.path.split('/'); // '', api, v1, <controller>, ...
      const route = rest.join('/');
      const hit = controllerSources(dir).some(
        (src) =>
          src.includes(`path: '${prefix}'`) &&
          src.includes(`@Post('${route}')`),
      );
      expect(hit).toBe(true);
    },
  );
});
