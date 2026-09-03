import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { INTERNAL_KEY_HEADER } from './internal-auth.guard';
import { LOG_REDACT_PATHS, redactPaths } from './log-redact';

// B-3: every service redacted `authorization` and `cookie` and none redacted
// `x-internal-key` — the shared secret that authenticates as SUPER_ADMIN on every route in
// every service. With `autoLogging: true` that meant every service-to-service call wrote
// the master key in clear text into container logs.
//
// The root cause was not a missing string, it was 18 copies of the same array literal: a
// redaction added in one service could never reach the other 17. So the fix is one exported
// constant, and the drift test below is the part that keeps it fixed — it fails the moment
// service #19 arrives with its own copy-pasted list.

const SERVICES_DIR = join(__dirname, '..', '..', '..', '..', 'services');

function appModules(): { service: string; source: string }[] {
  return readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      service: e.name,
      path: join(SERVICES_DIR, e.name, 'src', 'app.module.ts'),
    }))
    .filter((s) => {
      try {
        readFileSync(s.path);
        return true;
      } catch {
        return false;
      }
    })
    .map((s) => ({ service: s.service, source: readFileSync(s.path, 'utf8') }));
}

describe('LOG_REDACT_PATHS', () => {
  it('redacts the internal service key — it authenticates as SUPER_ADMIN everywhere', () => {
    expect(LOG_REDACT_PATHS).toContain(`req.headers["${INTERNAL_KEY_HEADER}"]`);
  });

  it('keeps redacting the bearer token and session cookie', () => {
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
    expect(LOG_REDACT_PATHS).toContain('req.headers.cookie');
  });

  it('uses bracket syntax for the hyphenated header, which pino needs to match it', () => {
    // `req.headers.x-internal-key` is parsed as a subtraction, not a path — it would
    // silently redact nothing, which is the exact failure mode being fixed.
    const path = LOG_REDACT_PATHS.find((p) => p.includes(INTERNAL_KEY_HEADER));
    expect(path).toBe(`req.headers["${INTERNAL_KEY_HEADER}"]`);
  });

  // gateway-service is the one documented exception: importing the platform barrel would
  // pull the JWT guard and @nestjs/jwt, which it does not declare as a dependency — the
  // same reason it inlines INTERNAL_KEY_HEADER. It carries a mirrored literal instead, so
  // it gets its own assertion below rather than a silent pass.
  const INLINE_BY_DESIGN = ['gateway-service'];

  it('is the single source every other service logs through — no local copies', () => {
    const modules = appModules();
    expect(modules.length).toBeGreaterThanOrEqual(18); // guard against the glob silently matching nothing

    const offenders = modules
      .filter(({ service }) => !INLINE_BY_DESIGN.includes(service))
      .filter(({ source }) => source.includes('redact:'))
      .filter(
        ({ source }) => !source.includes('LOG_REDACT_PATHS') && !source.includes('redactPaths('),
      )
      .map(({ service }) => service);

    expect(offenders).toEqual([]);
  });

  it('leaves no hardcoded authorization literal behind to drift out of sync', () => {
    const offenders = appModules()
      .filter(({ service }) => !INLINE_BY_DESIGN.includes(service))
      .filter(({ source }) => source.includes("'req.headers.authorization'"))
      .map(({ service }) => service);

    expect(offenders).toEqual([]);
  });

  describe('redactPaths', () => {
    it('keeps every shared path when a service adds its own', () => {
      const paths = redactPaths('req.body.refreshToken');
      for (const shared of LOG_REDACT_PATHS) expect(paths).toContain(shared);
      expect(paths).toContain('req.body.refreshToken');
    });

    it('returns the shared list unchanged when nothing extra is passed', () => {
      expect(redactPaths()).toEqual([...LOG_REDACT_PATHS]);
    });

    it('returns a fresh array so a caller cannot mutate the shared list', () => {
      const paths = redactPaths('req.body.code');
      paths.push('mutated');
      expect(LOG_REDACT_PATHS).not.toContain('mutated');
      expect(redactPaths()).not.toContain('mutated');
    });
  });

  it('holds the inlined exception to the same content as the shared list', () => {
    for (const service of INLINE_BY_DESIGN) {
      const mod = appModules().find((m) => m.service === service);
      expect(mod).toBeDefined();
      for (const path of LOG_REDACT_PATHS) {
        // Single-quoted in source, double-quoted inside the bracket path.
        expect(mod!.source).toContain(`'${path.replace(/"/g, '"')}'`);
      }
    }
  });
});
