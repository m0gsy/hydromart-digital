#!/usr/bin/env node
/**
 * Every workflow file parses, and every button a workflow implements is a button you can
 * actually press.
 *
 * Both halves are here because both happened in one commit. A block was inserted into the
 * middle of another input, producing DUPLICATE KEYS — and GitHub's failure mode for an
 * unparseable workflow is quiet in the worst way: the run appears, is marked failed, has
 * ZERO jobs, and the workflow is listed by its path instead of its name. Nothing says
 * "invalid YAML" anywhere a person looks first. Three red deploy runs on main said nothing
 * more specific than "failure".
 *
 * The second half is subtler and would have survived the first: two new `mode` values were
 * implemented in the script body and never added to the `choice` options, so the code was
 * there and the dropdown could not offer it. A button nobody can press is not a feature.
 *
 * Exit 0 = every workflow parses and its choices match its implementation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const DIR = '.github/workflows';
const problems = [];

// Shell `#` comments are stripped everywhere a `run` body is read. The first version of the
// COMPOSE_BAKE check below tested the raw text, and the comment three lines above the fix
// already contained the string it looked for — so it went green on a file with the variable
// deleted. Module-scoped because the release-config rule at the bottom needs it too.
const uncommented = (run) => String(run ?? '').replace(/(^|\s)#[^\n]*/g, ' ');

