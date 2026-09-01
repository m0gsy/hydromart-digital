#!/usr/bin/env node
/*
 * No delivery-address form may ask for a province or a postcode again.
 *
 * They were removed from the customer address book and from checkout, and the depot counter
 * kept asking for a province for another day — one screen, missed because the change was
 * traced through types and DTOs rather than through every form that collects an address. The
 * type checker cannot help here: a form field is a string in JSX, and dropping a column the
 * server no longer requires breaks nothing at compile time.
 *
 * A DEPOT has a province and keeps it. So does a franchise application: both describe a
 * physical business location on a map, not a place a courier is driving to tonight. The
 * allowlist below is those screens, each named with why.
 *
 * Displaying one is fine and deliberately not flagged — historical orders still carry the
 * value that was captured with them, and they should keep printing it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src';

/** Screens whose province belongs to a BUSINESS ADDRESS, not a delivery address. */
const ALLOWED = new Map([
  ['apps/web/src/app/waralaba/page.tsx', 'franchise application — the proposed depot location'],
  ['apps/web/src/app/hq/applications/detail/page.tsx', 'reads back a franchise application'],
  ['apps/web/src/app/dashboard/depots/page.tsx', "a depot's own registered address"],
  ['apps/web/src/components/hq/depot-form.tsx', "a depot's own registered address"],
  ['apps/web/src/lib/depots.ts', 'depot form helpers'],
]);

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(p)) files.push(p.replace(/\\/g, '/'));
  }
};
walk(ROOT);

/*
 * An INPUT, not a mention. `id="…province"` and a `province:` key in an object literal are
 * how a form collects one; a comment explaining why it is gone is not, and neither is
 * `{order.province ? … : ''}` on a receipt — nor is forwarding a value already stored on
 * a saved address, which is how a subscription keeps what was captured with it.
 */
const COLLECTS = /id="[a-zA-Z-]*(province|postal)|setAddr(Province|Postal)|\bprovince:\s*(form|addr)[.A-Za-z]/i;

const offenders = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (COLLECTS.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  }
}

if (offenders.length) {
  console.error('A delivery-address form is collecting a province or postcode again:');
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('');
  console.error('If this is a DEPOT or franchise address, add the file to ALLOWED with a reason.');
  process.exit(1);
}

console.log(
  `Address fields OK — ${files.length} file(s) checked, ${ALLOWED.size} business-address ` +
    'screen(s) allowed to keep a province.',
);
