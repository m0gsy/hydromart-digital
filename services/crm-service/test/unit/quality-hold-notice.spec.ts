import { ServiceUnavailableException } from '@nestjs/common';

import { QualityHoldNoticeService } from '../../src/application/services/quality-hold-notice.service';
import { destinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent, PERSONAL_OPS_EVENTS, STAFF_TOGGLE_FOR_EVENT, renderMessage, templateFor } from '../../src/domain/notification-event';
import { qualityHoldText } from '../../src/domain/quality-hold-notice';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';
import { FakeHeldDepots } from '../support/fakes';

const D1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AT = '2026-11-27T03:15:00.000Z'; // 10:15 WIB

function build(over: { held?: boolean; known?: boolean; failHeld?: boolean; failDirectory?: boolean; failFor?: string; created?: boolean } = {}) {
  const depots = new FakeHeldDepots();
  if (over.known !== false) depots.known.set(D1, 'Cikini');
  if (over.held) depots.held.add(D1);
  depots.fail = over.failHeld ?? false;
  const notifyOnce = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, id: string) => {
    if (id === over.failFor) throw new Error('boom');
    return { record: { id: 'row' }, created: over.created ?? true };
  });
  const directory = {
    staffIdsByRoles: jest.fn(async () => {
      if (over.failDirectory) throw new Error('down');
      return ['mk1', 'mk2', 'ho1'];
    }),
    rolesOf: async (ids: readonly string[]) => new Map(ids.map((i) => [i, i === 'mk1' ? 'MARKETING' : 'HEAD_OFFICE'])),
    profileOf: jest.fn(),
  };
  const audience = { everyone: jest.fn(async () => ['k1', 'ho1']) };
  const service = new QualityHoldNoticeService({ notifyOnce } as never, audience as never, depots, directory);
  return { service, notifyOnce, directory };
}

describe('QualityHoldNoticeService', () => {
  it('tells the depot management and Marketing once each, with a per-recipient key', async () => {
    const { service, notifyOnce, directory } = build({ held: true });
    expect(await service.run(D1, 'ACTIVE', AT)).toEqual({ notified: 3 });
    expect(directory.staffIdsByRoles).toHaveBeenCalledWith(['MARKETING']);
    expect(notifyOnce.mock.calls.map((c) => c[3]).sort()).toEqual(['k1', 'ho1', 'mk1'].sort());
    const [event, phone, vars, , depot, key] = notifyOnce.mock.calls[0] as unknown as unknown[];
    expect(event).toBe(NotificationEvent.QUALITY_HOLD);
    expect(phone).toBe('');
    expect(vars).toEqual({ text: qualityHoldText('ACTIVE', 'Cikini', new Date(AT)), depotId: D1 });
    expect(depot).toBeNull();
    expect(key).toBe(`quality-hold:${D1}:ACTIVE:${AT}:k1`);
  });

  it('counts only what this call filed', async () => {
    const { service } = build({ held: false, created: false });
    expect(await service.run(D1, 'ENDED', AT)).toEqual({ notified: 0 });
  });

  it('answers stale, and tells no one, when the live state disagrees or the depot is unknown', async () => {
    for (const [status, over] of [['ACTIVE', { held: false }], ['ENDED', { held: true }], ['ACTIVE', { known: false }]] as const) {
      const { service, notifyOnce } = build(over);
      expect(await service.run(D1, status, AT)).toEqual({ notified: 0, stale: true });
      expect(notifyOnce).not.toHaveBeenCalled();
    }
  });

  it('answers 503 when the depot directory, the recipients or a recipient cannot be read or told', async () => {
    await expect(build({ failHeld: true }).service.run(D1, 'ENDED', AT)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ held: true, failDirectory: true }).service.run(D1, 'ACTIVE', AT)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ held: true, failFor: 'k1' }).service.run(D1, 'ACTIVE', AT)).rejects.toThrow('1 recipient(s)');
  });
});

describe('quality hold copy and wiring', () => {
  it('writes the staff words in WIB with no reason or lab detail', () => {
    expect(qualityHoldText('ACTIVE', 'Cikini', new Date(AT))).toBe(
      'Depot Cikini sedang quality hold sejak 10:15 WIB. Pesanan online, pengingat, kampanye, dan penjualan kasir depot ini berhenti sampai HQ Operasional mengakhirinya.',
    );
    expect(qualityHoldText('ENDED', 'Cikini', new Date('2026-11-27T17:05:00.000Z'))).toBe(
      'Quality hold depot Cikini sudah selesai (00:05 WIB). Depot melayani lagi.',
    );
  });

  it('is a personal staff event with a switch, a tap to the depot quality card and the same text in both languages', () => {
    expect(PERSONAL_OPS_EVENTS).toContain(NotificationEvent.QUALITY_HOLD);
    expect(STAFF_TOGGLE_FOR_EVENT[NotificationEvent.QUALITY_HOLD]).toBe('maintenanceDue');
    expect(destinationFor(NotificationEvent.QUALITY_HOLD, { depotId: D1 })).toContain('/dashboard/quality');
    for (const locale of ['id', 'en'] as const) {
      expect(renderMessage(templateFor(NotificationEvent.QUALITY_HOLD, locale), { text: 'X' })).toBe('X');
    }
  });

  it('hands the controller body to the service with the depot id in one spelling', async () => {
    const run = jest.fn(async () => ({ notified: 1 }));
    const controller = new NotificationExternalController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { run } as never);
    await controller.qualityHoldRun({ holdDepotId: D1.toUpperCase(), status: 'ACTIVE', changedAt: AT });
    expect(run).toHaveBeenCalledWith(D1, 'ACTIVE', AT);
  });
});
