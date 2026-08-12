#!/usr/bin/env node
// E0 — refuse a bare `env(safe-area-inset-*)` in a Tailwind arbitrary value.
//
//   node scripts/check-safe-area.mjs
//
// Why this is a gate and not a convention: `env(safe-area-inset-*)` resolves to 0 on an
// Android WebView older than 140, and most of the fleet this ships to is older than that.
// So the bare form is not "slightly wrong" — it silently evaluates to no inset at all, on
// exactly the devices the inset exists for, and it looks completely correct in every
// desktop browser anybody would check it in. Eight places had drifted back to it.
//
// The Capacitor plugin always injects `--safe-area-inset-*` (SystemBars.java), so the
// correct form is `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))` — custom
// property first, `env()` as the fallback for a real browser.
//
// Prose is exempt: a comment explaining the rule has to be able to name the thing.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files "apps/web/src/**/*.tsx" "apps/web/src/**/*.css"', {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

/** `something-[ … env(safe-area-inset-x) … ]` — an arbitrary value, not a sentence. */
const ARBITRARY = /[a-z]+-\[[^\]]*env\(safe-area-inset-(?:top|bottom|left|right)\)[^\]]*\]/g;

const offenders = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const match of line.match(ARBITRARY) ?? []) {
      // Correct already: every env() in this value is guarded by a custom property.
      const bare = match.replace(/var\(--safe-area-inset-[a-z]+,\s*env\(safe-area-inset-[a-z]+\)\)/g, '');
      if (/env\(safe-area-inset-/.test(bare)) {
        offenders.push(`${file}:${i + 1}  ${match.trim().slice(0, 100)}`);
      }
    }
  });
}

if (offenders.length) {
  console.error(`!! ${offenders.length} bare env(safe-area-inset-*) value(s):`);
  for (const o of offenders) console.error(`   ${o}`);
  console.error('');
  console.error('   Write it as var(--safe-area-inset-<side>, env(safe-area-inset-<side>)).');
  console.error('   Bare env() is 0 on a WebView older than 140 — the inset silently vanishes');
  console.error('   on the phones it exists for, while looking right on every desktop.');
  process.exit(1);
}
console.log(`safe-area: ${files.length} files, no bare env(safe-area-inset-*)`);
