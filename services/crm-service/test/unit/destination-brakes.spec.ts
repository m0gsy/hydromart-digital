import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { PushPayload } from '../../src/application/ports/push-sender.port';
import { DestinationBrakesPort } from '../../src/application/ports/destination-brakes.port';
import { CrmConfigService } from '../../src/config/crm-config.service';
import { NotificationEvent } from '../../src/domain/notification-event';
import {
  DestinationBrakesHttpAdapter,
  LEAVE_SCREEN_FLAG,
} from '../../src/infrastructure/http/destination-brakes.http.adapter';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * Flow 6a, owner decision 2026-11-19: a destination the installed Ops APK (<= v1.15.0) cannot
 * open is held behind a brake, read FAIL-CLOSED. /hr/leave is that destination.
 */

const config = (adminServiceUrl?: string) => ({ adminServiceUrl }) as unknown as CrmConfigService;
const answer = (body: unknown, ok = true) =>
  jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body });

describe('DestinationBrakesHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('is released only by the public route saying the key is enabled', async () => {
    global.fetch = answer([{ key: LEAVE_SCREEN_FLAG, enabled: true }]) as never;
    expect(await new DestinationBrakesHttpAdapter(config('http://admin')).leaveScreenLive()).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('http://admin/api/v1/feature-flags/public', expect.anything());
  });

  it.each([
    ['disabled', answer([{ key: LEAVE_SCREEN_FLAG, enabled: false }])],
    ['not listed', answer([{ key: 'subscriptions.galon', enabled: true }])],
    ['not a list', answer({ enabled: true })],
    ['refused', answer([{ key: LEAVE_SCREEN_FLAG, enabled: true }], false)],
    ['unreachable', jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('holds the brake when the flag is %s', async (_why, fetchMock) => {
    global.fetch = fetchMock as never;
    expect(await new DestinationBrakesHttpAdapter(config('http://admin')).leaveScreenLive()).toBe(false);
  });

  it('holds the brake without asking when admin-service is not configured', async () => {
    global.fetch = jest.fn() as never;
    expect(await new DestinationBrakesHttpAdapter(config(undefined)).leaveScreenLive()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shares one read between a burst on an expired cache', async () => {
    let release!: (v: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    ) as never;
    const brakes = new DestinationBrakesHttpAdapter(config('http://admin'));
    const burst = Promise.all([brakes.leaveScreenLive(), brakes.leaveScreenLive(), brakes.leaveScreenLive()]);
    release({ ok: true, status: 200, json: async () => [{ key: LEAVE_SCREEN_FLAG, enabled: true }] });
    expect(await burst).toEqual([true, true, true]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks once a minute, not once per notification', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    global.fetch = answer([{ key: LEAVE_SCREEN_FLAG, enabled: true }]) as never;
    const brakes = new DestinationBrakesHttpAdapter(config('http://admin'));
    await brakes.leaveScreenLive();
    await brakes.leaveScreenLive();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(DestinationBrakesHttpAdapter.TTL_MS + 1);
    await brakes.leaveScreenLive();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('NotificationService · LEAVE_SUBMITTED destination', () => {
  const pushes = () => {
    const payloads: PushPayload[] = [];
    const push = {
      sendToCustomer: async (_id: string, payload: PushPayload) => {
        payloads.push(payload);
      },
    } as unknown as PushService;
    return { payloads, push };
  };
  const brakes = (live: boolean) => ({ leaveScreenLive: jest.fn().mockResolvedValue(live) }) as DestinationBrakesPort & {
    leaveScreenLive: jest.Mock;
  };
  const send = async (service: NotificationService, event = NotificationEvent.LEAVE_SUBMITTED) => {
    const row = await service.notify(event, '+62811', { name: 'Budi', leaveId: 'l-1' }, 'acc-1');
    await new Promise((r) => setImmediate(r));
    return row;
  };

  it('opens the leave request once the brake is released', async () => {
    const { payloads, push } = pushes();
    const service = new NotificationService(
      new InMemoryNotificationRepository(), push, undefined, undefined, undefined, undefined, brakes(true),
    );
    const row = await send(service);
    expect(row.destination).toBe('/hr/leave?id=l-1');
    expect(payloads[0]?.url).toBe('/hr/leave?id=l-1');
  });

  it.each([
    ['held', brakes(false)],
    ['not wired', undefined],
  ])('stays on the inbox while the brake is %s', async (_why, port) => {
    const { payloads, push } = pushes();
    const service = new NotificationService(
      new InMemoryNotificationRepository(), push, undefined, undefined, undefined, undefined, port,
    );
    const row = await send(service);
    expect(row.destination).toBeNull();
    expect(payloads[0]?.url).toBe('/notifications');
  });

  it('does not read the brake for any other event', async () => {
    const port = brakes(true);
    const { push } = pushes();
    const service = new NotificationService(
      new InMemoryNotificationRepository(), push, undefined, undefined, undefined, undefined, port,
    );
    const row = await send(service, NotificationEvent.LEAVE_APPROVED);
    expect(row.destination).toBe('/hr/me/leave?id=l-1');
    expect(port.leaveScreenLive).not.toHaveBeenCalled();
  });
});
