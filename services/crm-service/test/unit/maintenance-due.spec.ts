import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DueMaintenance } from '../../src/application/ports/maintenance-due.port';
import { MaintenanceDueService } from '../../src/application/services/maintenance-due.service';
import { dueKey, dueReason, recentlyTold } from '../../src/domain/maintenance-due';
import { destinationFor } from '../../src/domain/notification-destination';
import {
  NotificationEvent,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { MaintenanceDueHttpAdapter } from '../../src/infrastructure/http/maintenance-due.http.adapter';
import { MaintenanceDueDto } from '../../src/modules/dto/notification.dto';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';

/*
 * HD-15: n8n only says "now". Which items are due, who is told and the words are hydromart's:
 * the depot's Kepala, the supervisors over the depot and HQ Operasional, once per item and then
 * a reminder every 3 days while it stays due.
 */
const ITEM_A = '11111111-aaaa-4aaa-8aaa-111111111111';
const ITEM_B = '22222222-bbbb-4bbb-8bbb-222222222222';
const D1 = 'd1';
const D2 = 'd2';
const DATE = '2026-11-26';

const item = (over: Partial<DueMaintenance> = {}): DueMaintenance => ({
  id: ITEM_A,
  depotId: D1,
  depotName: 'Cikini',
  name: 'Membran RO',
  category: 'RO',
  dueBy: 'VOLUME',
  daysSinceService: 40,
  m3SinceService: 520.25,
  intervalDays: null,
  intervalM3: 500,
  cycleStart: '2026-10-13',
  ...over,
});

const ROLES: Record<string, string> = { k1: 'KEPALA_DEPOT', s1: 'STAFF_DEPOT', k2: 'KEPALA_DEPOT', ho1: 'HEAD_OFFICE', ho2: 'HEAD_OFFICE' };

function build(over: { items?: DueMaintenance[]; keys?: string[]; notifyFails?: string } = {}) {
  const notify = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, id: string) => {
    if (id === over.notifyFails) throw new Error('boom');
    return { id: 'row' };
  });
  const recentDedupeKeys = jest.fn(async () => over.keys ?? []);
  const dueItems = jest.fn(async () => over.items ?? [item()]);
  const staffIdsForDepot = jest.fn(async (d: string) => (d === D1 ? ['k1', 's1'] : ['k2']));
  const overseersOfDepot = jest.fn(async (d: string) => (d === D1 ? ['asst1', 'spv1'] : ['spv1']));
  const staffIdsByRoles = jest.fn(async () => ['ho1', 'ho2']);
  const rolesOf = jest.fn(async (ids: readonly string[]) => new Map(ids.map((i) => [i, ROLES[i] ?? 'X'])));
  const service = new MaintenanceDueService(
    { notify, recentDedupeKeys } as never,
    { dueItems },
    { staffIdsByRoles, rolesOf, profileOf: jest.fn() },
    { staffIdsForDepot },
    { overseersOfDepot },
  );
  return { service, notify, recentDedupeKeys, dueItems, staffIdsByRoles, staffIdsForDepot, overseersOfDepot };
}

