#!/usr/bin/env node
/**
 * Hermes Agent's compose file keeps to the isolation the owner decided on (27 Nov 2026).
 *
 * infra/hermes/docker-compose.yml runs an all-purpose agent on the production box. What keeps it
 * away from hydromart is a handful of lines, each a one-word edit from undoing it: a `ports:`, the
 * docker socket, a second network, a `${JWT_ACCESS_SECRET}`, a tag instead of a digest, the switch
 * that lets every Telegram user in. This refuses those edits before they merge; the box proves the
 * result after every deploy (scripts/hermes-deploy.sh).
 *
 *   node scripts/check-hermes-compose.mjs [compose file]
 *
 * Exit 0 = every rule holds; 1 = it names each one that does not.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');

const [file = 'infra/hermes/docker-compose.yml'] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const doc = yaml.load(text) ?? {};
const problems = [];
const bad = (message) => problems.push(message);

if (typeof doc.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(doc.name) || doc.name === 'hydromart' || doc.name === 'hydromart-ai') {
  bad(`\`name:\` must pin a project of its own, not "${doc.name}"`);
}

// Values from .env reach this file only as ${HERMES_*}; `$$` is compose's escaped dollar.
for (const m of text.replace(/\$\$/g, '').matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
  if (!m[1].startsWith('HERMES_')) bad(`reads \${${m[1]}} from .env; only HERMES_* keys may reach Hermes`);
}

// Switches that would open it up, anywhere in the file (comments excluded: they explain why they are absent).
const code = text.replace(/#[^\n]*/g, '');
for (const name of ['GATEWAY_ALLOW_ALL_USERS', 'TELEGRAM_ALLOW_ALL_USERS', 'HERMES_YOLO_MODE', 'HERMES_DASHBOARD', 'API_SERVER_ENABLED', 'HERMES_ALLOW_PRIVATE_URLS', 'API_SERVER_KEY']) {
  if (code.includes(name)) bad(`${name} must never be set: it opens Hermes to everyone, or exposes a port, or lets it fetch private addresses`);
}

const networks = doc.networks ?? {};
if (Object.keys(networks).join(',') !== 'hermes') bad(`networks must be exactly \`hermes\`, found: ${Object.keys(networks).join(', ') || 'none'}`);
for (const [key, net] of Object.entries(networks)) {
  if (net?.external === true || net?.external?.name !== undefined || net?.name !== undefined) {
    bad(`networks.${key} must be this project's own: no \`external\`, no \`name\` (that is how another project's network is joined)`);
  }
}

const services = Object.entries(doc.services ?? {});
if (services.map(([n]) => n).join(',') !== 'hermes') bad(`exactly one service, \`hermes\`, is allowed; found: ${services.map(([n]) => n).join(', ') || 'none'}`);

