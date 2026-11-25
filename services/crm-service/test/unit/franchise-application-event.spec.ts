import { Logger } from '@nestjs/common';

import { loadOverrides } from '@hydromart/access';

import { ApproverDirectoryPort } from '../../src/application/ports/approver-directory.port';
import { PushPayload } from '../../src/application/ports/push-sender.port';
import { StaffEmail, StaffEmailPort } from '../../src/application/ports/staff-email.port';
import { StaffPrefsPort } from '../../src/application/ports/staff-prefs.port';
import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { destinationFor, storedDestinationFor } from '../../src/domain/notification-destination';
import {
  APPROVER_CAP_FOR_EVENT,
  NotificationEvent,
  OPS_EVENTS,
  OVERSEER_EVENTS,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-5, owner decision: a new franchise application is for the accounts that may review one
 * (`franchiseApplications`): head office and the director today, "Sales" once its role is given
 * that capability. Through the flow-6b machinery: the same table decides who sees the feed row
 * and who is pushed (the superuser sees it, and is not pushed).
 */
const EVENT = NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED;
const VARS = { city: 'Bekasi', province: 'Jawa Barat', applicationId: 'app-1' };

describe('the franchise application event', () => {
  it.each(['id', 'en'] as const)('names the place in %s, and says calon mitra in its own words', (locale) => {
    const text = renderMessage(templateFor(EVENT, locale), VARS);
    expect(text).toContain('Bekasi, Jawa Barat');
    expect(text).not.toMatch(/\{\{|investor|investasi/i);
    expect(text).toContain(locale === 'id' ? 'calon mitra' : 'prospective partner');
    // Points at the screen by the name the HQ menu gives it.
    expect(text).toContain(locale === 'id' ? 'Lamaran waralaba' : 'Franchise applications');
  });

  it('is an ops event for application reviewers, on its own /hq/profile switch, for nobody personally', () => {
    expect(OPS_EVENTS).toContain(EVENT);
    expect(APPROVER_CAP_FOR_EVENT[EVENT]).toBe('franchiseApplications');
    expect(STAFF_TOGGLE_FOR_EVENT[EVENT]).toBe('newFranchiseApp');
    expect(PERSONAL_OPS_EVENTS).not.toContain(EVENT);
    expect(OVERSEER_EVENTS).not.toContain(EVENT);
  });

  it('opens the application, or the list when the id is missing', () => {
    expect(destinationFor(EVENT, { applicationId: 'a b&c' })).toBe('/hq/applications/detail?id=a%20b%26c');
    expect(destinationFor(EVENT, {})).toBe('/hq/applications');
    expect(storedDestinationFor(EVENT, VARS)).toBe('/hq/applications/detail?id=app-1');
  });
});

const ROLES: Record<string, string> = {
  'ho-1': 'HEAD_OFFICE',
  'di-1': 'DIREKTUR',
  'sa-1': 'SUPER_ADMIN',
  'mk-1': 'MARKETING',
  'op-1': 'STAFF_DEPOT',
};

function build(
  staffEmail: StaffEmailPort = { send: async (e) => void emails.push(e) },
  staffPrefs?: StaffPrefsPort,
) {
  const pushed: { id: string; payload: PushPayload }[] = [];
  const push = {
    sendToCustomer: async (id: string, payload: PushPayload) => {
      pushed.push({ id, payload });
      return { devices: 1, delivered: 1 };
    },
  } as unknown as PushService;
  const byRoles = jest.fn(async (roles: readonly string[]) =>
    Object.entries(ROLES)
      .filter(([, r]) => roles.includes(r))
      .map(([id]) => id),
  );
  const approvers: ApproverDirectoryPort = {
    staffIdsByRoles: byRoles,
    rolesOf: async (ids) => new Map(ids.filter((i) => ROLES[i]).map((i) => [i, ROLES[i]!])),
    profileOf: async () => null,
  };
  const repo = new InMemoryNotificationRepository();
  const roster = jest.fn(async () => ['op-1']);
  const service = new NotificationService(
    repo,
    push,
    undefined,
    { staffIdsForDepot: roster },
    staffPrefs,
    undefined,
    undefined,
    approvers,
    staffEmail,
  );
  return { service, pushed, repo, byRoles, roster };
}

const raise = (service: NotificationService, dedupeKey = 'franchise.application_submitted:app-1') =>
  service.notify(EVENT, '', VARS, null, null, dedupeKey);
const drain = () => new Promise((r) => setImmediate(r));

let emails: StaffEmail[] = [];
beforeEach(() => (emails = []));
afterEach(() => {
  loadOverrides({});
  jest.restoreAllMocks();
});

describe('who is told about a new franchise application', () => {
  it('pushes head office and the director, not the superuser, a depot role or marketing', async () => {
    const { service, pushed, byRoles, roster } = build();
    await raise(service);
    await drain();
    expect(pushed.map((p) => p.id).sort()).toEqual(['di-1', 'ho-1']);
    expect([...(byRoles.mock.calls[0]![0] as string[])].sort()).toEqual(['DIREKTUR', 'HEAD_OFFICE']);
    // No depot: nobody is looked up on a roster.
    expect(roster).not.toHaveBeenCalled();
    expect(pushed[0]!.payload.url).toBe('/hq/applications/detail?id=app-1');
  });

  it('shows the row to head office and the director, never to depot staff', async () => {
    const { service } = build();
    await raise(service);
    const events = async (role: string, depots?: string[]) =>
      (await service.listOpsFeed('x', depots, 50, role)).map((r) => r.event);
    expect(await events('HEAD_OFFICE')).toEqual([EVENT]);
    expect(await events('DIREKTUR')).toEqual([EVENT]);
    expect(await events('SUPER_ADMIN')).toEqual([EVENT]);
    expect(await events('STAFF_DEPOT', ['dep-1'])).toEqual([]);
    expect(await events('MARKETING')).toEqual([]);
    expect(await service.markAllOpsRead('x', ['dep-1'], 50, 'STAFF_DEPOT')).toBe(0);
  });

  it('reaches "Sales" once its role is given franchiseApplications in the matrix', async () => {
    loadOverrides({ franchiseApplications: ['HEAD_OFFICE', 'DIREKTUR', 'MARKETING', 'SUPER_ADMIN'] });
    const { service, pushed } = build();
    await raise(service);
    await drain();
    expect(pushed.map((p) => p.id).sort()).toEqual(['di-1', 'ho-1', 'mk-1']);
    expect((await service.listOpsFeed('x', undefined, 50, 'MARKETING')).map((r) => r.event)).toEqual([EVENT]);
  });

  it('files one row and pushes once for a repeated eventId', async () => {
    const { service, pushed, repo } = build();
    const first = await raise(service);
    const again = await raise(service);
    await drain();
    expect(again.id).toBe(first.id);
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0]).toMatchObject({ phone: '', customerId: null, depotId: null });
    expect(pushed).toHaveLength(2);
    expect(emails).toHaveLength(1);
  });
});

/*
 * Owner rule 24 Nov 2026: a notification n8n raises also goes out by email, to the same people,
 * under the same switch id as its push (admin-service applies the EMAIL column of it).
 */
describe('the email of a new franchise application', () => {
  it('goes to the reviewers told, under newFranchiseApp, with the place and the application screen', async () => {
    const { service } = build();
    await raise(service);
    await drain();
    expect(emails).toHaveLength(1);
    expect([...emails[0]!.accountIds].sort()).toEqual(['di-1', 'ho-1']);
    expect(emails[0]).toEqual({
      accountIds: expect.any(Array),
      toggle: 'newFranchiseApp',
      subject: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat',
      text: expect.stringContaining('Lamaran waralaba baru dari calon mitra di Bekasi, Jawa Barat.'),
      path: '/hq/applications/detail?id=app-1',
    });
  });

  it("is asked for everyone told, before anyone's push switch is applied", async () => {
    const { service, pushed } = build(undefined, { pushDisabled: async () => new Set(['ho-1']) });
    await raise(service);
    await drain();
    expect(pushed.map((p) => p.id)).toEqual(['di-1']);
    expect([...emails[0]!.accountIds].sort()).toEqual(['di-1', 'ho-1']);
  });

  it('costs only the email when admin-service will not take it', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, pushed, repo } = build({ send: async () => Promise.reject(new Error('admin-service responded 503')) });
    await raise(service);
    await drain();
    expect(warn).toHaveBeenCalledWith(
      'Email for FRANCHISE_APPLICATION_SUBMITTED failed: admin-service responded 503',
    );
    expect(pushed).toHaveLength(2);
    expect(repo.records[0]!.status).toBe('SENT');
  });

  it('is not sent for a decision that has no email template', async () => {
    // Someone in the fixture must hold the refund queue, or "no email" would prove nothing.
    loadOverrides({ refundQueue: ['HEAD_OFFICE', 'SUPER_ADMIN'] });
    const { service, pushed } = build();
    await service.notify(NotificationEvent.REFUND_REQUESTED, '', { amount: 'Rp150.000' }, null, null);
    await drain();
    expect(pushed.length).toBeGreaterThan(0);
    expect(emails).toEqual([]);
  });

  it('is skipped, and the push still goes, when crm has no email channel wired', async () => {
    const repo = new InMemoryNotificationRepository();
    const pushedIds: string[] = [];
    const service = new NotificationService(
      repo,
      { sendToCustomer: async (id: string) => void pushedIds.push(id) } as unknown as PushService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        staffIdsByRoles: async () => ['ho-1'],
        rolesOf: async (ids) => new Map(ids.map((i) => [i, 'HEAD_OFFICE'])),
        profileOf: async () => null,
      },
    );
    await raise(service);
    await drain();
    expect(pushedIds).toEqual(['ho-1']);
  });
});
