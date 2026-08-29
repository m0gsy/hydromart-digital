import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * One string, declared twice, in two languages, in two deploy units — and until this file
 * existed nothing checked they still matched.
 *
 * checkout writes `deliveryWindow: 'Antar sekarang (express)'` when the customer wants
 * delivery now. order-service's abandoned sweep matches that exact text to tell a request
 * for NOW (sweepable an hour later) from an order booked for a later day (protected for the
 * booking horizon). Change either copy and the sweep silently starts cancelling scheduled
 * orders again — no type error, no failing test, no log line. The defect it was written to
 * fix, reintroduced by an edit that looks like a translation tidy-up.
 *
 * The strings are read out of the source files rather than imported: importing would make
 * them one constant, which is the real fix, and it is not available across a Next.js app
 * and a Nest service that share no runtime package for this. So the duplication stays and
 * this test is what holds it — which is why it reads bytes and asserts they are equal.
 */
const repo = join(__dirname, '..', '..', '..');

function constantIn(relPath: string, name: string): string {
  const src = readFileSync(join(repo, relPath), 'utf8');
  const m = src.match(new RegExp(`const ${name} = '([^']*)'`));
  if (!m) throw new Error(`${name} not found in ${relPath} — was it renamed? Both copies must move together.`);
  return m[1]!;
}

describe('EXPRESS_WINDOW is one value written in two places', () => {
  it('checkout and the sweep agree byte for byte', () => {
    const web = constantIn('apps/web/src/app/checkout/page.tsx', 'EXPRESS_WINDOW');
    const server = constantIn(
      'services/order-service/src/infrastructure/prisma/order.prisma.repository.ts',
      'EXPRESS_WINDOW',
    );
    expect(server).toBe(web);
  });

  it('is a literal, not something a translation can reach', () => {
    // The bug this guards against is not a typo, it is somebody routing the label through
    // t() the way buildDates() already does for "Hari ini"/"Besok" — after which an English
    // browser stores "Deliver now (express)" and the sweep stops recognising express at all.
    const src = readFileSync(join(repo, 'apps/web/src/app/checkout/page.tsx'), 'utf8');
    const decl = src.match(/const EXPRESS_WINDOW = [^;]*;/)?.[0] ?? '';
    expect(decl).not.toMatch(/\bt\(/);
  });
});