for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const path = join(DIR, file);
  const text = readFileSync(path, 'utf8');
  let doc;
  try {
    // js-yaml rejects duplicate keys by default, which is the whole point: that is the
    // failure GitHub reports as an unnamed run with no jobs.
    doc = yaml.load(text);
  } catch (error) {
    problems.push(`${path}: does not parse — ${error.message.split('\n')[0]}`);
    continue;
  }
  if (!doc || typeof doc !== 'object') {
    problems.push(`${path}: parses to nothing`);
    continue;
  }
  if (!doc.name) {
    problems.push(`${path}: has no \`name\`, so Actions will list it by its path`);
  }
  // `on:` is the YAML 1.1 boolean `true` once parsed — its absence is what matters.
  if (!('on' in doc) && !(true in doc)) {
    problems.push(`${path}: has no \`on\` trigger`);
  }

  /*
   * Every job declares a time limit.
   *
   * GitHub's default is SIX HOURS. A CI run hung for over two of them on
   * `Install Playwright browser` — a download that normally takes under two minutes — with
   * all 45 preceding steps already green. Nothing failed and nothing alerted; the deploy
   * queue simply stopped. A hung job and a slow job look identical until a limit says which.
   */
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    if (job && typeof job === 'object' && !('timeout-minutes' in job) && !job.uses) {
      problems.push(
        `${path}: job \`${name}\` has no \`timeout-minutes\` — it can hang for six hours`,
      );
    }
  }

  /*
   * M19/M20 — every workflow serialises against itself.
   *
   * `uat.yml` and `load.yml` each boot a whole eighteen-image stack and hold a runner for
   * ninety minutes, and neither had a `concurrency` block: a manual dispatch on top of the
   * scheduled run gave two of them at once. `registry-check.yml` gave two SSH sessions
   * probing the same production box. Nothing reported any of it, because a duplicate run
   * looks exactly like a run.
   */
  if (!('concurrency' in doc)) {
    problems.push(
      `${path}: no \`concurrency\` group — a dispatch on top of a scheduled run gives two of it at once`,
    );
  }

  /*
   * M17b — bake without cache keys is still a cold build.
   *
   * COMPOSE_BAKE only routes the build through buildx. The keys buildx then honours live in
   * docker-compose.cache.yml, which run.mjs layers on ONLY when COMPOSE_EXTRA_FILES names
   * it. Both scheduled stacks set the first and not the second, so each one built all
   * eighteen images from scratch while the cache `integration` had just filled sat unread —
   * and the plan's own note that these two "already set COMPOSE_BAKE" is what made it look
   * done.
   *
   * Read STRUCTURALLY, per step, not by grepping the file. The first version of this check
   * tested the raw text for `COMPOSE_EXTRA_FILES`, which the comment three lines above the
   * fix already contains — so it went green on a file with the variable deleted. Same defect
   * as the one it was written to catch: a gate that cannot go red. `run` bodies are stripped
   * of `#` comments for the same reason.
   */
  const envOf = (...scopes) => Object.assign({}, ...scopes.map((s) => s?.env ?? {}));
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      const env = envOf(doc, job, step);
      const body = uncommented(step?.run);
      if (!('COMPOSE_BAKE' in env) && !/COMPOSE_BAKE=/.test(body)) continue;
      const OVERLAY = 'docker-compose.cache.yml';
      const reached =
        String(env.COMPOSE_EXTRA_FILES ?? '').includes(OVERLAY) || body.includes(OVERLAY);
      if (!reached) {
        problems.push(
          `${path}: job \`${jobName}\` step \`${step.name ?? step.uses ?? '(unnamed)'}\` turns on ` +
            `COMPOSE_BAKE but never reaches ${OVERLAY} — buildx with no cache keys builds cold anyway`,
        );
      }
    }
  }

  /*
   * Every step that reaches OUTSIDE this repo declares its own time limit.
   *
   * A job-level cap is not enough, and the difference is the whole point. When a JOB hits
   * its cap GitHub records the run as `cancelled`, not failed: nothing turns red, and the
   * workflows gated on success — Deploy, Images — simply skip. A Playwright download once
   * stalled for over two hours that way, and a GPG keyserver call for ten minutes more,
   * with the whole release quietly not happening.
   *
   * A STEP cap fails the step, which fails the job, which is red and names itself.
   *
   * The pattern is deliberately broader than `curl`: measured on this repo, the workflows
   * contain exactly one curl to the outside world and it is already capped — reading only
   * for curl says "nothing to fix" over `npm ci`, `docker pull` and `apt-get`, which are
   * the steps that actually hang.
   */
  const EXTERNAL = /curl |wget |apt-get |docker pull|npm ci|gpg |--recv-keys|keyserver/;
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run !== 'string' || !EXTERNAL.test(step.run)) continue;
      if (!('timeout-minutes' in step)) {
        problems.push(
          `${path}: step \`${step.name ?? '(unnamed)'}\` in job \`${jobName}\` reaches outside ` +
            'the repo with no `timeout-minutes` — a stall there cancels the run instead of failing it',
        );
      }
    }
  }
  /*
   * A `choice` input whose options do not match the branches the script implements. Read
   * from the shell `case` labels in the same file: the workflow that dispatches on a mode
   * writes `mode)` for each one it handles, so the two lists are checkable against each
   * other without either being restated here.
   */
  const inputs = doc.on?.workflow_dispatch?.inputs ?? {};
  for (const [name, spec] of Object.entries(inputs)) {
    if (spec?.type !== 'choice' || !Array.isArray(spec.options)) continue;
    const cases = [...text.matchAll(/^\s{10,}([a-z][a-z-]*)\)\s+echo "run=/gm)].map((m) => m[1]);
    if (cases.length === 0) continue; // no case dispatch in this file; nothing to compare
    const offered = new Set(spec.options);
    const implemented = new Set(cases);
    for (const mode of implemented) {
      if (!offered.has(mode)) {
        problems.push(
          `${path}: \`${mode}\` is implemented but is not in \`${name}\` options — nobody can select it`,
        );
      }
    }
    for (const mode of offered) {
      // The default branch (`*)`) covers anything not named, so an option with no case of
      // its own is legitimate — it falls through. Only report the reverse, which is dead UI.
      if (!implemented.has(mode) && !text.includes('*)')) {
        problems.push(`${path}: \`${mode}\` is offered in \`${name}\` but nothing implements it`);
      }
    }
  }
}

/*
 * N2/N7 — two build-time facts that are invisible until a release is already in the wild.
 *
 * N2: every NEXT_PUBLIC_* value is INLINED at build time, so a client error reporter that
 * is not passed to the build does not exist in the artefact, no matter how correct the
 * component is. It was correct, and no image and no APK ever carried it.
 *
 * N7: `run_number` does not move on a Re-run, and a re-run is the ordinary response to a
 * publish that failed after the bundle built — Play then rejects the identical versionCode.
 * Checked here rather than in a comment because the comment used to claim the opposite.
 */
