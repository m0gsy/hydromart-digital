import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OPS_EVENT_GROUP } from '@/lib/ops-notifications';
import { OPS_EVENTS } from '@/lib/types';

/**
 * The web names every notification event twice - the `NotificationEvent` union and the ops-feed
 * list in `lib/types.ts` - and crm-service is the only place events are actually defined.
 * Nothing tied them together, so seven events (kasbon, a changed phone number, reseller notices,
 * a paused subscription) had been sent for months and rendered as a raw dictionary key. This
 * reads crm's own source, so adding an event there without teaching the web fails here.
 */
const CRM = readFileSync(
  join(__dirname, '../../../services/crm-service/src/domain/notification-event.ts'),
  'utf8',
);

function crmEvents(): string[] {
  const body = /export enum NotificationEvent \{([\s\S]*?)\n\}/.exec(CRM)?.[1] ?? '';
  return [...body.matchAll(/^\s+([A-Z_]+) = '/gm)].map((m) => m[1]!);
}

function crmOpsEvents(): string[] {
  const body = /export const OPS_EVENTS: NotificationEvent\[\] = \[([\s\S]*?)\n\];/.exec(CRM)?.[1] ?? '';
  return [...body.matchAll(/^\s+NotificationEvent\.([A-Z_]+),/gm)].map((m) => m[1]!);
}

const WEB_UNION = (() => {
  const src = readFileSync(join(__dirname, '../src/lib/types.ts'), 'utf8');
  const body = /export type NotificationEvent =([\s\S]*?);/.exec(src)?.[1] ?? '';
  return [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
})();

describe('notification events: web mirrors crm-service', () => {
  it('reads a believable number of events from crm (the parse itself works)', () => {
    expect(crmEvents().length).toBeGreaterThan(30);
    expect(crmOpsEvents().length).toBeGreaterThan(10);
  });

  it('knows every event crm can send, and invents none', () => {
    expect([...WEB_UNION].sort()).toEqual([...crmEvents()].sort());
  });

  it('lists every ops event for the staff feed', () => {
    expect([...OPS_EVENTS].sort()).toEqual([...crmOpsEvents()].sort());
  });

  it('files every ops event under a feed chip', () => {
    for (const event of crmOpsEvents()) expect(OPS_EVENT_GROUP[event]).toBeDefined();
  });
});
