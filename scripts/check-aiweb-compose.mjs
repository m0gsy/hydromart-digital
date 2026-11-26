#!/usr/bin/env node
/**
 * HD-9: the AI web's compose file keeps to the isolation HD-1 prepared for it.
 *
 * infra/aiweb/docker-compose.yml runs a second app on the production box, beside hydromart and
 * its database. What keeps them apart is a handful of lines in that file, and each one is a
 * one-word edit away from undoing it: a `ports:` that publishes the app past Caddy, a network
 * that joins hydromart's own, a `${JWT_ACCESS_SECRET}` that hands the AI web the key every
 * hydromart service trusts, an image that follows a tag instead of the release a PR chose.
 * The box proves the result after every deploy (the probe in scripts/aiweb-deploy.sh); this
 * refuses the change before it merges.
 *
 * AI-5 adds n8n, whose exceptions are written here once and allowed nowhere else: n8n alone on
 * its own `egress` network (the one with a way off the box), n8n's editor alone published, on
 * the box's loopback, the app alone handed ALERT_WEBHOOK_URL, and n8n and its setup job handed
 * nothing but their database, their key and their own secrets (every n8n setting is its image's).
 * The Caddy site refuses the app's internal routes to the public.
 *
 *   node scripts/check-aiweb-compose.mjs [compose file] [caddy site file]
 *
 * Exit 0 = every rule holds; 1 = it names each one that does not.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');

const [file = 'infra/aiweb/docker-compose.yml', siteFile = 'infra/caddy/sites/aiweb.caddy'] =
  process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const doc = yaml.load(text) ?? {};
const problems = [];
const bad = (message) => problems.push(message);

// Its own project. Same name as hydromart's and every hydromart deploy (`up --remove-orphans`)
// would delete these containers as orphans; and docker-gc reads this name to keep its images.
if (typeof doc.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(doc.name) || doc.name === 'hydromart') {
  bad(`\`name:\` must pin a project of its own, not "${doc.name}"`);
}

// Values from .env reach this file only as ${AIWEB_*}: none of hydromart's keys can be handed
// to a container here, whatever .env holds. `$$` is compose's escaped dollar, not a variable.
// One exception, AI-5: ALERT_WEBHOOK_URL, the channel hydromart's alerts use, where the app posts
// its own alarms; as the app's ALERT_WEBHOOK_URL and nowhere else (below).
for (const m of text.replace(/\$\$/g, '').matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
  if (!m[1].startsWith('AIWEB_') && m[1] !== 'ALERT_WEBHOOK_URL') bad(`reads \${${m[1]}} from .env; only AIWEB_* keys may reach the AI web`);
}

const strings = (value, path) =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`))
    : typeof value === 'string'
      ? [[path.slice(1), value]]
      : [];
for (const [path, value] of strings(doc, '')) {
  if (value.includes('ALERT_WEBHOOK_URL') && path !== 'services.aiweb.environment.ALERT_WEBHOOK_URL') {
    bad(`${path} reads ALERT_WEBHOOK_URL: only services.aiweb.environment.ALERT_WEBHOOK_URL may`);
  }
  // AI-31: the AI web app's own machine account reaches the app alone, and n8n's reaches n8n's setup
  // alone: neither account's id or secret may be handed to the other's container.
  if (value.includes('AIWEB_APP_MACHINE') && !/^services[.]aiweb[.]environment[.]HYDROMART_MACHINE_(ID|SECRET)$/.test(path)) {
    bad(`${path} reads AIWEB_APP_MACHINE_*: only services.aiweb.environment.HYDROMART_MACHINE_ID and _SECRET may`);
  }
  if (value.includes('AIWEB_N8N_MACHINE') && !path.startsWith('services.n8n-setup.environment.')) {
    bad(`${path} reads AIWEB_N8N_MACHINE_*: n8n's machine account goes to services.n8n-setup alone, never to the AI web`);
  }
}

// Networks: `edge` comes from outside (hydromart's Caddy creates it); every other network is
// this project's own and internal, so nothing reaches the database except over `private`. The
// one exception is `egress` (AI-5): n8n's way to hydromart's public API, and only n8n's (below).
const networks = doc.networks ?? {};
for (const [key, net] of Object.entries(networks)) {
  const external = net?.external === true || net?.external?.name !== undefined;
  if (key === 'edge') {
    if (!external || (net.name ?? 'edge') !== 'edge') bad('networks.edge must be `external: true`, the network named edge');
  } else if (external || net?.name !== undefined) {
    bad(`networks.${key} must be this project's own network: no \`external\`, no \`name\` (that is how hydromart's would be joined)`);
  } else if (key === 'egress') {
    if (net?.internal === true) bad("networks.egress must not be internal: it is n8n's way to hydromart's public API");
  } else if (net?.internal !== true) {
    bad(`networks.${key} must be \`internal: true\`: a way off the box from the database's network is a way in too`);
  }
}
if (!networks.edge) bad('no `edge` network: Caddy could not reach the app');
if (!Object.hasOwn(networks, 'egress')) bad("no `egress` network: n8n could not reach hydromart's public API");

const FORBIDDEN = ['ports', 'network_mode', 'pid', 'ipc', 'privileged', 'cap_add', 'devices', 'userns_mode', 'volumes_from', 'env_file', 'build', 'extra_hosts', 'links', 'external_links'];
const dbUser = (svc) => /^postgres(?:ql)?:\/\/([^:@/]+)[:@]/.exec(String(svc?.environment?.DATABASE_URL ?? ''))?.[1];
const onEdge = [];
const onEgress = [];
const joinedBy = {};
const services = Object.entries(doc.services ?? {});
if (services.length === 0) bad('no services');
for (const [name, svc] of services) {
  const where = `services.${name}`;
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(String(svc?.image ?? ''))) {
    bad(`${where}.image must be pinned by digest (name@sha256:<64 hex>): a tag is whatever its registry says today`);
  }
  for (const key of FORBIDDEN) {
    if (key === 'ports' && name === 'n8n') continue; // its editor, held to one exact port below
    if (svc?.[key] !== undefined) bad(`${where} sets \`${key}\`, which reaches past this project's two networks or past the pinned image`);
  }
  if (Array.isArray(svc?.environment)) bad(`${where}.environment must be a map, so each value can be checked`);
  // Named volumes only: a bind mount hands the container a piece of the host (docker.sock, .env).
  for (const volume of svc?.volumes ?? []) {
    const source = typeof volume === 'string' ? volume.split(':')[0] : volume?.source;
    const type = typeof volume === 'string' ? 'volume' : volume?.type;
    if (type !== 'volume' || !Object.hasOwn(doc.volumes ?? {}, source)) {
      bad(`${where} mounts "${source}": only this file's named volumes may be mounted`);
    }
  }
  // Listed explicitly: a service with no `networks:` lands on the project's default network,
  // which is not internal.
  const joined = Array.isArray(svc?.networks) ? svc.networks : Object.keys(svc?.networks ?? {});
  if (joined.length === 0) bad(`${where} lists no networks, so compose would put it on a default one that is not internal`);
  for (const net of joined) {
    if (!Object.hasOwn(networks, net)) bad(`${where} joins "${net}", which this file does not declare`);
  }
  if (joined.includes('edge')) onEdge.push(name);
  if (joined.includes('egress')) onEgress.push(name);
  joinedBy[name] = joined;
}

// AI-5: n8n and its one-shot setup, which run one image. The image owns every n8n setting (its
// hardening), so this file hands them their database and key, the editor's address and the setup
// secrets, nothing else; and where they connect, as whom, with which .env key, is pinned. The
// values of AIWEB_* keys are checked by name: compose's ${KEY} or ${KEY:?message} / ${KEY:-}.
const fromEnv = (value, key) => {
  const v = String(value ?? '');
  return v === '${' + key + '}' || (v.startsWith('${' + key + ':') && v.endsWith('}'));
};
const N8N_DB = {
  DB_TYPE: 'postgresdb',
  DB_POSTGRESDB_HOST: 'db',
  DB_POSTGRESDB_PORT: '5432',
  DB_POSTGRESDB_DATABASE: 'n8n',
  DB_POSTGRESDB_USER: 'n8n',
  DB_POSTGRESDB_PASSWORD: { from: 'AIWEB_N8N_DB_PASSWORD' },
  N8N_ENCRYPTION_KEY: { from: 'AIWEB_N8N_ENCRYPTION_KEY' },
};
const N8N_ENV = {
  n8n: { ...N8N_DB, N8N_EDITOR_BASE_URL: 'http://localhost:5678' },
  'n8n-setup': {
    ...N8N_DB,
    N8N_SETUP_AIWEB_TOKEN: { from: 'AIWEB_N8N_TOKEN' },
    N8N_SETUP_MACHINE_ACCOUNT_ID: { from: 'AIWEB_N8N_MACHINE_ID' },
    N8N_SETUP_MACHINE_SECRET: { from: 'AIWEB_N8N_MACHINE_SECRET' },
  },
};
// ~/.n8n in memory and n8n's user's alone: n8n writes its settings file there, the key in it.
const keyInMemory = (svc) =>
  [svc?.tmpfs ?? []].flat().some((t) => {
    const [path, options = ''] = String(t).split(/:(.*)/s);
    const o = new Set(options.split(','));
    return /^\/home\/node\/\.n8n$/.test(path) && o.has('uid=1000') && o.has('gid=1000') && (o.has('mode=0700') || o.has('mode=700'));
  });
for (const [name, want] of Object.entries(N8N_ENV)) {
  const svc = doc.services?.[name];
  const where = `services.${name}`;
  if (!svc) {
    bad(`no ${name} service: n8n runs beside the app (AI-5)`);
    continue;
  }
  const env = svc.environment && !Array.isArray(svc.environment) ? svc.environment : {};
  for (const key of Object.keys(env)) {
    if (!Object.hasOwn(want, key)) bad(`${where}.environment sets ${key}: n8n's settings are its image's; this file gives it only ${Object.keys(want).join(', ')}`);
  }
  for (const [key, value] of Object.entries(want)) {
    const ok = typeof value === 'string' ? String(env[key]) === value : fromEnv(env[key], value.from);
    if (!ok) bad(`${where}.environment.${key} must be ${typeof value === 'string' ? value : '${' + value.from + '}'}, got ${env[key]}`);
  }
  if (!keyInMemory(svc)) bad(`${where} must mount /home/node/.n8n as a tmpfs with uid=1000,gid=1000,mode=0700: n8n writes its encryption key there`);
  if (svc.volumes !== undefined) bad(`${where} mounts volumes: nothing of n8n is kept outside its database`);
}
const n8n = doc.services?.n8n;
const setup = doc.services?.['n8n-setup'];
if (n8n) {
  if ([...(joinedBy.n8n ?? [])].sort().join(',') !== 'egress,private') bad('services.n8n must join private and egress, and nothing else');
  if (JSON.stringify(n8n.ports) !== '["127.0.0.1:5678:5678"]') {
    bad(`services.n8n may publish one port, its editor on the box's loopback ("127.0.0.1:5678:5678"), not ${JSON.stringify(n8n.ports)}`);
  }
}
if (setup) {
  if ((joinedBy['n8n-setup'] ?? []).join(',') !== 'private') bad('services.n8n-setup must join private, and nothing else');
  if (n8n && setup.image !== n8n.image) bad('services.n8n-setup must run the image n8n runs: one release, set up by its own copy of git');
  if (JSON.stringify(setup.profiles) !== '["n8n-setup"]') bad('services.n8n-setup must sit behind its own profile, so `up` never starts it');
}
// AI-31: the app's own machine account (a blank value is its kill switch, so ${KEY:-} is the form).
const appEnv = doc.services?.aiweb?.environment ?? {};
for (const [key, from] of [['HYDROMART_MACHINE_ID', 'AIWEB_APP_MACHINE_ID'], ['HYDROMART_MACHINE_SECRET', 'AIWEB_APP_MACHINE_SECRET']]) {
  if (!fromEnv(appEnv[key], from)) bad(`services.aiweb.environment.${key} must be \${${from}:-}, got ${appEnv[key]}`);
}
if (onEgress.join(',') !== 'n8n') bad(`only n8n may join egress, the one network with a way off the box, found: ${onEgress.join(', ') || 'none'}`);

// One service faces Caddy, and it connects as a role of its own: never the role the migration
// job uses (the owner) and never the superuser, either of which gets past row level security.
const [front] = onEdge;
if (onEdge.length !== 1) bad(`exactly one service may join edge (Caddy's side), found: ${onEdge.join(', ') || 'none'}`);
if (front) {
  const svc = doc.services[front];
  const user = dbUser(svc);
  const others = services.filter(([n]) => n !== front).map(([, s]) => dbUser(s)).filter(Boolean);
  if (!user) bad(`services.${front} has no DATABASE_URL user to check`);
  else if (user === 'postgres' || others.includes(user)) {
    bad(`services.${front} connects as ${user}, a role another service (the migration job, the owner) or the superuser uses`);
  }

  // The Caddy site serves the host the app believes is its own (AI_WEB_URL), and proxies to it.
  let origin;
  try {
    origin = new URL(String(svc.environment?.AI_WEB_URL ?? ''));
  } catch {
    bad(`services.${front}.environment.AI_WEB_URL is not a URL`);
  }
  if (origin && (origin.protocol !== 'https:' || origin.origin !== svc.environment.AI_WEB_URL)) {
    bad(`services.${front}.environment.AI_WEB_URL must be an https origin and nothing more, got ${svc.environment.AI_WEB_URL}`);
  }
  const site = readFileSync(siteFile, 'utf8').replace(/#[^\n]*/g, '');
  const host = /^\s*([^\s{]+)\s*\{/m.exec(site)?.[1];
  if (origin && host !== origin.host) bad(`${siteFile} serves ${host}, the app's AI_WEB_URL says ${origin.host}`);
  if (!new RegExp(`reverse_proxy\\s+${front}:3000\\b`).test(site)) bad(`${siteFile} must reverse_proxy ${front}:3000`);
  if (!/import\s+hsts\b/.test(site)) bad(`${siteFile} must \`import hsts\``);
  // AI-5: n8n reports failures to the app's /api/internal/n8n/* over the private network; from
  // the public those routes do not exist, refused before the proxy like hydromart's /metrics.
  // Both the folder and the bare path: `/api/internal/*` does not match `/api/internal` itself.
  const flat = site.replace(/\s+/g, ' ');
  if (!flat.includes('handle /api/internal/* { respond 404 }') || !flat.includes('handle /api/internal { respond 404 }')) {
    bad(`${siteFile} must refuse /api/internal/* to the public (handle /api/internal/* { respond 404 } and handle /api/internal { respond 404 })`);
  }
}

if (problems.length > 0) {
  console.error(`${file} breaks the AI web's isolation:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `AI web compose OK: project ${doc.name}, ${services.length} digest-pinned services, ` +
    `${front} alone on edge, n8n alone on egress, no host port but n8n's editor on 127.0.0.1, ` +
    'only AIWEB_* from .env (and ALERT_WEBHOOK_URL for the app).',
);