const DSN = 'NEXT_PUBLIC_SENTRY_DSN';
const mobileText = readFileSync(join(DIR, 'mobile.yml'), 'utf8');
const imagesText = readFileSync(join(DIR, 'images.yml'), 'utf8');
const dockerfile = readFileSync(join(DIR, '..', '..', 'apps', 'web', 'Dockerfile'), 'utf8');
const compose = readFileSync(join(DIR, '..', '..', 'docker-compose.prod.yml'), 'utf8');

if (!dockerfile.includes(`ARG ${DSN}`)) {
  problems.push(
    `apps/web/Dockerfile: no \`ARG ${DSN}\` — the web image ships without a client error reporter`,
  );
}
if (!compose.includes(`${DSN}:`)) {
  problems.push(`docker-compose.prod.yml: does not pass ${DSN} to the web build`);
}
if (!imagesText.includes(`${DSN}=`)) {
  problems.push(`${join(DIR, 'images.yml')}: does not pass ${DSN} to the published web image`);
}
/*
 * The other half of N2, and the half that was missing: WHICH JOB (M3b).
 *
 * The checks above assert that the release workflows MENTION the build arg. They do, and the
 * artefacts were still blind: `SENTRY_DSN_WEB` and `SENTRY_DSN_MOBILE` were never created as
 * repository variables, so `${{ vars.* }}` resolved to an empty string and every published
 * image and APK inlined nothing. A mention is not a value, and a check that reads the file
 * cannot see a value that only exists at run time.
 *
 * What it CAN pin is how each job reacts to that value being empty. The rule that used to live
 * here flattened every job of a file together and asked whether SOMETHING refused an empty
 * SENTRY_DSN_MOBILE. Something did — `testable`, which builds a debug APK for a phone on a
 * desk and publishes nothing — while `bundle`, which signs the AAB and hands it to Play, read
 * the same variable with nothing checking it. Job-agnostic, so it stayed green for months
 * while the effect was exactly inverted: no test APK could be built at all, and every released
 * binary shipped blind for the whole life of the binary on every device that installed it.
 *
 * A secret that is REQUIRED in the publishing job and OPTIONAL in the test job is a rule. It
 * could not be written down here, so it was never checked. Now it can be:
 *
 *   refuse   the job must `exit 1` when it is empty — publishing without it is the defect
 *   warn     the job must SAY it is empty and carry on — refusing here costs a test build
 *            for nothing, which is the M3b bug with its sign flipped
 *   report   either will do; whether it blocks is a release decision, not a check's
 *   default  never guarded, because every read supplies an inline `|| 'fallback'`
 */
const RELEASE_CONFIG = [
  // `bundle` is the only job in this repo that produces a SIGNED, uploadable artifact.
  // Everything it reads without an inline fallback has to stop it when empty.
  ['mobile.yml', 'bundle', 'MOBILE_API_URL', 'refuse'],
  ['mobile.yml', 'bundle', 'MOBILE_WEB_HOST', 'refuse'],
  ['mobile.yml', 'bundle', 'SENTRY_DSN_MOBILE', 'refuse'],
  ['mobile.yml', 'bundle', 'GOOGLE_SERVICES_JSON_BASE64', 'refuse'],
  ['mobile.yml', 'bundle', 'ANDROID_KEYSTORE_BASE64', 'refuse'],
  // build.gradle attaches the release signingConfig on `hydromartKeystore.exists()` alone and
  // reads these three through `System.getenv`, which is null for an unset secret — and AGP
  // writes the UNSIGNED result to the same `app-release.aab` path a signed one uses, so the
  // mv, the permission audit, the upload and the whole run stay green. Play says no first.
  ['mobile.yml', 'bundle', 'ANDROID_KEYSTORE_PASSWORD', 'refuse'],
  ['mobile.yml', 'bundle', 'ANDROID_KEY_ALIAS', 'refuse'],
  ['mobile.yml', 'bundle', 'ANDROID_KEY_PASSWORD', 'refuse'],
  ['mobile.yml', 'bundle', 'SENTRY_ENVIRONMENT', 'default'],
  // `testable` hands a debug APK to a person holding a phone. Refusing to build one because a
  // reporting DSN is unset is the inversion above; saying the APK is blind is the whole duty.
  ['mobile.yml', 'testable', 'MOBILE_API_URL', 'refuse'],
  ['mobile.yml', 'testable', 'MOBILE_WEB_HOST', 'default'],
  ['mobile.yml', 'testable', 'SENTRY_DSN_MOBILE', 'warn'],
  ['mobile.yml', 'testable', 'SENTRY_ENVIRONMENT', 'default'],
  // Opt-in on purpose: there is no account to publish to yet and a tag has to stay green
  // without one. It must not be SILENT about it — a run that uploaded nothing looked exactly
  // like a run that published, which is why this is `warn` and not `default`.
  ['mobile.yml', 'publish', 'PLAY_SERVICE_ACCOUNT_JSON', 'warn'],
  // `deploy.yml`'s M11 step refuses to deploy unless the Images run concluded success or
  // skipped, so a hard failure here would stop every deploy rather than one image. Making it
  // blocking is a release decision; `exit 1` satisfies `report` too, so it needs no change here.
  ['images.yml', 'build', 'SENTRY_DSN_WEB', 'report'],
];

