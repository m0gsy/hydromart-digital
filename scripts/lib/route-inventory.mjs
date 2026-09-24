/**
 * Every HTTP route the backend declares, read from the controllers' source.
 *
 * Shared by the gates that need to know what routes REALLY exist, so none of them keeps its
 * own idea of it: check-controllers-registered.mjs (is every controller mounted?) and
 * check-alert-routes.mjs (does an alert selector name a route that exists?).
 *
 * A regex pass over the source, on purpose — it runs in CI with no build and no database,
 * and the decorator discipline the repo already enforces is what makes it reliable.
 *
 * A route's public path is `/api/v1/<controller path>/<method path>`: every service sets the
 * `api` global prefix and URI version `1` as default (see each main.ts), which is also what
 * the `route` label of http_request_duration_seconds carries (req.route.path).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.env.HYDROMART_ROOT ?? process.cwd();

/** Comments blanked, offsets preserved, so a doc comment quoting `@Controller(` is not one. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

export function filesUnder(dir, suffix, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesUnder(path, suffix, out);
    else if (path.endsWith(suffix)) out.push(path);
  }
  return out;
}

export function serviceNames(root = ROOT) {
  const base = join(root, 'services');
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((s) => existsSync(join(base, s, 'src')));
}

const join2 = (...parts) => `/${parts.filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/');

/** `[{ service, file, cls, path, routes: [{ method, full }] }]` for every controller class. */
export function controllers(root = ROOT) {
  const out = [];
  for (const service of serviceNames(root)) {
    const src = join(root, 'services', service, 'src');
    for (const file of filesUnder(src, '.controller.ts')) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const part of text.split(/(?=@Controller\()/)) {
        const head = /^@Controller\(([^)]*)\)[\s\S]*?export\s+class\s+(\w+)/.exec(part);
        if (!head) continue;
        const arg = head[1];
        const path = (/path:\s*'([^']*)'/.exec(arg) ?? /^\s*'([^']*)'/.exec(arg))?.[1] ?? '';
        const routes = [];
        for (const m of part.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
          routes.push({
            method: m[1].toUpperCase(),
            full: join2('api', 'v1', path, m[2] ?? ''),
          });
        }
        out.push({ service, file, cls: head[2], path, routes });
      }
    }
  }
  return out;
}

/** Route pattern (`:id` segments) to an anchored RegExp that matches concrete paths. */
export function routePattern(full) {
  return new RegExp(`^${full.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`);
}
