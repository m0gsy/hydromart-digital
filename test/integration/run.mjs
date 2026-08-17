// Integration-test orchestrator: boot the whole prod artifact, run the flow, tear down.
//   npm run test:integration            (full: up -> migrate -> build/boot -> flow -> down)
//   npm run test:integration -- --keep  (leave the stack up afterwards for debugging)
//   node test/integration/run.mjs --keep --boot-only  (stack only; the Load workflow's boot)
// Requires Docker running. On Windows the docker binary may not be on PATH; this adds it.
import { spawnSync } from 'node:child_process';

const KEEP = process.argv.includes('--keep');
const win = process.platform === 'win32';
if (win) process.env.PATH = `${process.env.PATH};C:\\Program Files\\Docker\\Docker\\resources\\bin`;

// Audit CI-1: CI layers docker-compose.cache.yml on top so the images build against a
// shared buildx cache instead of cold, twice per run. Comma-separated, empty by default —
// a local run is unchanged and never touches a cache backend it cannot reach.
const EXTRA = (process.env.COMPOSE_EXTRA_FILES ?? '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean)
  .flatMap((f) => ['-f', f]);
const COMPOSE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml', ...EXTRA];
const APP = ['auth', 'customer', 'product', 'order', 'payment', 'delivery', 'depot', 'dashboard',
  'loyalty', 'promo', 'referral', 'crm', 'recommendation', 'forecast', 'gateway'];
const ALL = [...APP, 'gateway-stub', 'postgres'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, ...opts });
  return r.status ?? 1;
}
const compose = (args, opts) => run('docker', ['compose', ...args], opts);

function composeConfig() {
  const r = spawnSync('docker', ['compose', ...COMPOSE, 'config', '--format', 'json'],
    { encoding: 'utf8', shell: win });
  if (r.status !== 0) throw new Error('docker compose config failed');
  return JSON.parse(r.stdout);
}

function healthy() {
  // Comma delimiter (no spaces / no shell metachars) so the format survives shell:true on Windows.
  const r = spawnSync('docker', ['compose', ...COMPOSE, 'ps', '-a', '--format', '{{.Service}},{{.Health}},{{.State}}'],
    { encoding: 'utf8', shell: win });
  const map = {};
  for (const line of (r.stdout || '').trim().split('\n').filter(Boolean)) {
    const [svc, health, state] = line.split(',');
    map[svc] = { health, state };
  }
  return map;
}

async function waitHealthy(timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = healthy();
    const crashed = ALL.filter((s) => m[s]?.state === 'exited');
    if (crashed.length) {
      for (const s of crashed) compose([...COMPOSE, 'logs', s, '--tail', '30']);
      throw new Error(`service(s) exited: ${crashed.join(', ')}`);
    }
    const up = ALL.filter((s) => m[s]?.health === 'healthy');
    process.stdout.write(`\rhealthy ${up.length}/${ALL.length} ...`);
    if (up.length === ALL.length) { console.log(' all up'); return; }
    await sleep(5000);
  }
  const m = healthy();
  const bad = ALL.filter((s) => m[s]?.health !== 'healthy');
  for (const s of bad) compose([...COMPOSE, 'logs', s, '--tail', '30']);
  throw new Error(`timed out waiting for: ${bad.join(', ')}`);
}

async function main() {
  if (compose(['up', '-d', 'postgres'])) throw new Error('infra up failed');
  await sleep(8000);
  if (run('npm', ['run', 'db:migrate'])) throw new Error('db:migrate failed');
  // Build in small batches instead of letting compose start all 15 at once.
  //
  // Every image runs a FULL-monorepo `npm ci`, and all of them share one BuildKit cache
  // mount at /root/.npm. Built concurrently that is fifteen cold downloads in the same
  // instant: npm's cacache tmp files collide (EEXIST) and the registry cuts sockets under
  // the burst (ECONNRESET/ETIMEDOUT). Measured on one failing run — seven npm-ci steps of
  // 90-241s overlapping, only one short enough to have hit a warm cache. `sharing=locked`
  // alone did not fix it: it does not serialise across compose's separate build requests.
  //
  // Batched, the first batch populates the cache and the rest hit it warm. Same reasoning
  // as scripts/rebuild-stale.sh, which already batches on the VPS so a build never OOMs it.
  // Read the list from compose rather than from APP above: APP is the health-gate list and
  // was already two services short of what the test stack builds, so hard-coding it here
  // would have quietly left those two building in parallel with everything else.
  const BATCH = Number(process.env.BUILD_BATCH || 3);
  const buildable = Object.entries(composeConfig().services || {})
    .filter(([, v]) => v.build).map(([k]) => k);
  for (let i = 0; i < buildable.length; i += BATCH) {
    const batch = buildable.slice(i, i + BATCH);
    console.log(`building ${batch.join(', ')}`);
    if (compose([...COMPOSE, 'build', ...batch])) throw new Error(`build failed: ${batch.join(', ')}`);
  }
  if (compose([...COMPOSE, 'up', '-d', '--build'])) throw new Error('service boot failed');
  await waitHealthy();
  // The load workflow boots this same stack and then drives it with k6 — booting it a
  // second way is how two "identical" stacks drift apart.
  if (process.argv.includes('--boot-only')) {
    console.log('\nSTACK UP (--boot-only)');
    return;
  }
  if (run('node', ['test/integration/flow.mjs'])) throw new Error('flow assertions failed');
  /*
   * Three harnesses that existed and were run BY HAND, against whatever stack happened to
   * be up. Each one proves a chain no unit test can (guard + service + repository + a real
   * database), and each one was written because a bug lived in exactly that seam — so
   * "somebody ran it in July" was the only thing holding them. They run here, on the stack
   * that is already booted and healthy, and their exit code is this job's exit code.
   */
  // They refuse to run without JWT_ACCESS_SECRET rather than sign a token the stack will
  // reject — correct for a human at a terminal, and the stack this one boots is the one
  // whose secret flow.mjs already defaults to.
  const harnessEnv = {
    ...process.env,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef',
  };
  /*
   * flow.mjs builds every fixture it needs, so this job never seeded anything. The payroll
   * checks are the opposite: they prove a depot cannot read another depot's payroll, which
   * takes TWO depots that already exist — and they refuse to run rather than pretend, which
   * is how "need at least 2 depots seeded; found 0" ended a green-looking run.
   */
  console.log('\n--- scripts/seed.mjs (the harnesses below need a populated depot)');
  if (run('node', ['scripts/seed.mjs'], { env: harnessEnv })) throw new Error('seed failed');
  for (const harness of [
    'scripts/f6-hris-flows.mjs',
    'scripts/f6-approvals.mjs',
    'scripts/payroll-manual-checks.mjs',
  ]) {
    console.log(`\n--- ${harness}`);
    if (run('node', [harness], { env: harnessEnv })) throw new Error(`${harness} assertions failed`);
  }
  console.log('\nINTEGRATION TEST PASSED');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\nINTEGRATION TEST FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { if (!KEEP) compose([...COMPOSE, 'down']); });
