import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No /hq screen may reach for the depot provider, because /hq does not mount one.
 *
 * HQ is network-scoped: `app/hq/layout.tsx` says so and mounts no `DepotProvider` on purpose.
 * `useDepot()` throws outside one, so an HQ page that calls it does not degrade — it dies on
 * every render, and the root error screen replaces the whole console. `/hq/tickets` shipped
 * exactly that with CA-2-58 and it was live until a user read the message off the screen:
 * "useDepot must be used within <DepotProvider>". Its tests mocked `useDepot`, so they could
 * not see it. This reads the source instead, where a mock cannot hide anything.
 *
 * An HQ screen that needs the depot list reads it network-wide, as six of them already do:
 * `api.getCached(endpoints.depots.manage({ limit: 100 }), true)`.
 */
const HQ = join(process.cwd(), 'src', 'app', 'hq');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('/hq renders without a depot provider', () => {
  it('no /hq file imports the depot context', () => {
    const offenders = walk(HQ).filter((f) =>
      /from\s+['"]@\/lib\/depot-context['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map((f) => f.slice(HQ.length + 1).replace(/\\/g, '/')),
      'These /hq files import @/lib/depot-context, which throws without a DepotProvider — and\n' +
        '/hq mounts none. Read the network depot list instead (endpoints.depots.manage).',
    ).toEqual([]);
  });
});
