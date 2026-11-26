import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { DueCompliance } from '../../src/application/ports/compliance-due.port';
import { ComplianceDueService } from '../../src/application/services/compliance-due.service';
import { complianceDigest, complianceReason } from '../../src/domain/compliance-due';
import { destinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent, PERSONAL_OPS_EVENTS, STAFF_TOGGLE_FOR_EVENT, renderMessage, templateFor } from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { ComplianceDueHttpAdapter } from '../../src/infrastructure/http/compliance-due.http.adapter';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';

const D1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DATE = '2026-11-26';

const item = (over: Partial<DueCompliance> = {}): DueCompliance => ({
  id: '11111111-aaaa-4aaa-8aaa-111111111111',
  depotId: D1,
  depotName: 'Cikini',
  kind: 'PERMIT',
  name: 'SLHS 9',
  dueOn: '2026-12-10',
  daysLeft: 14,
  cycleStart: '2026-12-10',
  ...over,
});
const lab = (over: Partial<DueCompliance> = {}) =>
  item({ id: '22222222-bbbb-4bbb-8bbb-222222222222', kind: 'LAB_TEST', name: 'Uji E. coli', dueOn: '2026-11-20', daysLeft: -6, cycleStart: '2026-08-22', ...over });

function build(over: { items?: DueCompliance[]; keys?: string[]; fail?: string; dueThrows?: boolean } = {}) {
  const notify = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, id: string, _x?: unknown, _k?: string) => {
    if (id === over.fail) throw new Error('boom');
    return { id: 'row' };
  });
  const recentDedupeKeys = jest.fn(async () => over.keys ?? []);
  const dueItems = jest.fn(async () => {
    if (over.dueThrows) throw new Error('down');
    return over.items ?? [item(), lab()];
  });
  const service = new ComplianceDueService(
    { notify, recentDedupeKeys } as never,
    { dueItems },
    { staffIdsByRoles: async () => ['ho1'], rolesOf: async (ids: readonly string[]) => new Map(ids.map((i) => [i, i === 'k1' ? 'KEPALA_DEPOT' : 'HEAD_OFFICE'])), profileOf: jest.fn() },
    { staffIdsForDepot: async () => ['k1'] },
    { overseersOfDepot: async () => ['spv1'] },
  );
  return { service, notify, recentDedupeKeys };
}

