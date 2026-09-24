#!/usr/bin/env node
/**
 * Every controller class must be mounted by a module.
 *
 *   node scripts/check-controllers-registered.mjs
 *
 * A controller Nest never hears about is not an error anywhere: it compiles, its own unit
 * tests pass (they build the class by hand), lint sees nothing wrong, and the route simply
 * does not exist. `SelfLoanRequestController` and `LoanRequestController` were exactly that
 * from the day the kasbon feature merged (#523) — the employee screen answered
 * `Cannot GET /api/v1/loan-requests/me` in production, and the only thing that noticed was
 * a person opening it.
 *
 * A controller passes if its class name is used in a `*.module.ts` of the same service.
 * Import statements are blanked first: an imported-but-never-listed controller is the exact
 * shape of this defect, and an import alone must not satisfy the check.
 *
 * Exit 0 = every controller is mounted; 1 = at least one is not.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ROOT, controllers, filesUnder, stripComments } from './lib/route-inventory.mjs';

const all = controllers();
const moduleText = new Map();
const textOf = (service) => {
  if (!moduleText.has(service)) {
    moduleText.set(
      service,
      filesUnder(join(ROOT, 'services', service, 'src'), '.module.ts')
        .map((f) => stripComments(readFileSync(f, 'utf8')).replace(/^import[^;]*;/gm, ''))
        .join('\n'),
    );
  }
  return moduleText.get(service);
};

const unregistered = all
  .filter((c) => !new RegExp(`\\b${c.cls}\\b`).test(textOf(c.service)))
  .map((c) => `${c.service}: ${c.cls} (${relative(ROOT, c.file).replaceAll('\\', '/')})`);

if (unregistered.length > 0) {
  console.error(`${unregistered.length} controller(s) are declared but no module mounts them:\n`);
  for (const u of unregistered) console.error(`  ${u}`);
  console.error('\nAdd each to the `controllers: [...]` of its module, or delete it.');
  process.exit(1);
}
console.log(`check-controllers-registered: all ${all.length} controllers are mounted`);