/*
 * How one job reacts to `variable` being empty.
 *
 * Steps bind these under an alias — `DSN: ${{ vars.SENTRY_DSN_MOBILE }}` — so the alias is
 * resolved out of the parsed `env` rather than assumed. Keying on the alias name is a rule a
 * rename switches off silently.
 *
 * The reaction is whatever the block opened by the emptiness TEST does before that block
 * closes — not whatever the step does anywhere. Measured 2026-08-29: asking only that a step
 * mention the variable and contain an `exit 1` somewhere meant deleting the DSN refusal
 * outright left every assertion green, because the `env:` line survived and MOBILE_API_URL's
 * `exit 1` two lines above answered for it.
 */
const CLOSES = /^\s*(\}|fi|esac|done)\s*[;&|]*\s*$/;
const testsEmpty = (line, name) => new RegExp(`-[nz]\\s+"?\\$\\{?!?${name}\\b`).test(line);
const ANY_EMPTY_TEST = /-[nz]\s+"?\$/;

const ELSE = /^\s*(\}\s*)?(else|elif\b)/;

/*
 * WHICH WAY the test points, not merely that one exists.
 *
 * Measured 2026-08-30 by mutating mobile.yml in place: changing
 *   `test -n "$DSN" || { echo ...; exit 1; }`
 * to
 *   `test -z "$DSN" || { echo ...; exit 1; }`
 * — a guard that LETS AN EMPTY VALUE THROUGH and rejects a set one — still read as `refuse`
 * and this checker exited 0. Since SENTRY_DSN_MOBILE is empty today, that one character
 * restores the exact defect these rules exist to close, with the gate green.
 *
 * A reaction only answers for emptiness when its branch is the one an EMPTY value takes:
 *   -z ... ; then | -z ... &&   body runs when empty      OK
 *   -n ... ||                   `||` side runs when empty OK
 *   -n ... ; then | -n ... &&   body runs when SET        not a guard
 *   -z ... ||                   `||` side runs when SET   not a guard
 * and `else` hands the rest of the block to the other condition.
 */
function emptyBranch(line, name) {
  const m = new RegExp(`-([nz])\\s+"?\\$\\{?(!?)${name}\\b`).exec(line);
  if (!m) return null;
  const empty = (m[1] === 'z') !== (m[2] === '!');
  const orElse = /\|\|/.test(line.slice(m.index + m[0].length));
  return orElse ? !empty : empty;
}

/*
 * A step that may not run cannot refuse anything, and a step whose failure is swallowed
 * cannot either. Both were invisible: adding `if: false` or `continue-on-error: true` to the
 * guard step left this checker at exit 0 with all eight refusal lines intact and a blind AAB
 * shipping. Fail closed — an `if:` this cannot prove is constant-true counts as no guard,
 * which is the safe direction for a rule about publishing.
 */
