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
for (const m of text.replace(/\$\$/g, '').matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
  if (!m[1].startsWith('AIWEB_')) bad(`reads \${${m[1]}} from .env; only AIWEB_* keys may reach the AI web`);
}

// Networks: `edge` comes from outside (hydromart's Caddy creates it); every other network is
// this project's own and internal, so nothing reaches the database except over `private`.
const networks = doc.networks ?? {};
for (const [key, net] of Object.entries(networks)) {
  const external = net?.external === true || net?.external?.name !== undefined;
  if (key === 'edge') {
    if (!external || (net.name ?? 'edge') !== 'edge') bad('networks.edge must be `external: true`, the network named edge');
  } else if (external || net?.name !== undefined) {
    bad(`networks.${key} must be this project's own network: no \`external\`, no \`name\` (that is how hydromart's would be joined)`);
  } else if (net?.internal !== true) {
    bad(`networks.${key} must be \`internal: true\`: a way off the box from the database's network is a way in too`);
  }
}
if (!networks.edge) bad('no `edge` network: Caddy could not reach the app');

const FORBIDDEN = ['ports', 'network_mode', 'pid', 'ipc', 'privileged', 'cap_add', 'devices', 'userns_mode', 'volumes_from', 'env_file', 'build', 'extra_hosts', 'links', 'external_links'];
const dbUser = (svc) => /^postgres(?:ql)?:\/\/([^:@/]+)[:@]/.exec(String(svc?.environment?.DATABASE_URL ?? ''))?.[1];
const onEdge = [];
const services = Object.entries(doc.services ?? {});
if (services.length === 0) bad('no services');
for (const [name, svc] of services) {
  const where = `services.${name}`;
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(String(svc?.image ?? ''))) {
    bad(`${where}.image must be pinned by digest (name@sha256:<64 hex>): a tag is whatever its registry says today`);
  }
  for (const key of FORBIDDEN) {
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
}

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
}

if (problems.length > 0) {
  console.error(`${file} breaks the AI web's isolation:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `AI web compose OK: project ${doc.name}, ${services.length} digest-pinned services, ` +
    `${front} alone on edge, no host port, only AIWEB_* from .env.`,
);
