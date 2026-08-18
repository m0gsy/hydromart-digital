// Boot the whole Hydromart mesh natively (node dist), reusing the prod compose
// environment with container hostnames rewritten to localhost. Docker only runs
// postgres — building 19 images blows the 8 GB Docker VM on this host.
//
//   node stack.mjs migrate   -> prisma migrate deploy for every service
//   node stack.mjs up        -> start all services + web, stream logs to logs/
//   node stack.mjs health    -> poll /api/v1/health for each
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'g:/VsCode/Hydromart';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS = path.join(HERE, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const compose = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'compose.json'), 'utf8'));

// compose service name -> workspace directory
const SVC = {
  auth: 'auth-service', customer: 'customer-service', product: 'product-service',
  order: 'order-service', payment: 'payment-service', delivery: 'delivery-service',
  depot: 'depot-service', dashboard: 'dashboard-service', loyalty: 'loyalty-service',
  promo: 'promo-service', referral: 'referral-service', crm: 'crm-service',
  recommendation: 'recommendation-service', forecast: 'forecast-service',
  payout: 'payout-service', admin: 'admin-service', hr: 'hr-service', gateway: 'gateway-service',
};
const HOSTS = Object.keys(SVC);

/** container hostnames -> localhost (postgres is published on loopback). */
function localise(env) {
  const out = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    let s = String(v ?? '');
    s = s.replace(/@postgres:5432/g, '@localhost:5432');
    for (const h of HOSTS) s = s.replace(new RegExp(`http://${h}:`, 'g'), 'http://localhost:');
    out[k] = s;
  }
  return out;
}

// auth-service: route OTP through the local sink instead of the console channel —
// pino buffers the dev-OTP log line, so the harness could not read codes back.
const OVERRIDES = {
  auth: { OTP_DELIVERY_CHANNEL: 'console', NODE_ENV: 'development' },
};

const envFor = (name) => ({
  ...process.env, ...localise(compose.services[name].environment), NODE_ENV: 'production', ...(OVERRIDES[name] ?? {}),
});

function migrate() {
  for (const [name, dir] of Object.entries(SVC)) {
    const schema = path.join(ROOT, 'services', dir, 'prisma', 'schema.prisma');
    if (!fs.existsSync(schema)) { console.log(`--    ${name} (no prisma schema)`); continue; }
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], {
      cwd: ROOT, env: envFor(name), encoding: 'utf8', shell: true,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    console.log(`${r.status === 0 ? 'OK   ' : 'FAIL '} migrate ${name}${r.status === 0 ? '' : ` :: ${out.split('\n').filter(Boolean).slice(-3).join(' | ')}`}`);
  }
}

function up(only) {
  for (const [name, dir] of Object.entries(SVC)) {
    if (only && !only.includes(name)) continue;
    const entry = path.join(ROOT, 'services', dir, 'dist', 'src', 'main.js');
    if (!fs.existsSync(entry)) { console.log(`SKIP ${name}: ${entry} missing (run npm run build)`); continue; }
    // pino writes through SonicBoom, which buffers when stdout is a plain file —
    // the dev OTP line would sit unflushed for minutes. Pipe instead and writeSync
    // every chunk so the harness can read codes back immediately.
    const log = fs.openSync(path.join(LOGS, `${name}.log`), 'a');
    const c = spawn(process.execPath, [entry], {
      cwd: path.join(ROOT, 'services', dir), env: envFor(name), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const relay = (chunk) => { try { fs.writeSync(log, chunk); } catch { /* log rotated */ } };
    c.stdout.on('data', relay);
    c.stderr.on('data', relay);
    console.log(`started ${name} pid=${c.pid}`);
  }
  if (only) { console.log('supervisor holding pipes for', only.join(',')); setInterval(() => {}, 1 << 30); return; }
  const weblog = fs.openSync(path.join(LOGS, 'web.log'), 'a');
  const webEnv = { ...process.env, ...localise(compose.services.web.environment), PORT: '3000', NODE_ENV: 'production' };
  const w = spawn('npm', ['run', 'start', '-w', '@hydromart/web'], {
    cwd: ROOT, env: webEnv, stdio: ['ignore', weblog, weblog], detached: true, shell: true,
  });
  w.unref();
  console.log(`started web pid=${w.pid}`);
  console.log('supervisor holding service pipes open — leave this process running');
  setInterval(() => {}, 1 << 30); // keep the relays alive
}

async function health() {
  const ports = Object.fromEntries(Object.keys(SVC).map((n) => {
    const e = compose.services[n].environment;
    const key = Object.keys(e).find((k) => k.endsWith('_SERVICE_PORT') || k === 'GATEWAY_PORT');
    return [n, e[key]];
  }));
  const rows = [];
  for (const [n, port] of Object.entries(ports)) {
    let s = 'DOWN';
    try { const r = await fetch(`http://localhost:${port}/api/v1/health`); s = r.ok ? 'UP' : `HTTP ${r.status}`; } catch { /* down */ }
    rows.push(`${s === 'UP' ? 'UP  ' : 'DOWN'} ${n} :${port}${s === 'UP' ? '' : ` (${s})`}`);
  }
  try { const r = await fetch('http://localhost:3000/'); rows.push(`${r.ok ? 'UP  ' : 'DOWN'} web :3000 (HTTP ${r.status})`); }
  catch (e) { rows.push(`DOWN web :3000 (${e.message})`); }
  console.log(rows.join('\n'));
}

const cmd = process.argv[2];
if (cmd === 'migrate') migrate();
else if (cmd === 'up') up(process.argv.slice(3).length ? process.argv.slice(3) : null);
else if (cmd === 'health') await health();
else console.log('usage: node stack.mjs migrate|up|health');