const FORBIDDEN = ['ports', 'expose', 'network_mode', 'pid', 'ipc', 'uts', 'privileged', 'devices', 'userns_mode', 'volumes_from', 'env_file', 'build', 'extra_hosts', 'links', 'external_links', 'sysctls', 'group_add', 'cgroup_parent', 'tmpfs'];
const ALLOWED_CAPS = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL', 'SETGID', 'SETUID'];
const ALLOWED_ENV = {
  ANTHROPIC_API_KEY: 'HERMES_ANTHROPIC_API_KEY',
  TELEGRAM_BOT_TOKEN: 'HERMES_TELEGRAM_BOT_TOKEN',
  TELEGRAM_ALLOWED_USERS: 'HERMES_TELEGRAM_ALLOWED_USERS',
};
const required = (value, key) => {
  const v = String(value ?? '');
  return v.startsWith('${' + key + ':?') && v.endsWith('}');
};
for (const [name, svc] of services) {
  const where = `services.${name}`;
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(String(svc?.image ?? ''))) {
    bad(`${where}.image must be pinned by digest (name@sha256:<64 hex>): a tag is whatever its registry says today`);
  }
  for (const key of FORBIDDEN) if (svc?.[key] !== undefined) bad(`${where} sets \`${key}\`, which reaches past this project's one network or past the pinned image`);
  if (JSON.stringify(svc?.command) !== '["gateway","run"]') bad(`${where}.command must be ["gateway", "run"]: the foreground Telegram gateway, nothing else`);
  if (svc?.restart !== 'unless-stopped') bad(`${where}.restart must be unless-stopped`);
  if (svc?.entrypoint !== undefined) bad(`${where} sets \`entrypoint\`: the image's own init is what drops the privileges`);
  if (svc?.user !== undefined) bad(`${where} sets \`user\`: the image's init starts as root and drops to UID 10000 itself`);

  // Limits: RAM, CPU and processes capped.
  if (typeof svc?.mem_limit !== 'string' || !/^\d+[mg]$/i.test(svc.mem_limit)) bad(`${where}.mem_limit must be set (e.g. 1536m)`);
  if (typeof svc?.cpus !== 'number' || svc.cpus <= 0 || svc.cpus > 2) bad(`${where}.cpus must be set, at most 2`);
  if (!Number.isInteger(svc?.pids_limit) || svc.pids_limit <= 0) bad(`${where}.pids_limit must be set`);

  // Capabilities: all dropped, exactly the ones the image's init uses added back.
  if (JSON.stringify(svc?.cap_drop) !== '["ALL"]') bad(`${where}.cap_drop must be [ALL]`);
  const caps = [...(svc?.cap_add ?? [])].sort();
  if (JSON.stringify(caps) !== JSON.stringify(ALLOWED_CAPS)) bad(`${where}.cap_add must be exactly ${ALLOWED_CAPS.join(', ')}, found: ${caps.join(', ') || 'none'}`);
  if (JSON.stringify(svc?.security_opt) !== '["no-new-privileges:true"]') bad(`${where}.security_opt must be ["no-new-privileges:true"]`);

  // Environment: a map of exactly the three keys, each from its own HERMES_* key, required.
  const env = svc?.environment;
  if (!env || Array.isArray(env)) bad(`${where}.environment must be a map, so each value can be checked`);
  else {
    for (const key of Object.keys(env)) if (!Object.hasOwn(ALLOWED_ENV, key)) bad(`${where}.environment sets ${key}: only ${Object.keys(ALLOWED_ENV).join(', ')} may be set`);
    for (const [key, from] of Object.entries(ALLOWED_ENV)) {
      if (!required(env[key], from)) bad(`${where}.environment.${key} must be \${${from}:?message}, got ${env[key]}`);
    }
  }

  // Volumes: the one named data volume, nothing of the host.
  const volumes = svc?.volumes ?? [];
  if (volumes.length !== 1 || String(volumes[0]) !== 'hermes-data:/opt/data') bad(`${where}.volumes must be exactly ["hermes-data:/opt/data"]: no bind mount, no docker socket`);
  if (!Object.hasOwn(doc.volumes ?? {}, 'hermes-data')) bad('volumes.hermes-data must be declared');
  for (const [key, vol] of Object.entries(doc.volumes ?? {})) {
    if (vol?.external || vol?.driver_opts || vol?.name !== undefined) bad(`volumes.${key} must be a plain named volume of this project`);
  }

  const joined = Array.isArray(svc?.networks) ? svc.networks : Object.keys(svc?.networks ?? {});
  if (joined.join(',') !== 'hermes') bad(`${where} must join the \`hermes\` network and nothing else, found: ${joined.join(', ') || 'none'}`);
}
if (/docker\.sock/.test(code)) bad('docker.sock appears in the file: Hermes never gets the docker socket');

if (problems.length > 0) {
  console.error(`${file} breaks Hermes' isolation:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Hermes compose OK: project ${doc.name}, 1 digest-pinned service, no port, no socket, no host mount, own network, caps ${ALLOWED_CAPS.join('+')}, only HERMES_* from .env.`);
