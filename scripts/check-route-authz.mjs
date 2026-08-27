#!/usr/bin/env node
/**
 * Every backend route must say who may call it.
 *
 *   node scripts/check-route-authz.mjs
 *
 * `check-roles-policy.mjs` checks the SHAPE of the `@Roles` that exist — that none of them
 * encodes a policy belonging in `@hydromart/access`. Nothing checked that a route has any
 * authorisation at all. A new controller method with no decorator is not refused by
 * anything: `JwtAuthGuard` is a global APP_GUARD, so it resolves to "any authenticated
 * caller, any role" — a signed-in customer reaching a route meant for head office.
 *
 * That is not a hypothetical class. Every AUTHZ finding in the audit was a route that HAD
 * a decorator and scoped the wrong thing; this is the cheaper failure underneath them —
 * the route that was never given one, which no gate could see.
 *
 * A route passes if either is true:
 *
 *   1. it carries an authorisation decorator, on the method or on its class:
 *      @Can(...)  @Roles(...)  @Public()  InternalAuthGuard  ApiKeyGuard
 *
 *   2. its handler takes @CurrentUser(), which is what makes a self-service route safe
 *      without one: `GET auth/me`, `GET favorites`, `POST attendance/check-in`. The
 *      identity is not a parameter the caller supplies, so the route can only ever act on
 *      the caller. 39 routes are in this class today.
 *
 * Neither means the route is reachable by every signed-in account and reads its subject
 * from the request. That is the shape this refuses.
 *
 * Deliberately NOT a baseline file. A baseline records that something is known; this rule
 * is derived from the code, so a route either satisfies it or it does not, and there is
 * nothing to keep in step.
 *
 * Exit 0 = every route says who may call it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VERB = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?/g;
/** A method signature at class-body indentation: the boundary between two routes' blocks. */
const SIG = /^ {2}(?:async |readonly )?[A-Za-z_$][\w$]*\s*\(/gm;
const AUTHORISED = /@Can\(|@Roles\(|@Public\(|InternalAuthGuard|ApiKeyGuard/;
const SELF_SCOPED = /@CurrentUser\(/;
/*
 * The third way out, and the only one that needs a human to write a sentence.
 *
 * A route that takes no subject at all — it returns a constant, the same answer for every
 * caller — cannot be self-scoped and does not belong to a capability. `GET push/vapid-public-key`
 * is the one: it hands back the browser's own subscribe key, which every signed-in account
 * legitimately needs and which is public by construction anyway.
 *
 * `route-authz:` marks that, and the marker must carry a reason. Read from the RAW source,
 * not the comment-stripped copy, precisely because it IS a comment: the point is that a
 * person looked at the route and said why, which is the one thing a regex cannot derive.
 */
const DELIBERATE = /route-authz:/;

function controllers(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) controllers(path, out);
    else if (path.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

/**
 * Comments blanked, offsets preserved. A doc comment quoting `@Can(...)` while explaining
 * why a route does NOT have one would otherwise satisfy the very rule it describes.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const findings = [];
let total = 0;
let selfScoped = 0;
let deliberate = 0;

for (const service of readdirSync('services')) {
  let files;
  try {
    files = controllers(join('services', service, 'src'));
  } catch {
    continue; // not a service directory
  }
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const src = stripComments(raw);
    const classes = [...src.matchAll(/^export class\s+(\w+)/gm)].map((m) => ({
      name: m[1],
      at: m.index,
    }));
    const signatures = [...src.matchAll(SIG)].map((m) => m.index);

    // A class's own decorators: everything between the end of the previous class body and
    // this class's declaration. One file holds several controllers (a staff one and a
    // self-service one), and they do not share their guards.
    const classDecorators = (cls) => {
      const previous = classes.filter((c) => c.at < cls.at).pop();
      const from = previous ? src.indexOf('\n}', previous.at) : 0;
      return src.slice(from < 0 ? 0 : from, cls.at);
    };

    for (const m of src.matchAll(VERB)) {
      total += 1;
      /*
       * The route's own block: its decorators AND its signature.
       *
       * Both ends matter, and the first version of this got both wrong.
       *   - Nest does not care whether @UseGuards is written above or below @Post, and this
       *     repo writes it both ways, so the window has to cover both sides.
       *   - @CurrentUser() is a PARAMETER decorator, so it lives in the signature. Ending
       *     the block at the signature's start excluded the very thing rule 2 looks for,
       *     and reported twelve correctly self-scoped routes as unauthorised.
       *
       * So: from the previous method's body-open brace, through this method's own.
       */
      const previousSig = signatures.filter((i) => i < m.index).pop();
      const ownSig = signatures.find((i) => i > m.index) ?? src.length;
      const start = previousSig === undefined ? 0 : (src.indexOf('{', previousSig) + 1 || 0);
      const bodyOpen = src.indexOf('{', ownSig);
      const end = bodyOpen === -1 ? ownSig : bodyOpen;
      const block = src.slice(start, end);
      const rawBlock = raw.slice(start, end);
      const owner = classes.filter((c) => c.at < m.index).pop();

      if (AUTHORISED.test(block)) continue;
      if (owner && AUTHORISED.test(classDecorators(owner))) continue;
      if (SELF_SCOPED.test(block)) {
        selfScoped += 1;
        continue;
      }
      if (DELIBERATE.test(rawBlock)) {
        deliberate += 1;
        continue;
      }

      const line = src.slice(0, m.index).split('\n').length;
      findings.push(
        `${file}:${line}  ${m[1].toUpperCase()} '${m[2] ?? ''}'` +
          `${owner ? ` (${owner.name})` : ''}`,
      );
    }
  }
}

if (total === 0) {
  console.error('No routes found — this check went blind, which is what it exists to stop.');
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`${findings.length} route(s) do not say who may call them:\n`);
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    '\nJwtAuthGuard is global, so a route with no decorator is reachable by EVERY signed-in\n' +
      'account, whatever its role. Give it @Can(<capability>) — or, if it is self-service,\n' +
      'take @CurrentUser() and read the subject from that instead of from the request.',
  );
  process.exit(1);
}

console.log(
  `Route authorisation check OK — ${total} route(s): ` +
    `${total - selfScoped - deliberate} carry an authorisation decorator, ` +
    `${selfScoped} are self-scoped by @CurrentUser(), ${deliberate} take no subject and say so.`,
);