describe('MaintenanceDueService', () => {
  it('tells the depot Kepala (not the other staff), the people over the depot and HQ, once each, with their own key', async () => {
    const { service, notify, staffIdsByRoles } = build();
    await expect(service.run(DATE)).resolves.toEqual({ date: DATE, depots: 1, items: 1, notified: 5, remindLater: 0, whatsapp: 'pending' });
    expect(staffIdsByRoles).toHaveBeenCalledWith(['HEAD_OFFICE']);
    expect(notify.mock.calls.map((c) => c[3]).sort()).toEqual(['asst1', 'ho1', 'ho2', 'k1', 'spv1']);
    expect(notify).toHaveBeenCalledWith(
      NotificationEvent.MAINTENANCE_DUE,
      '',
      { depot: 'Cikini', item: 'Membran RO', reason: 'volume air sudah 520,3 m3 dari batas 500 m3' },
      'k1',
      null,
      `maintenance-due:${ITEM_A}:2026-10-13:${DATE}:k1`,
    );
  });

  it('counts depots and items across the network, one notice set per item', async () => {
    const { service, notify, overseersOfDepot } = build({
      items: [item(), item({ id: ITEM_B, name: 'Lampu UV', dueBy: 'DAYS', intervalDays: 30, intervalM3: null, m3SinceService: null, daysSinceService: 45 }), item({ id: 'c', depotId: D2, depotName: 'Bekasi' })],
    });
    const out = await service.run(DATE);
    expect(out).toMatchObject({ depots: 2, items: 3, notified: 5 + 5 + 4 });
    expect(overseersOfDepot).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.filter((c) => (c[2] as { depot: string }).depot === 'Bekasi').map((c) => c[3]).sort()).toEqual(['ho1', 'ho2', 'k2', 'spv1']);
  });

  it('does not repeat an item told about 1 or 2 days ago, reminds on the 3rd day, and a new cycle is a new item', async () => {
    const told = (date: string, cycle = '2026-10-13') => `maintenance-due:${ITEM_A}:${cycle}:${date}:k1`;
    for (const [keys, expected] of [
      [[told('2026-11-25')], 0],
      [[told('2026-11-24')], 0],
      [[told('2026-11-23')], 5],
      [[told('2026-11-25', '2026-09-01')], 5],
      [[`maintenance-due:${ITEM_A}:2026-10-13:${DATE}:k1`], 5],
    ] as const) {
      const { service, notify } = build({ keys: [...keys] });
      const out = await service.run(DATE);
      expect(notify).toHaveBeenCalledTimes(expected);
      expect(out.remindLater).toBe(expected === 0 ? 1 : 0);
    }
  });

  it('asks nobody for recipients when every item is inside its reminder window', async () => {
    const { service, staffIdsByRoles, staffIdsForDepot } = build({ keys: [`maintenance-due:${ITEM_A}:2026-10-13:2026-11-25:k1`] });
    await service.run(DATE);
    expect(staffIdsByRoles).not.toHaveBeenCalled();
    expect(staffIdsForDepot).not.toHaveBeenCalled();
  });

  it('answers zero for a network with nothing due', async () => {
    const { service, notify } = build({ items: [] });
    await expect(service.run(DATE)).resolves.toEqual({ date: DATE, depots: 0, items: 0, notified: 0, remindLater: 0, whatsapp: 'pending' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('is a 503, never "nothing due", when due items, earlier notices, HQ or a depot roster cannot be read', async () => {
    const a = build();
    a.dueItems.mockRejectedValueOnce(new Error('down'));
    await expect(a.service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const b = build();
    b.recentDedupeKeys.mockRejectedValueOnce(new Error('down'));
    await expect(b.service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const c = build();
    c.staffIdsByRoles.mockRejectedValueOnce(new Error('down'));
    await expect(c.service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const d = build();
    d.overseersOfDepot.mockRejectedValueOnce(new Error('down'));
    await expect(d.service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('finishes the other recipients then answers 503 when one could not be filed', async () => {
    const { service, notify } = build({ notifyFails: 'k1' });
    await expect(service.run(DATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(notify).toHaveBeenCalledTimes(5);
  });

  it('ignores an HQ account whose role is no longer HQ Operasional', async () => {
    const { service, notify } = build();
    ROLES.ho2 = 'MARKETING';
    try {
      await service.run(DATE);
    } finally {
      ROLES.ho2 = 'HEAD_OFFICE';
    }
    expect(notify.mock.calls.map((c) => c[3])).not.toContain('ho2');
  });

  it('a depot with no one rostered still tells the overseers and HQ', async () => {
    const { service, notify, staffIdsForDepot } = build();
    staffIdsForDepot.mockResolvedValueOnce([]);
    await service.run(DATE);
    expect(notify.mock.calls.map((c) => c[3]).sort()).toEqual(['asst1', 'ho1', 'ho2', 'spv1']);
  });
});

describe('maintenance-due words, keys and reminder window', () => {
  it('says the limit that was reached, in Indonesian, in both languages of the bell', () => {
    expect(dueReason(item())).toBe('volume air sudah 520,3 m3 dari batas 500 m3');
    expect(dueReason(item({ dueBy: 'DAYS', intervalDays: 30, daysSinceService: 45 }))).toBe('sudah 45 hari dari batas 30 hari');
    expect(dueReason(item({ m3SinceService: null, intervalM3: null }))).toBe('volume air sudah 0 m3 dari batas 0 m3');
    expect(dueReason(item({ dueBy: 'DAYS', intervalDays: null, daysSinceService: 9 }))).toBe('sudah 9 hari dari batas 9 hari');
    const vars = { depot: 'Cikini', item: 'Membran RO', reason: 'sudah 45 hari dari batas 30 hari' };
    expect(renderMessage(templateFor(NotificationEvent.MAINTENANCE_DUE, 'id'), vars)).toContain('Perawatan jatuh tempo di Cikini: Membran RO (sudah 45 hari');
    expect(renderMessage(templateFor(NotificationEvent.MAINTENANCE_DUE, 'en'), vars)).toContain('Maintenance is due at Cikini: Membran RO');
  });

  it('is for its recipient only, on its own switch, with an email and a tap to the maintenance list', () => {
    expect(PERSONAL_OPS_EVENTS).toContain(NotificationEvent.MAINTENANCE_DUE);
    expect(STAFF_TOGGLE_FOR_EVENT[NotificationEvent.MAINTENANCE_DUE]).toBe('maintenanceDue');
    expect(STAFF_EMAIL_TEMPLATES[NotificationEvent.MAINTENANCE_DUE]).toEqual({ subject: expect.any(String), body: expect.stringContaining('{{reason}}') });
    expect(destinationFor(NotificationEvent.MAINTENANCE_DUE, {})).toBe('/dashboard/maintenance');
  });

  it('keys one notice per item, cycle, day and recipient, and ignores keys that are not its own', () => {
    expect(dueKey(item(), DATE, 'k1')).toBe(`maintenance-due:${ITEM_A}:2026-10-13:${DATE}:k1`);
    expect([...recentlyTold(['other:key', `maintenance-due:${ITEM_A}:2026-10-13:2026-11-25:k1`, `maintenance-due:${ITEM_A}:2026-10-13:2026-11-26:k1`], DATE)]).toEqual([`${ITEM_A}:2026-10-13`]);
  });
});

describe('NotificationExternalController.maintenanceDueRun', () => {
  const run = jest.fn(async () => ({ date: DATE, depots: 1, items: 1, notified: 2, remindLater: 0, whatsapp: 'pending' as const }));
  const controller = new NotificationExternalController({} as never, {} as never, {} as never, { run } as never);
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-26T00:30:00.000Z'));
    run.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('runs the sweep for today in Jakarta', async () => {
    await controller.maintenanceDueRun({ date: DATE });
    expect(run).toHaveBeenCalledWith(DATE);
  });

  it('refuses another day, so a replay cannot go out under today', async () => {
    await expect(controller.maintenanceDueRun({ date: '2026-11-25' })).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('validates the body: only a date', async () => {
    expect(await validate(plainToInstance(MaintenanceDueDto, { date: DATE }))).toEqual([]);
    expect((await validate(plainToInstance(MaintenanceDueDto, { date: '26-11-2026' }))).length).toBeGreaterThan(0);
  });
});

describe('MaintenanceDueHttpAdapter', () => {
  const fetchMock = jest.fn();
  const config = { depotServiceUrl: 'http://depot', internalServiceKey: 'k' };
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('reads the due items with the internal key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [item()] }) });
    await expect(new MaintenanceDueHttpAdapter(config as never).dueItems()).resolves.toEqual([item()]);
    expect(fetchMock).toHaveBeenCalledWith('http://depot/api/v1/internal/maintenance/due', expect.objectContaining({ headers: { 'x-internal-key': 'k' } }));
  });

  it('throws, never answers an empty list, when unconfigured, refused or malformed', async () => {
    await expect(new MaintenanceDueHttpAdapter({ depotServiceUrl: '', internalServiceKey: 'k' } as never).dueItems()).rejects.toThrow(/missing/);
    const adapter = new MaintenanceDueHttpAdapter(config as never);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(adapter.dueItems()).rejects.toThrow(/500/);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(adapter.dueItems()).rejects.toThrow(/malformed/);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ ...item(), dueBy: 'X' }] }) });
    await expect(adapter.dueItems()).rejects.toThrow(/malformed/);
  });
});