function stepIsBinding(step) {
  if (String(step?.['continue-on-error']) === 'true') return false;
  if (step?.if === undefined) return true;
  return /^\s*(true|\$\{\{\s*true\s*\}\})\s*$/.test(String(step.if));
}

function reactionOf(job, variable) {
  const named = new RegExp(`\\b${variable}\\b`);
  let seen = 'none';
  for (const step of job?.steps ?? []) {
    const aliases = Object.entries(step?.env ?? {})
      .filter(([, value]) => named.test(String(value)))
      .map(([key]) => key);
    if (aliases.length === 0) continue;
    if (!stepIsBinding(step)) continue;
    const lines = uncommented(step.run).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const alias = aliases.find((a) => testsEmpty(lines[i], a));
      if (alias === undefined) continue;
      let onEmpty = emptyBranch(lines[i], alias);
      if (onEmpty === null) continue;
      // Only the stretch an EMPTY value actually reaches counts. `else` hands the rest of the
      // block to the other condition, so the flag flips rather than the scan ending.
      let block = onEmpty ? lines[i] : '';
      for (let j = i + 1; j < lines.length; j++) {
        if (ELSE.test(lines[j])) {
          onEmpty = !onEmpty;
          continue;
        }
        // Either the block this test opened has closed, or a test of some OTHER variable has
        // started its own — both end the stretch of shell that answers for this one.
        if (CLOSES.test(lines[j])) break;
        if (ANY_EMPTY_TEST.test(lines[j]) && !aliases.some((a) => testsEmpty(lines[j], a))) break;
        if (onEmpty) block += `\n${lines[j]}`;
      }
      if (/exit\s+1/.test(block)) return 'refuse';
      if (/::warning/.test(block)) seen = 'warn';
    }
  }
  return seen;
}

const WHERE = 'Settings -> Secrets and variables -> Actions';
const releaseDocs = new Map();
for (const [file, jobName, variable, expected] of RELEASE_CONFIG) {
  if (!releaseDocs.has(file)) {
    releaseDocs.set(file, yaml.load(readFileSync(join(DIR, file), 'utf8')));
  }
  const path = join(DIR, file);
  const job = releaseDocs.get(file)?.jobs?.[jobName];
  if (!job) {
    problems.push(`${path}: no job \`${jobName}\` — the rule for ${variable} is checking nothing`);
    continue;
  }
  const got = reactionOf(job, variable);
  const fallback = new RegExp(`(vars|secrets)\\.${variable}\\s*\\|\\|`).test(JSON.stringify(job));
  const say = (want) =>
    problems.push(
      `${path}: job \`${jobName}\` must ${want} an empty ${variable}, and instead does \`${got}\` — ` +
        `create the value under ${WHERE}, or fix the guard inside that job`,
    );
  if (expected === 'refuse' && got !== 'refuse') say('refuse');
  if (expected === 'report' && got === 'none') say('react to');
  if (expected === 'warn' && got !== 'warn') {
    say(got === 'refuse' ? 'only warn about, never refuse,' : 'warn about');
  }
  if (expected === 'default' && !fallback) {
    problems.push(
      `${path}: job \`${jobName}\` reads ${variable} with no guard and no inline ` +
        `\`|| 'fallback'\` — an unset value would reach the build as an empty string`,
    );
  }
}

/*
 * The inverse, so the table cannot go stale by omission: every repository variable and secret
 * `mobile.yml` reads needs a row above. Without this, one more secret added to `bundle` is a
 * silent hole again — which is exactly how SENTRY_DSN_MOBILE got in. Scoped to mobile.yml
 * because that is the release path this repo signs and uploads; measured 2026-08-29, the rows
 * above are every `vars.*`/`secrets.*` in the file, so this reports nothing today and only
 * speaks up for something new.
 */
