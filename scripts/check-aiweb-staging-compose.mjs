#!/usr/bin/env node
/**
 * D3 staging: the staging AI web's compose file keeps to the isolation it was designed with.
 *
 * infra/aiweb-staging/docker-compose.yml runs a copy of the AI web on the production box. What
 * keeps it from production is a handful of lines, each one edit away from undoing it: a network
 * that is `edge` (a container there could take production's traffic), a private network that is
 * not internal (a way off the box), a `${AIWEB_...}` or `${JWT_ACCESS_SECRET}` that hands staging
 * a production secret, a bind mount of the host, a published port, a tag instead of a digest. The
 * box proves the result after every deploy (the probe in scripts/aiweb-staging-deploy.sh); this
 * refuses the change before it merges. The companion of scripts/check-aiweb-compose.mjs.
 *
 *   node scripts/check-aiweb-staging-compose.mjs [compose file] [caddy site file]
 *
 * Exit 0 = every rule holds; 1 = it names each one that does not.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');

const [file = 'infra/aiweb-staging/docker-compose.yml', siteFile = 'infra/caddy/sites/staging-ai.caddy'] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const doc = yaml.load(text) ?? {};
const problems = [];
const bad = (message) => problems.push(message);

const PROD_PROJECTS = ['hydromart', 'hydromart-ai'];
if (doc.name !== 'hydromart-ai-staging') bad(`name must be hydromart-ai-staging (it is ${JSON.stringify(doc.name)}): the firewall, docker-gc and the probe read it`);
if (PROD_PROJECTS.includes(doc.name)) bad(`name ${doc.name} is a production project`);

// Networks: exactly three, none of them `edge`.
const networks = doc.networks ?? {};
if (Object.hasOwn(networks, 'edge')) bad('networks.edge: staging must never join `edge` (a container there could take production\'s traffic and open its port)');
for (const key of Object.keys(networks)) {
  if (!['edge-staging', 'private', 'tunnel'].includes(key)) bad(`networks.${key}: only edge-staging, private and tunnel are allowed`);
}
const es = networks['edge-staging'];
if (es?.external !== true || (es.name ?? 'edge-staging') !== 'edge-staging') bad('networks.edge-staging must be `external: true`, the network named edge-staging (hydromart\'s compose file makes it, internal)');
if (networks.private?.internal !== true || networks.private?.external || networks.private?.name !== undefined) bad('networks.private must be this project\'s own `internal: true` network');
if (!Object.hasOwn(networks, 'tunnel') || networks.tunnel?.internal === true || networks.tunnel?.external) bad('networks.tunnel must be this project\'s own network with a way out (only n8n\'s editor port needs it)');

// Interpolation: only STAGING_* keys reach this file.
const bare = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
for (const m of bare.matchAll(/\$\{([A-Za-z0-9_]+)/g)) {
  if (!m[1].startsWith('STAGING_')) bad(`\${${m[1]}} is interpolated: only STAGING_* keys of .env may reach this project (no production secret, no ALERT_WEBHOOK_URL)`);
}
// No production host: the one hydromart-digital.com name here is the staging site's.
for (const m of bare.matchAll(/[a-z0-9.-]*hydromart-digital\.com/g)) {
  if (m[0] !== 'staging-ai.hydromart-digital.com') bad(`${m[0]} appears: staging may name only staging-ai.hydromart-digital.com`);
}

const FORBIDDEN = ['network_mode', 'pid', 'ipc', 'privileged', 'cap_add', 'devices', 'userns_mode', 'volumes_from', 'env_file', 'build', 'extra_hosts', 'links', 'external_links'];
const ALLOWED_BINDS = {
  'hydromart-mock': ['./mock:/mock:ro'],
  n8n: ['./n8n-rewrite.mjs:/staging/n8n-rewrite.mjs:ro'],
  'n8n-setup': ['./n8n-rewrite.mjs:/staging/n8n-rewrite.mjs:ro'],
};
const NETS = {
  db: ['private'],
  migrate: ['private'],
  'n8n-setup': ['private'],
  'staging-aiweb': ['edge-staging', 'private'],
  'hydromart-mock': ['edge-staging', 'private'],
  n8n: ['private', 'tunnel'],
};
const LONG = ['db', 'staging-aiweb', 'hydromart-mock', 'n8n'];
const services = doc.services ?? {};
for (const name of Object.keys(NETS)) if (!services[name]) bad(`services.${name} is missing`);
let memory = 0;
for (const [name, svc] of Object.entries(services)) {
  const where = `services.${name}`;
  if (!NETS[name]) bad(`${where}: not a service staging has`);
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(String(svc?.image ?? ''))) bad(`${where}.image must be pinned by digest`);
  for (const key of FORBIDDEN) if (svc?.[key] !== undefined) bad(`${where} sets \`${key}\``);
  if (Array.isArray(svc?.environment)) bad(`${where}.environment must be a map`);
  if (name === 'n8n') {
    if (JSON.stringify(svc?.ports) !== JSON.stringify(['127.0.0.1:5679:5678'])) bad('services.n8n.ports must be exactly ["127.0.0.1:5679:5678"]: the editor on the box\'s loopback');
  } else if (svc?.ports !== undefined) bad(`${where} publishes a port: only n8n's editor may, on 127.0.0.1`);
  for (const volume of svc?.volumes ?? []) {
    const named = typeof volume === 'string' && !volume.startsWith('.') && !volume.startsWith('/') && Object.hasOwn(doc.volumes ?? {}, volume.split(':')[0]);
    if (!named && !(ALLOWED_BINDS[name] ?? []).includes(volume)) bad(`${where} mounts "${volume}": only a named volume of this file, or the one read-only file staging needs`);
  }
  const joined = Array.isArray(svc?.networks) ? svc.networks : Object.keys(svc?.networks ?? {});
  if ([...joined].sort().join() !== [...(NETS[name] ?? [])].sort().join()) bad(`${where} joins [${joined}], it must join exactly [${NETS[name]}]`);
  if (name === 'staging-aiweb') {
    const alias = svc?.networks?.private?.aliases;
    if (JSON.stringify(alias) !== JSON.stringify(['aiweb']) || svc?.networks?.['edge-staging']?.aliases) {
      bad('services.staging-aiweb: the alias `aiweb` belongs on `private` only (on edge-staging it could be taken for production\'s upstream)');
    }
  }
  if (name !== 'db') {
    if (JSON.stringify(svc?.cap_drop) !== '["ALL"]') bad(`${where}.cap_drop must be [ALL]`);
    if (!(svc?.security_opt ?? []).includes('no-new-privileges:true')) bad(`${where}.security_opt must hold no-new-privileges:true`);
  }
  const mem = /^(\d+)([mg])$/.exec(String(svc?.mem_limit ?? ''));
  if (!mem) bad(`${where}.mem_limit is missing: staging has a memory budget`);
  if (!(Number(svc?.cpus) > 0)) bad(`${where}.cpus is missing`);
  if (LONG.includes(name)) {
    if (svc?.restart !== 'unless-stopped') bad(`${where}.restart must be unless-stopped`);
    if (mem) memory += Number(mem[1]) * (mem[2] === 'g' ? 1024 : 1);
  } else if (!svc?.profiles?.length) bad(`${where} must sit behind a profile: it is a one-shot job`);
}
if (memory > 1536) bad(`the long-running services' mem_limit adds up to ${memory}m: the budget is 1536m`);

// Who connects as whom, and what the sign-in points at.
const env = (n) => services[n]?.environment ?? {};
const user = (url) => /^postgres(?:ql)?:\/\/([^:@/]+)[:@]/.exec(String(url ?? ''))?.[1];
if (user(env('staging-aiweb').DATABASE_URL) !== 'ai_app') bad('staging-aiweb must connect as ai_app (row privileges only)');
if (user(env('migrate').DATABASE_URL) !== 'ai_owner') bad('migrate must connect as ai_owner');
for (const n of ['n8n', 'n8n-setup']) if (env(n).DB_POSTGRESDB_USER !== 'n8n' || env(n).DB_POSTGRESDB_HOST !== 'db') bad(`${n} must connect to db as n8n`);
if (env('n8n').N8N_SSRF_ALLOWED_HOSTNAMES !== 'aiweb,hydromart-mock') bad('n8n: N8N_SSRF_ALLOWED_HOSTNAMES must be exactly aiweb,hydromart-mock');
if (env('staging-aiweb').ALERT_WEBHOOK_URL !== 'http://hydromart-mock:9911/alert') bad('staging-aiweb: ALERT_WEBHOOK_URL must be the fake hydromart\'s /alert, never a real channel');
const host = /^https:\/\/([a-z0-9.-]+)$/.exec(String(env('staging-aiweb').AI_WEB_URL ?? ''))?.[1];
if (!host) bad('staging-aiweb.AI_WEB_URL must be an https origin');
for (const [svc, key] of [['staging-aiweb', 'HYDROMART_WEB_URL'], ['staging-aiweb', 'HYDROMART_API_URL'], ['hydromart-mock', 'MOCK_AI_WEB_URL']]) {
  if (env(svc)[key] !== `https://${host}`) bad(`${svc}.${key} must be https://${host}: the sign-in and its API are the fake hydromart, served on the staging site`);
}
const site = readFileSync(siteFile, 'utf8');
if (host && !new RegExp(`^${host.replaceAll('.', '\\.')} \\{`, 'm').test(site)) bad(`${siteFile} has no site block for ${host}`);
// The staging app calls these on its HYDROMART_API_URL (this site) server-side, with no staging
// password: each must go to the fake hydromart AND sit outside the basic-auth wall, or the
// Ringkasan, the league and the depot page render without data (seen 25 Nov 2026).
const matcher = (name) => (new RegExp(`^\\s*@${name} (?:not )?path (.+)$`, 'm').exec(site)?.[1] ?? '').split(/\s+/);
for (const path of ['/auth/api/v1/auth/jwks', '/auth/api/v1/auth/handoff/token', '/dashboard/api/v1/ai/read/*', '/dashboard/api/v1/dashboard/pending-approvals', '/depot/api/v1/ai/crm/access', '/depot/api/v1/ai/team/access', '/depot/api/v1/ai/cs/access', '/depot/api/v1/depots', '/depot/api/v1/ai/drafts/depots/from-crm', '/depot/api/v1/ai/drafts/depots/from-crm/*', '/depot/api/v1/ai/crm/legacy-applications', '/auth/api/v1/ai/crm/pic-candidates']) {
  if (!matcher('mock').includes(path)) bad(`${siteFile}: ${path} is not routed to the fake hydromart (@mock)`);
  if (!matcher('gated').includes(path)) bad(`${siteFile}: ${path} is behind the staging password (@gated), but the app calls it server-side without one`);
}

if (problems.length > 0) {
  console.error(`check-aiweb-staging-compose: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`staging AI web compose OK: project ${doc.name}, ${Object.keys(services).length} digest-pinned services, never on edge, internal private and edge-staging, only n8n's editor on 127.0.0.1:5679, only STAGING_* from .env, ${memory}m of 1536m.`);
