import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DepotAudienceService } from '../../src/application/services/depot-audience.service';
import { VisitNoticeService } from '../../src/application/services/visit-notice.service';
import { destinationFor } from '../../src/domain/notification-destination';
import {
  NotificationEvent,
  OPS_EVENTS,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { VisitNoticeDto } from '../../src/modules/dto/notification.dto';
import { VisitNoticeController } from '../../src/modules/visit-notice.controller';

const DEPOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VISIT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLES: Record<string, string> = { k1: 'KEPALA_DEPOT', s1: 'STAFF_DEPOT', ho1: 'HEAD_OFFICE', spv: 'SUPERVISOR' };

function audience(over: { staff?: string[]; overseers?: string[] | Error; hq?: string[] } = {}) {
  const staffIdsForDepot = jest.fn(async () => over.staff ?? ['k1', 's1']);
  const overseersOfDepot = jest.fn(async () => {
    if (over.overseers instanceof Error) throw over.overseers;
    return over.overseers ?? ['spv', 'ho1'];
  });
  const staffIdsByRoles = jest.fn(async () => over.hq ?? ['ho1']);
  const rolesOf = jest.fn(async (ids: readonly string[]) => new Map(ids.map((i) => [i, ROLES[i] ?? 'X'])));
  return {
    service: new DepotAudienceService({ staffIdsByRoles, rolesOf, profileOf: jest.fn() }, { staffIdsForDepot }, { overseersOfDepot }),
    staffIdsForDepot,
    staffIdsByRoles,
  };
}

describe('DepotAudienceService', () => {
  it('is the depot Kepala (not other staff) and the overseers, no one twice, and HQ re-checked against its role', async () => {
    const { service } = audience();
    await expect(service.depotRecipients(DEPOT)).resolves.toEqual(['k1', 'spv', 'ho1']);
    await expect(service.hq()).resolves.toEqual(['ho1']);
    // HQ who also oversees the depot is one recipient.
    await expect(service.everyone(DEPOT)).resolves.toEqual(['k1', 'spv', 'ho1']);
  });

  it('keeps going without a roster, and drops an HQ account whose role has changed', async () => {
    const { service, staffIdsByRoles } = audience({ staff: [], overseers: [] });
    await expect(service.depotRecipients(DEPOT)).resolves.toEqual([]);
    staffIdsByRoles.mockResolvedValue(['ho1', 'spv']);
    await expect(service.hq()).resolves.toEqual(['ho1']);
  });

  it('throws when the overseers cannot be read', async () => {
    const { service } = audience({ overseers: new Error('auth down') });
    await expect(service.everyone(DEPOT)).rejects.toThrow('auth down');
  });
});

describe('VisitNoticeService', () => {
  function build(over: { notifyFails?: string; existing?: string[]; aud?: Parameters<typeof audience>[0] } = {}) {
    const notifyOnce = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, id: string, _d: unknown, key: string) => {
      if (id === over.notifyFails) throw new Error('boom');
      return { record: { id: 'row' }, created: !over.existing?.includes(key) };
    });
    const { service: aud } = audience(over.aud);
    return { service: new VisitNoticeService({ notifyOnce } as never, aud), notifyOnce };
  }
  const finding = { kind: 'FINDING' as const, depotId: DEPOT, depotName: 'Cikini', visitId: VISIT, dateKey: '2026-11-26', items: ['Filter: kotor'] };
  const overdue = { kind: 'OVERDUE' as const, depotId: DEPOT, depotName: 'Cikini', dateKey: '2026-11-26', items: ['Filter: kotor', 'Lantai'] };

  it('files one finding row per recipient (Kepala, supervisors, HQ once), keyed by visit and recipient', async () => {
    const { service, notifyOnce } = build();
    await expect(service.run(finding)).resolves.toEqual({ recipients: 3, notified: 3 });
    expect(notifyOnce.mock.calls.map((c) => [c[0], c[3], c[5]])).toEqual([
      [NotificationEvent.VISIT_FINDING, 'k1', `visit-finding:${VISIT}:k1`],
      [NotificationEvent.VISIT_FINDING, 'spv', `visit-finding:${VISIT}:spv`],
      [NotificationEvent.VISIT_FINDING, 'ho1', `visit-finding:${VISIT}:ho1`],
    ]);
    expect(notifyOnce.mock.calls[0][2]).toEqual({ depot: 'Cikini', items: 'Filter: kotor', depotId: DEPOT, visitId: VISIT });
  });

  it('keys an overdue notice by depot, WIB day and recipient, and names five items then counts the rest', async () => {
    const { service, notifyOnce } = build({ aud: { staff: ['k1'], overseers: [], hq: [] } });
    const items = Array.from({ length: 8 }, (_, n) => `L${n}`);
    await service.run({ ...overdue, items });
    expect(notifyOnce.mock.calls[0][0]).toBe(NotificationEvent.FOLLOW_UP_OVERDUE);
    expect(notifyOnce.mock.calls[0][5]).toBe(`follow-up-overdue:${DEPOT}:2026-11-26:k1`);
    expect(notifyOnce.mock.calls[0][2]).toEqual({ depot: 'Cikini', items: 'L0; L1; L2; L3; L4; dan 3 lainnya', depotId: DEPOT });
  });

  it('is idempotent: a retry files nothing new, and a notice with no items says nothing', async () => {
    const { service } = build({ existing: [`visit-finding:${VISIT}:k1`, `visit-finding:${VISIT}:spv`] });
    await expect(service.run(finding)).resolves.toEqual({ recipients: 3, notified: 1 });
    await expect(service.run({ ...finding, items: [] })).resolves.toEqual({ recipients: 0, notified: 0 });
  });

  it('answers 503 when the recipients cannot be read, and when one could not be filed (the others stay filed)', async () => {
    await expect(build({ aud: { overseers: new Error('auth down') } }).service.run(finding)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const { service, notifyOnce } = build({ notifyFails: 'spv' });
    await expect(service.run(finding)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(notifyOnce).toHaveBeenCalledTimes(3);
  });

  it('refuses a finding notice that names no visit, and reaches nobody when there is nobody', async () => {
    await expect(build().service.run({ ...finding, visitId: undefined })).rejects.toBeInstanceOf(BadRequestException);
    const { service, notifyOnce } = build({ aud: { staff: [], overseers: [], hq: [] } });
    await expect(service.run(overdue)).resolves.toEqual({ recipients: 0, notified: 0 });
    expect(notifyOnce).not.toHaveBeenCalled();
  });
});

describe('visit notice events', () => {
  it('are for their recipient only, on one switch, with an email, and each tap leads to the Supervisor view', () => {
    for (const e of [NotificationEvent.VISIT_FINDING, NotificationEvent.FOLLOW_UP_OVERDUE]) {
      expect(OPS_EVENTS).toContain(e);
      expect(PERSONAL_OPS_EVENTS).toContain(e);
      expect(STAFF_TOGGLE_FOR_EVENT[e]).toBe('visitFinding');
      expect(STAFF_EMAIL_TEMPLATES[e]).toEqual({ subject: expect.any(String), body: expect.stringContaining('{{items}}') });
      for (const lang of ['id', 'en'] as const) {
        expect(renderMessage(templateFor(e, lang), { depot: 'Cikini', items: 'X' })).toContain('Cikini');
      }
    }
    expect(destinationFor(NotificationEvent.VISIT_FINDING, { visitId: VISIT })).toBe(`/dashboard/visits/detail?id=${VISIT}`);
    expect(destinationFor(NotificationEvent.VISIT_FINDING, { visitId: 'not-a-uuid' })).toBe('/dashboard/visits/detail');
    expect(destinationFor(NotificationEvent.FOLLOW_UP_OVERDUE, { depotId: DEPOT })).toBe(`/dashboard/visits?depot=${DEPOT}`);
    expect(destinationFor(NotificationEvent.FOLLOW_UP_OVERDUE, {})).toBe('/dashboard/visits');
  });
});

describe('VisitNoticeController', () => {
  it('hands the body to the service, and is open to the internal key only', async () => {
    const run = jest.fn(async () => ({ recipients: 1, notified: 1 }));
    const controller = new VisitNoticeController({ run } as never);
    const dto = { kind: 'OVERDUE', depotId: DEPOT, depotName: 'Cikini', dateKey: '2026-11-26', items: ['x'] } as VisitNoticeDto;
    await expect(controller.visitNotice(dto)).resolves.toEqual({ recipients: 1, notified: 1 });
    const handler = VisitNoticeController.prototype.visitNotice;
    expect(Reflect.getMetadata('path', handler)).toBe('internal/visit-notice');
    expect(Reflect.getMetadata('__guards__', handler).map((g: { name: string }) => g.name)).toEqual(['InternalAuthGuard']);
  });

  it('validates the body', async () => {
    const ok = { kind: 'FINDING', depotId: DEPOT, depotName: 'Cikini', visitId: VISIT, dateKey: '2026-11-26', items: ['x'] };
    expect(await validate(plainToInstance(VisitNoticeDto, ok))).toEqual([]);
    for (const bad of [
      { ...ok, kind: 'OTHER' },
      { ...ok, depotId: 'nope' },
      { ...ok, dateKey: '26-11-2026' },
      { ...ok, items: Array.from({ length: 31 }, () => 'x') },
      { ...ok, items: ['x'.repeat(201)] },
      { ...ok, depotName: '' },
    ]) {
      expect((await validate(plainToInstance(VisitNoticeDto, bad))).length).toBeGreaterThan(0);
    }
  });
});
