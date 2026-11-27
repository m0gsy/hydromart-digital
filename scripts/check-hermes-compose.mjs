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
 * It is a WHITELIST: every top-level key, every service key and the shape of the network and the volume
 * must be one this file already uses. A key nobody listed (extends, include, configs, secrets, dns,
 * runtime, labels, a host-path anything) is refused, so a new Compose feature cannot slip past a
 * blacklist that never heard of it.
 *
 * The values of HERMES_* keys are checked by name here; the deploy (scripts/hermes-deploy.sh) also refuses
 * a HERMES_TELEGRAM_ALLOWED_USERS that is not numeric Telegram user ids separated by commas
 * (^[0-9]+(,[0-9]+)*$), since a name or a stray character would silently allow the wrong people.
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

// Top level: exactly these keys (`include`, `configs`, `secrets`, ... are refused).
const TOP = ['name', 'x-logging', 'services', 'networks', 'volumes'];
for (const key of Object.keys(doc)) if (!TOP.includes(key)) bad(`sets \`${key}\` at the top level, which is not one of: ${TOP.join(', ')}`);

if (typeof doc.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(doc.name) || doc.name === 'hydromart' || doc.name === 'hydromart-ai') {
  bad(`\`name:\` must pin a project of its own, not "${doc.name}"`);
}
if (JSON.stringify(doc['x-logging']) !== JSON.stringify({ driver: 'json-file', options: { 'max-size': '50m', 'max-file': '3' } })) {
  bad('x-logging must be the repo cap: json-file, max-size 50m, max-file 3');
}

// Values from .env reach this file only as ${HERMES_*}, plus the one optional AI web key below; `$$` is compose's escaped dollar.
const AIWEB_KEY = 'AIWEB_LLM_ANTHROPIC_API_KEY';
for (const m of text.replace(/\$\$/g, '').matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
  if (!m[1].startsWith('HERMES_') && m[1] !== AIWEB_KEY) bad(`reads \${${m[1]}} from .env; only HERMES_* keys may reach Hermes`);
}

