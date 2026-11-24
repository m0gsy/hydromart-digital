import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLACE_NAME_PATTERN } from '../../src/modules/dto/notification.dto';

/*
 * The place-name allowlist lives in five places that cannot share code (services build apart,
 * the web is a separate app, the contracts are JSON). A copy that drifts silently reopens the
 * phishing vector, so each one is read as text and held to crm's.
 */
const ROOT = join(__dirname, '../../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const tsPattern = (path: string): { source: string; flags: string } => {
  const m = /PLACE_NAME_PATTERN\s*=\s*\/(.+)\/([a-z]*);/.exec(read(path));
  if (!m) throw new Error(`no PLACE_NAME_PATTERN literal in ${path}`);
  return { source: m[1], flags: m[2] };
};

describe('PLACE_NAME_PATTERN twins', () => {
  it('crm itself is unicode-aware', () => {
    expect(PLACE_NAME_PATTERN.flags).toContain('u');
  });

  it.each([
    'services/depot-service/src/modules/dto/franchise-application.dto.ts',
    'apps/web/src/app/waralaba/page.tsx',
  ])('%s carries the same regex', (path) => {
    const twin = tsPattern(path);
    expect(twin.source).toBe(PLACE_NAME_PATTERN.source);
    expect(twin.flags).toContain('u');
  });

  it('the notifications contract carries the same pattern on city and province', () => {
    const schemas = JSON.parse(read('contracts/ai-v1/notifications.openapi.json')).components.schemas;
    const bodies = Object.values(schemas).filter(
      (s) => (s as { properties?: Record<string, unknown> }).properties?.city,
    ) as { properties: Record<'city' | 'province', { pattern?: string }> }[];
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.properties.city.pattern).toBe(PLACE_NAME_PATTERN.source);
      expect(b.properties.province.pattern).toBe(PLACE_NAME_PATTERN.source);
    }
  });

  it('the events contract carries the same pattern on city and province', () => {
    const doc = JSON.parse(read('contracts/ai-v1/events.openapi.json'));
    const found: (string | undefined)[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const k of ['city', 'province']) {
        const p = o[k] as { pattern?: string; type?: string } | undefined;
        if (p && p.type === 'string') found.push(p.pattern);
      }
      Object.values(o).forEach(walk);
    };
    walk(doc);
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const pattern of found) expect(pattern).toBe(PLACE_NAME_PATTERN.source);
  });
});