describe('ComplianceDueService', () => {
  it('tells Kepala, supervisor and HQ once per kind, with a key family per kind', async () => {
    const { service, notify } = build();
    const r = await service.run(DATE);
    expect(r).toMatchObject({ depots: 1, items: 2, notified: 6, remindLater: 0, whatsapp: 'pending' });
    const events = notify.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === NotificationEvent.PERMIT_DUE)).toHaveLength(3);
    expect(events.filter((e) => e === NotificationEvent.LAB_TEST_DUE)).toHaveLength(3);
    const keys = notify.mock.calls.map((c) => c[5] as unknown as string);
    expect(keys.some((k) => k.startsWith('permit-due:hq:'))).toBe(true);
    expect(keys.some((k) => k.startsWith(`lab-test-due:${D1}:`))).toBe(true);
  });

  it('does not tell again what a recent run already told, and counts it as remind-later', async () => {
    const first = build();
    await first.service.run(DATE);
    const keys = first.notify.mock.calls.map((c) => c[5] as unknown as string);
    const again = build({ keys });
    const r = await again.service.run(DATE);
    expect(r.notified).toBe(0);
    expect(r.remindLater).toBe(2);
  });

  it('says nothing when nothing is due, and 503s on an unreadable source or a failed recipient', async () => {
    const none = build({ items: [] });
    expect(await none.service.run(DATE)).toMatchObject({ items: 0, notified: 0 });
    await expect(build({ dueThrows: true }).service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ fail: 'k1' }).service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('503s when the earlier notices cannot be read', async () => {
    const b = build();
    (b.recentDedupeKeys as jest.Mock).mockRejectedValueOnce(new Error('db'));
    await expect(b.service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('compliance words and wiring', () => {
  it('words a permit and a lab test by how far past due', () => {
    expect(complianceReason(item())).toBe('berlaku sampai 2026-12-10, 14 hari lagi');
    expect(complianceReason(item({ daysLeft: 0 }))).toBe('berlaku sampai hari ini');
    expect(complianceReason(item({ daysLeft: -3 }))).toBe('sudah habis 3 hari');
    expect(complianceReason(lab())).toBe('batas uji 2026-11-20, terlambat 6 hari');
    expect(complianceReason(lab({ daysLeft: 0 }))).toBe('batas uji 2026-11-20, hari ini');
  });

  it('lists up to five and counts the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => item({ name: `P${i}` }));
    expect(complianceDigest(many).items).toMatch(/dan 2 lainnya$/);
    expect(complianceDigest([item()])).toMatchObject({ depot: 'Cikini', depotId: D1 });
  });

  it('is a staff row with its own words, email, switch and screen', () => {
    for (const e of [NotificationEvent.PERMIT_DUE, NotificationEvent.LAB_TEST_DUE]) {
      expect(PERSONAL_OPS_EVENTS).toContain(e);
      expect(STAFF_TOGGLE_FOR_EVENT[e]).toBe('maintenanceDue');
      expect(STAFF_EMAIL_TEMPLATES[e]).toEqual({ subject: expect.any(String), body: expect.stringContaining('{{items}}') });
      expect(renderMessage(templateFor(e, 'id'), { depot: 'Cikini', items: 'x' })).toContain('Cikini');
      expect(renderMessage(templateFor(e, 'en'), { depot: 'Cikini', items: 'x' })).toContain('Cikini');
      expect(destinationFor(e, { depotId: D1 })).toBe(`/dashboard/quality?depot=${D1}`);
      expect(destinationFor(e, {})).toBe('/dashboard/quality');
    }
  });
});

describe('ComplianceDueHttpAdapter', () => {
  const adapter = (url: string | null, key: string | null) =>
    new ComplianceDueHttpAdapter({ depotServiceUrl: url, internalServiceKey: key } as never);
  const reply = (body: unknown, ok = true, status = 200) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok, status, json: async () => body } as Response);
  afterEach(() => jest.restoreAllMocks());

  it('reads the list with the internal key', async () => {
    const spy = reply({ items: [item()] });
    expect(await adapter('http://d', 'k').dueItems()).toHaveLength(1);
    expect(spy.mock.calls[0][0]).toBe('http://d/api/v1/internal/compliance/due');
  });

  it('throws on a missing config, a bad status, a malformed list or row', async () => {
    await expect(adapter(null, 'k').dueItems()).rejects.toThrow('missing');
    await expect(adapter('http://d', null).dueItems()).rejects.toThrow('missing');
    reply({}, false, 500);
    await expect(adapter('http://d', 'k').dueItems()).rejects.toThrow('500');
    reply({ items: 'x' });
    await expect(adapter('http://d', 'k').dueItems()).rejects.toThrow('malformed');
    reply({ items: [{ ...item(), kind: 'OTHER' }] });
    await expect(adapter('http://d', 'k').dueItems()).rejects.toThrow('malformed');
    reply({ items: [{ ...item(), daysLeft: 'x' }] });
    await expect(adapter('http://d', 'k').dueItems()).rejects.toThrow('malformed');
  });
});

describe('NotificationExternalController.complianceDueRun', () => {
  const run = jest.fn(async () => ({ date: DATE }));
  const controller = new NotificationExternalController({} as never, {} as never, {} as never, {} as never, {} as never, { run } as never, {} as never, {} as never);
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-26T00:30:00.000Z'));
    run.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('runs for today in Jakarta and refuses another day', async () => {
    await controller.complianceDueRun({ date: DATE });
    expect(run).toHaveBeenCalledWith(DATE);
    await expect(controller.complianceDueRun({ date: '2026-11-25' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
