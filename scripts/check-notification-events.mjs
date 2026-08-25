#!/usr/bin/env node
/**
 * Every event a service SENDS is an event crm-service can RECEIVE.
 *
 * This defect has now shipped twice, identically, and both times it was silent:
 *
 *   B4  delivery-service sent `DELIVERY_RESCHEDULED` for months and it was not a member of
 *       `NotificationEvent`. Every reschedule notification was lost.
 *   D2  order-service sent `SUBSCRIPTION_PAUSED` from the day the failure-counter landed.
 *       A standing order stopped arriving and the customer was told nothing.
 *
 * The mechanics are the same each time and they are all fail-soft, which is why nobody saw it:
 * `notification.dto.ts` validates the field with `@IsEnum(NotificationEvent)`, so crm answers
 * 400; the sending adapter turns any non-2xx into `logger.warn` and returns false; the caller
 * adds `.catch(() => false)` because a notification must never fail an order. Three correct
 * decisions compose into a message that cannot arrive and cannot complain.
 *
 * Unit tests cannot catch it either: they assert against a FAKE notification port, so they
 * prove the call was made, not that anything is deliverable. The enum file already carries a
 * comment warning about B4 — a comment did not stop D2. Hence a check.
 *
 * Exit 0 = every event literal any service passes to `notify(...)`, or sets as an `event:`
 * on a notification payload, is a member of the enum AND has copy in both template tables.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ENUM_FILE = join(ROOT, 'services/crm-service/src/domain/notification-event.ts');

const enumSrc = readFileSync(ENUM_FILE, 'utf8');

/** The members, read from the enum body rather than from a list restated here. */
const members = new Set([...enumSrc.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*=\s*'([A-Z0-9_]+)',/gm)].map((m) => m[2]));
if (members.size === 0) {
  console.error('check-notification-events: could not read a single member out of the enum.');
  console.error(`Has ${ENUM_FILE} changed shape? Refusing to pass a check that read nothing.`);
  process.exit(1);
}

/** Which members each template table names, so an untranslated event is also caught. */
function templateKeys(table) {
  const start = enumSrc.indexOf(`const ${table}`);
  if (start < 0) return null;
  // To the end of the object literal: the next top-level `};` after the declaration.
  const end = enumSrc.indexOf('\n};', start);
  const body = enumSrc.slice(start, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/\[NotificationEvent\.([A-Z0-9_]+)\]/g)].map((m) => m[1]));
}

const problems = [];
for (const table of ['TEMPLATES_ID', 'TEMPLATES_EN']) {
  const keys = templateKeys(table);
  if (!keys) {
    problems.push(`${table}: not found in notification-event.ts — the template tables moved or were renamed`);
    continue;
  }
  for (const member of members) {
    if (!keys.has(member)) problems.push(`${table}: no copy for ${member} — it would render as its own key`);
  }
}

/** Every .ts under services/, except crm's own enum (which is the definition, not a sender). */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/*
 * One shape: `notify('EVENT', ...)`, the port every service sends through — and the shape
 * both B4 and D2 actually used, so it is the one that had to be checked.
 *
 * A second pattern for `{ event: 'X' }` was tried and removed: it matched payment STATUS
 * values (`PAID`, `FAILED`) and crm's own deliberate `NOT_A_REAL_EVENT` fixture, none of
 * which are notification events. A check that cries wolf three times on its first run is a
 * check somebody switches off, and the loose pattern caught nothing the strict one misses.
 *
 * Tests are scanned too, not excluded: they send through the same port, and a test asserting
 * on an undeliverable event is exactly the false comfort D2 had.
 */
const SENDERS = [/notify\(\s*'([A-Z][A-Z0-9_]{2,})'/g];

const senders = new Map();
for (const file of walk(join(ROOT, 'services'))) {
  if (file === ENUM_FILE) continue;
  const src = readFileSync(file, 'utf8');
  for (const re of SENDERS) {
    for (const m of src.matchAll(re)) {
      if (!senders.has(m[1])) senders.set(m[1], []);
      senders.get(m[1]).push(file.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
}

for (const [event, files] of [...senders].sort()) {
  if (members.has(event)) continue;
  problems.push(
    `${event} is sent but is not a member of NotificationEvent — crm answers 400 and the ` +
      `sender logs a warning, so it is dropped silently. Sent from: ${[...new Set(files)].join(', ')}`,
  );
}

if (problems.length > 0) {
  console.error('Notification events that cannot be delivered:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Notification events OK — ${members.size} member(s), each with copy in both languages, ` +
    `and all ${senders.size} event(s) sent across services are deliverable.`,
);