// The AI web key may be read once, and only as the optional fallback Anthropic key (checked in the environment below).
const aiwebReads = text.replace(/#[^\n]*/g, '').split(AIWEB_KEY).length - 1;
if (aiwebReads > 1) bad(`${AIWEB_KEY} is read ${aiwebReads} times; it may be read once, as ANTHROPIC_API_KEY_2`);

// Switches that would open it up, anywhere in the file (comments excluded: they explain why they are absent).
const code = text.replace(/#[^\n]*/g, '');
for (const name of ['GATEWAY_ALLOW_ALL_USERS', 'TELEGRAM_ALLOW_ALL_USERS', 'HERMES_YOLO_MODE', 'HERMES_DASHBOARD', 'API_SERVER_ENABLED', 'HERMES_ALLOW_PRIVATE_URLS', 'API_SERVER_KEY']) {
  if (code.includes(name)) bad(`${name} must never be set: it opens Hermes to everyone, or exposes a port, or lets it fetch private addresses`);
}
if (/docker\.sock/.test(code)) bad('docker.sock appears in the file: Hermes never gets the docker socket');

// The network: exactly `hermes: {}` (a plain bridge: no driver, no ipam, no driver_opts, not external, no name).
const networks = doc.networks ?? {};
if (Object.keys(networks).join(',') !== 'hermes') bad(`networks must be exactly \`hermes\`, found: ${Object.keys(networks).join(', ') || 'none'}`);
if (networks.hermes !== undefined && networks.hermes !== null && JSON.stringify(networks.hermes) !== '{}') {
  bad(`networks.hermes must be the plain \`{}\` (a bridge of this project: no driver, ipam, driver_opts, external, name, internal), found ${JSON.stringify(networks.hermes)}`);
}

// The volume: a plain named volume of this project.
const volumes = doc.volumes ?? {};
if (Object.keys(volumes).join(',') !== 'hermes-data') bad(`volumes must be exactly \`hermes-data\`, found: ${Object.keys(volumes).join(', ') || 'none'}`);
if (volumes['hermes-data'] !== undefined && volumes['hermes-data'] !== null && JSON.stringify(volumes['hermes-data']) !== '{}') {
  bad(`volumes.hermes-data must be a plain named volume (no external, driver, driver_opts, name), found ${JSON.stringify(volumes['hermes-data'])}`);
}

const services = Object.entries(doc.services ?? {});
if (services.map(([n]) => n).join(',') !== 'hermes') bad(`exactly one service, \`hermes\`, is allowed; found: ${services.map(([n]) => n).join(', ') || 'none'}`);

const SERVICE_KEYS = ['image', 'command', 'restart', 'logging', 'mem_limit', 'cpus', 'pids_limit', 'cap_drop', 'cap_add', 'security_opt', 'environment', 'volumes', 'networks'];
const ALLOWED_CAPS = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL', 'SETGID', 'SETUID'];
const ALLOWED_ENV = {
  ANTHROPIC_API_KEY: 'HERMES_ANTHROPIC_API_KEY',
  TELEGRAM_BOT_TOKEN: 'HERMES_TELEGRAM_BOT_TOKEN',
  TELEGRAM_ALLOWED_USERS: 'HERMES_TELEGRAM_ALLOWED_USERS',
};
// The pool's optional second Anthropic key: the AI web's subscription-credit key, empty when unset (owner, 27 Nov 2026).
const OPTIONAL_ENV = { ANTHROPIC_API_KEY_2: '${' + AIWEB_KEY + ':-}' };
const required = (value, key) => {
  const v = String(value ?? '');
  return v.startsWith('${' + key + ':?') && v.endsWith('}');
};
for (const [name, svc] of services) {
  const where = `services.${name}`;
  for (const key of Object.keys(svc ?? {})) {
    if (!SERVICE_KEYS.includes(key)) bad(`${where} sets \`${key}\`, which is not one of the keys this file may use (${SERVICE_KEYS.join(', ')})`);
  }
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(String(svc?.image ?? ''))) {
    bad(`${where}.image must be pinned by digest (name@sha256:<64 hex>): a tag is whatever its registry says today`);
  }
  if (JSON.stringify(svc?.command) !== '["gateway","run"]') bad(`${where}.command must be ["gateway", "run"]: the foreground Telegram gateway, nothing else`);
  // Docker never restarts it: at boot that would run it before DOCKER-USER exists. The host starts it (scripts/hermes-ensure.sh).
  if (svc?.restart !== 'no') bad(`${where}.restart must be "no": the host starts it after the firewall (scripts/hermes-ensure.sh)`);
  if (JSON.stringify(svc?.logging) !== JSON.stringify({ driver: 'json-file', options: { 'max-size': '50m', 'max-file': '3' } })) bad(`${where}.logging must be the repo's json-file cap (*logging)`);

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
    for (const key of Object.keys(env)) {
      if (!Object.hasOwn(ALLOWED_ENV, key) && !Object.hasOwn(OPTIONAL_ENV, key)) bad(`${where}.environment sets ${key}: only ${[...Object.keys(ALLOWED_ENV), ...Object.keys(OPTIONAL_ENV)].join(', ')} may be set`);
      else if (!Object.hasOwn(OPTIONAL_ENV, key) && String(env[key]).includes(AIWEB_KEY)) bad(`${where}.environment.${key} reads ${AIWEB_KEY}: that key may only feed ANTHROPIC_API_KEY_2`);
    }
    // Every read of the AI web key must be that one environment value: a read in another field of this service
    // (command, volumes, ...) is as much a leak as one under another key.
    const reads = String(env.ANTHROPIC_API_KEY_2 ?? '').split(AIWEB_KEY).length - 1;
    if (aiwebReads > reads) bad(`${AIWEB_KEY} is read outside ${where}.environment.ANTHROPIC_API_KEY_2: it may only feed that one value`);
    for (const [key, want] of Object.entries(OPTIONAL_ENV)) {
      if (env[key] !== undefined && env[key] !== want) bad(`${where}.environment.${key} must be exactly ${want} (optional, never \`:?\`), got ${env[key]}`);
    }
    for (const [key, from] of Object.entries(ALLOWED_ENV)) {
      if (!required(env[key], from)) bad(`${where}.environment.${key} must be \${${from}:?message}, got ${env[key]}`);
    }
  }

  // Volumes: the one named data volume, nothing of the host.
  const vols = svc?.volumes ?? [];
  if (vols.length !== 1 || String(vols[0]) !== 'hermes-data:/opt/data') bad(`${where}.volumes must be exactly ["hermes-data:/opt/data"]: no bind mount, no docker socket`);

  const joined = Array.isArray(svc?.networks) ? svc.networks : Object.keys(svc?.networks ?? {});
  if (joined.join(',') !== 'hermes') bad(`${where} must join the \`hermes\` network and nothing else, found: ${joined.join(', ') || 'none'}`);
}

if (problems.length > 0) {
  console.error(`${file} breaks Hermes' isolation:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Hermes compose OK: project ${doc.name}, 1 digest-pinned service, no port, no socket, no host mount, own plain network, restart "no", caps ${ALLOWED_CAPS.join('+')}, only HERMES_* from .env plus the optional ${AIWEB_KEY} as ANTHROPIC_API_KEY_2.`);