const ruled = new Set(RELEASE_CONFIG.map(([f, j, v]) => `${f} ${j} ${v}`));
const mobileDoc = releaseDocs.get('mobile.yml') ?? yaml.load(mobileText);
for (const [jobName, job] of Object.entries(mobileDoc?.jobs ?? {})) {
  const used = new Set(
    [...JSON.stringify(job).matchAll(/(?:vars|secrets)\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  );
  for (const variable of used) {
    if (ruled.has(`mobile.yml ${jobName} ${variable}`)) continue;
    problems.push(
      `${join(DIR, 'mobile.yml')}: job \`${jobName}\` reads ${variable}, and RELEASE_CONFIG in ` +
        'scripts/check-workflows.mjs says nothing about it — an unruled secret in the release path',
    );
  }
}

/*
 * And the rule itself has to be able to go red, or it is the defect it was written to catch.
 * The three shapes below are that defect, reduced: a step that declares the variable in `env:`
 * and exits over a DIFFERENT one, a step that only warns, and a step that reads it and says
 * nothing. Measured 2026-08-29, the previous rule read the first as a refusal — which is how
 * M3b survived months of green CI and four green assertions in mobile-release-gate.test.sh.
 */
for (const [shape, run, mustNotBe] of [
  [
    "a bare `env:` line beside somebody else's `exit 1`",
    'test -n "$OTHER" || { echo no; exit 1; }',
    'refuse',
  ],
  ['a step that only warns', 'if [ -z "$X" ]; then echo "::warning::blind"; fi', 'refuse'],
  ['a step that reads it and says nothing', 'echo "$X" > /dev/null', 'warn'],
]) {
  const decoy = { steps: [{ env: { X: '${{ vars.DECOY }}' }, run }] };
  if (reactionOf(decoy, 'DECOY') === mustNotBe) {
    problems.push(
      `scripts/check-workflows.mjs: reactionOf() reads ${shape} as \`${mustNotBe}\` — ` +
        'the release-config rule cannot go red, which is the bug it exists to catch',
    );
  }
}

const exportSteps = (mobileText.match(/npm run build:mobile/g) ?? []).length;
const mobileDsn = (mobileText.match(new RegExp(`${DSN}:`, 'g')) ?? []).length;
if (exportSteps > 0 && mobileDsn === 0) {
  problems.push(
    `${join(DIR, 'mobile.yml')}: exports the binaries without ${DSN} — every shipped APK is blind`,
  );
}
if (!/run_attempt/.test(mobileText)) {
  problems.push(
    `${join(DIR, 'mobile.yml')}: versionCode ignores \`run_attempt\`, so a Re-run rebuilds a code Play has already seen`,
  );
}

/*
 * M18 — one Dockerfile, two cache namespaces.
 *
 * `images.yml` published every image with `scope=<service>` while the CI build overlay
 * (`docker-compose.cache.yml`) writes and reads `scope=hydromart-<service>`. Same context,
 * same Dockerfile, same layers — two disjoint GHA cache keys. The publish could never reuse
 * what `integration` had just warmed, and neither side was wrong on its own, which is exactly
 * why nothing reported it. Compared here rather than restated, so a rename on either side
 * goes red instead of quietly splitting the cache again.
 */
const cacheOverlay = yaml.load(
  readFileSync(join(DIR, '..', '..', 'docker-compose.cache.yml'), 'utf8'),
);
const imagesDoc = yaml.load(imagesText);
const overlayScope = new Map();
for (const [svc, spec] of Object.entries(cacheOverlay?.services ?? {})) {
  for (const entry of spec?.build?.cache_from ?? []) {
    const found = /scope=([^,\s]+)/.exec(String(entry));
    if (found) overlayScope.set(svc, found[1]);
  }
}
const MATRIX_SVC = '${{ matrix.service }}';
for (const key of ['cache-from', 'cache-to']) {
  // `${{ matrix.service }}` contains spaces, so the scope runs to the next comma or newline,
  // not to the next space — `\S+` captured `${{` and nothing else.
  const expr = new RegExp(`${key}:\\s*type=gha,(?:mode=max,)?scope=([^,\\n]+)`)
    .exec(imagesText)?.[1]
    ?.trim();
  if (!expr) {
    problems.push(
      `${join(DIR, 'images.yml')}: no \`${key}\` gha scope — every published build is cold`,
    );
    continue;
  }
  for (const entry of imagesDoc?.jobs?.build?.strategy?.matrix?.include ?? []) {
    const want = overlayScope.get(entry.service);
    // `admin` and `web` are published but not built by the CI test compose, so there is no
    // overlay scope for them to agree with. Nothing to compare is not a failure.
    if (!want) continue;
    const got = expr.replace(MATRIX_SVC, entry.service);
    if (got !== want) {
      problems.push(
        `${join(DIR, 'images.yml')}: \`${key}\` puts \`${entry.service}\` in scope \`${got}\`, ` +
          `docker-compose.cache.yml uses \`${want}\` — the published build cannot reuse the layers CI just built`,
      );
    }
  }
}

/*
 * M4 — every workspace with tests is in exactly one shard.
 *
 * The coverage gate used to be `npm run test:cov` at the root, which walks `--workspaces`
 * and therefore could not miss one. Sharding it across a matrix trades that for a hand-kept
 * list, and a workspace nobody adds to a shard is a workspace whose tests never run again —
 * reported as a green tick, which is the exact failure this file exists to prevent.
 *
 * Read from the filesystem, not restated: a workspace is in scope iff its package.json has
 * a `test:cov` script, which is what the root script keyed off too. Listing one twice is
 * also an error — a duplicate is runner minutes spent proving the same thing while the list
 * looks longer than it is.
 */
const ciDoc = yaml.load(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
const shards = ciDoc?.jobs?.test?.strategy?.matrix?.include ?? [];
if (shards.length === 0) {
  problems.push(
    `${join(DIR, 'ci.yml')}: job \`test\` declares no shards — nothing runs the coverage gate`,
  );
} else {
  const ROOT = join(DIR, '..', '..');
  const expected = new Set();
  for (const group of ['services', 'apps', 'packages']) {
    for (const dir of readdirSync(join(ROOT, group))) {
      const manifest = join(ROOT, group, dir, 'package.json');
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      } catch {
        continue; // not a workspace directory
      }
      if (pkg?.scripts?.['test:cov']) expected.add(pkg.name);
    }
  }
  const listed = [];
  for (const shard of shards)
    listed.push(
      ...String(shard.workspaces ?? '')
        .split(/\s+/)
        .filter(Boolean),
    );
  const seen = new Set();
  for (const name of listed) {
    if (seen.has(name)) {
      problems.push(`${join(DIR, 'ci.yml')}: \`${name}\` is in more than one \`test\` shard`);
    }
    seen.add(name);
    if (!expected.has(name)) {
      problems.push(
        `${join(DIR, 'ci.yml')}: \`${name}\` is sharded but has no \`test:cov\` script`,
      );
    }
  }
  for (const name of expected) {
    if (!seen.has(name)) {
      problems.push(
        `${join(DIR, 'ci.yml')}: \`${name}\` has a \`test:cov\` script but is in no \`test\` shard — its tests never run`,
      );
    }
  }
}

/*
 * A deploy mode whose command never runs its script.
 *
 * deploy.yml builds each mode's command with `echo "run=..."` into GITHUB_OUTPUT, and two of
 * them wrote the AND as an escaped pair instead of a bare `&&`. Inside double quotes bash keeps
 * the backslash, so the box received the escape verbatim and read each `&` as an ARGUMENT to
 * `.` — it sourced load-env.sh, ignored the rest, and exited 0.
 *
 * The SSH step took four seconds, printed nothing, and the run was green. The object backup did
 * nothing, and so had the manual `backup-offsite` button, for as long as it had existed.
 *
 * `seed-demo` on the same page uses a bare `&&` and works, which is what proves the escaping was
 * never needed by anything.
 */
const deployText = readFileSync(join(DIR, 'deploy.yml'), 'utf8');
deployText.split('\n').forEach((line, idx) => {
  if (line.includes('echo "run=') && line.includes('\\&')) {
    problems.push(
      `${join(DIR, 'deploy.yml')}:${idx + 1}: the mode command escapes its && , so the box ` +
        `sources the env file and never runs the script — green, silent, doing nothing: ${line.trim()}`,
    );
  }
});

if (problems.length > 0) {
  console.error('Workflow files that would fail silently:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Workflow check OK — ${readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).length} file(s) parse, ` +
    'are named, and offer every mode they implement.',
);
