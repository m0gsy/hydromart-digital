// Integration-test orchestrator: boot the whole prod artifact, run the flow, tear down.
//   npm run test:integration            (full: up -> migrate -> build/boot -> flow -> down)
//   npm run test:integration -- --keep  (leave the stack up afterwards for debugging)
// Requires Docker running. On Windows the docker binary may not be on PATH; this adds it.
import { spawnSync } from 'node:child_process';

const KEEP = process.argv.includes('--keep');
const win = process.platform === 'win32';
if (win) process.env.PATH = `${process.env.PATH};C:\\Program Files\\Docker\\Docker\\resources\\bin`;

const COMPOSE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml'];
const APP = ['auth', 'customer', 'product', 'order', 'payment', 'delivery', 'depot', 'dashboard',
  'loyalty', 'promo', 'referral', 'crm', 'recommendation', 'forecast', 'gateway'];
const ALL = [...APP, 'postgres', 'redis'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, ...opts });
  return r.status ?? 1;
}
const compose = (args, opts) => run('docker', ['compose', ...args], opts);

function healthy() {
  const r = spawnSync('docker', ['compose', ...COMPOSE, 'ps', '-a', '--format', '{{.Service}} {{.Health}} {{.State}}'],
    { encoding: 'utf8', shell: win });
  const map = {};
  for (const line of (r.stdout || '').trim().split('\n').filter(Boolean)) {
    const [svc, health, state] = line.split(' ');
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
  if (compose(['up', '-d', 'postgres', 'redis'])) throw new Error('infra up failed');
  await sleep(8000);
  if (run('npm', ['run', 'db:migrate'])) throw new Error('db:migrate failed');
  if (compose([...COMPOSE, 'up', '-d', '--build'])) throw new Error('service boot failed');
  await waitHealthy();
  if (run('node', ['test/integration/flow.mjs'])) throw new Error('flow assertions failed');
  console.log('\nINTEGRATION TEST PASSED');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\nINTEGRATION TEST FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { if (!KEEP) compose([...COMPOSE, 'down']); });
