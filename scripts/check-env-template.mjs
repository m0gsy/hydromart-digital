#!/usr/bin/env node
/**
 * Every ${VAR} docker-compose.prod.yml reads must appear in .env.production.example.
 *
 * The template is the only list an operator has. A key that reaches compose but never
 * reaches the template is not "undocumented" in the harmless sense — it is a setting whose
 * DEFAULT silently becomes the deployment, and nobody is told a choice was made for them.
 *
 * Found by auditing the live box: comparing its .env against the template showed ten such
 * keys. That method could only ever see keys somebody had already set. Compose referenced
 * EIGHTEEN more that no template mentioned and no box had ever carried — among them four
 * HR payroll defaults that deduct money (HR_LATE_DEDUCTION_IDR=10000), the face-matching
 * thresholds that decide whether an employee's punch is accepted, and NEO_FR_TOKEN, a
 * credential nobody could know to ask for. Each had a plausible default, so each one
 * deployed and worked, which is exactly why no incident ever pointed at them.
 *
 * SCOPE, stated rather than implied: this reads compose only. Keys consumed by scripts
 * (DEMO_PHONE in deploy.sh, DEMO_CUSTOMER_PHONE in smoke.sh) are NOT covered — widening it
 * to every script's env reads is a different, noisier check than the deployment contract.
 *
 * Usage: node scripts/check-env-template.mjs [compose.yml] [template]
 * Exit 0 = every compose variable is documented.
 */
import { readFileSync } from 'node:fs';

const [composePath = 'docker-compose.prod.yml', templatePath = '.env.production.example'] =
  process.argv.slice(2);

/**
 * Set by tooling, never by an operator, so the template deliberately does not offer them
 * as fillable lines. Each entry carries the reason it is not a finding.
 */
const NOT_OPERATOR_SETTABLE = new Map([
  ['VAR', "compose's own header comment, explaining the ${VAR:?msg} form"],
  ['IMAGE_TAG', 'deploy.sh and rollback.sh set it to the commit they ship'],
]);

const refs = new Map(); // NAME -> first compose line it appears on
readFileSync(composePath, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    for (const m of line.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) {
      if (!refs.has(m[1])) refs.set(m[1], i + 1);
    }
  });

// A commented-out setting still documents the key — that is how the template offers
// switches an operator is meant to leave alone (`# IMAGE_PREFIX=...`).
const documented = new Set();
for (const m of readFileSync(templatePath, 'utf8').matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)) {
  documented.add(m[1]);
}

const undocumented = [...refs.keys()]
  .filter((name) => !documented.has(name) && !NOT_OPERATOR_SETTABLE.has(name))
  .sort();

if (undocumented.length > 0) {
  console.error(
    `${undocumented.length} variable(s) in ${composePath} that ${templatePath} never mentions:\n`,
  );
  for (const name of undocumented) console.error(`  ${name}  (${composePath}:${refs.get(name)})`);
  console.error(
    `\nAdd each to ${templatePath} with its default and what changes when it is left blank.` +
      '\nA default nobody was offered is a decision nobody made.',
  );
  process.exit(1);
}

console.log(
  `env template OK — ${refs.size} compose variable(s), ` +
    `${undocumented.length} undocumented, ${NOT_OPERATOR_SETTABLE.size} set by tooling.`,
);
