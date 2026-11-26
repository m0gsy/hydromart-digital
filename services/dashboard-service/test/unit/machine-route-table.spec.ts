import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/*
 * AI-31: of every route in the repository that admits a machine token, the money read of the
 * dashboard-service is the ONLY one a token holding just aiReadAgent passes. What a machine needs
 * is its @MachineCan, else (a machine-only route) its @Can, exactly as RolesGuard decides.
 */
const SERVICES = join(__dirname, '../../..');
const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith('.controller.ts')) out.push(p);
  }
  return out;
};

interface Route {
  file: string;
  handler: string;
  needs: string | null;
}

function machineRoutes(): Route[] {
  const routes: Route[] = [];
  for (const svc of readdirSync(SERVICES)) {
    const src = join(SERVICES, svc, 'src');
    if (!svc.endsWith('-service') || !statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/@ExternalAccess\(([^)]*)\)/g)) {
        if (!/'machine'/.test(m[1])) continue;
        const rest = text.slice(m.index!);
        const sig = /\n {2}(?:async )?([A-Za-z0-9_]+)\(/.exec(rest);
        const block = rest.slice(0, sig?.index ?? 0);
        // class-level @ExternalAccess would hide a route from this table: forbid it
        expect(text.slice(0, m.index).split('\n').pop()).toMatch(/^ {2}$|^\s*$/);
        expect(sig).not.toBeNull();
        const can = /@Can\('([A-Za-z]+)'\)/.exec(block)?.[1] ?? null;
        const machineCan = /@MachineCan\('([A-Za-z]+)'\)/.exec(block)?.[1] ?? null;
        const shared = /'ai'/.test(m[1]);
        routes.push({ file: relative(SERVICES, file).split(sep).join('/'), handler: sig![1], needs: machineCan ?? (shared ? null : can) });
      }
    }
  }
  return routes;
}

describe('routes that admit machine tokens', () => {
  const routes = machineRoutes();

  it('are found (the table is not vacuous)', () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it('give a route shared with people a @MachineCan, or no machine gets in', () => {
    for (const r of routes.filter((x) => x.needs === null)) {
      expect(`${r.file}#${r.handler}`).toBe('a route with a @MachineCan'); // fails by name
    }
  });

  it('are refused to a token holding only aiReadAgent, except the dashboard money route', () => {
    const passing = routes.filter((r) => r.needs === 'aiReadAgent').map((r) => `${r.file}#${r.handler}`);
    expect(passing).toEqual(['dashboard-service/src/modules/ai-read.controller.ts#moneyMetric']);
  });
});
