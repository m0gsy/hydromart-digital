import { CrmConfigService } from '../../src/config/crm-config.service';
import { SegmentUnavailableError } from '../../src/domain/errors';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';
import { ActivitySegmentHttpAdapter } from '../../src/infrastructure/http/activity-segment.http.adapter';
import { NotificationPreferenceHttpAdapter } from '../../src/infrastructure/http/notification-preference.http.adapter';
import { DepotStaffHttpAdapter } from '../../src/infrastructure/http/depot-staff.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, query-string segment, authorization
// header, res.ok branch, fail-CLOSED catch, response parsing) against a mocked global.fetch —
// the unit the e2e's Fake* stand-ins never run. No network, no DB.

function makeConfig(over: Partial<Record<string, unknown>> = {}): CrmConfigService {
  return {
    customerServiceUrl: 'http://customer:3002',
    ...over,
  } as unknown as CrmConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown; throwJson?: boolean }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => {
      if (init.throwJson) throw new Error('bad json');
      return init.body ?? {};
    },
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const AUTH = 'Bearer staff-token';

describe('CustomerDirectoryHttpAdapter', () => {
  it('fails closed when customer-service url is not configured', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig({ customerServiceUrl: '' })).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the caller token is missing', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, ''),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the audience (no filter -> no query string) forwarding the bearer token', async () => {
    const recipients = [{ customerId: 'c1', name: 'Ani', phone: '0811' }];
    fetchMock.mockResolvedValue(res({ body: recipients }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH);
    expect(out).toEqual(recipients);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: AUTH }) }),
    );
  });

  it('builds the tier + city segment query string', async () => {
    fetchMock.mockResolvedValue(res({ body: [] }));
    await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment(
      { tier: 'GOLD', city: 'Jakarta Selatan' },
      AUTH,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory?tier=GOLD&city=Jakarta+Selatan',
      expect.anything(),
    );
  });

  it('fails closed on non-2xx (never sends to a silently-empty audience)', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });

  it('fails closed when customer-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });
});

/*
 * The service-auth twin. A depot manager holds `depotCampaign`, not the head-office right
 * to page the customer directory, so their token cannot be the one that opens it — the
 * internal key is. Same query, same fail-closed branches, different door.
 */
describe('CustomerDirectoryHttpAdapter as a service', () => {
  it('fails closed when the internal key is not configured', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' })).resolveSegmentAsService({}),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the internal route under the internal key, with the same filter', async () => {
    const recipients = [{ customerId: 'c1', name: 'Ani', phone: '0811' }];
    fetchMock.mockResolvedValue(res({ body: recipients }));
    const out = await new CustomerDirectoryHttpAdapter(
      makeConfig({ internalServiceKey: 'k' }),
    ).resolveSegmentAsService({ tier: 'GOLD' });
    expect(out).toEqual(recipients);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://customer:3002/api/v1/profile/internal/directory?tier=GOLD');
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });
});

/*
 * The activity half of a segment. Every branch here is a fail-CLOSED one on purpose: a
 * campaign whose audience could not be resolved must be refused, because the alternative
 * — carrying on with whatever the directory returned — sends to a WIDER audience than the
 * one the screen sized. `truncated` is the subtle one: the response is a valid 200 with a
 * real list, and taking it at face value under-sends while reporting success.
 */
describe('ActivitySegmentHttpAdapter', () => {
  const activityConfig = (over: Partial<Record<string, unknown>> = {}): CrmConfigService =>
    ({ orderServiceUrl: 'http://order:3003', internalServiceKey: 'k', ...over }) as unknown as CrmConfigService;

  it.each([
    ['order-service url is not configured', { orderServiceUrl: '' }],
    ['the internal key is not configured', { internalServiceKey: '' }],
  ])('fails closed when %s', async (_case, over) => {
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig(over)).customersIn({ lapsedDays: 60 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends every condition as a query param under the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1', 'c2'], truncated: false } }));
    const out = await new ActivitySegmentHttpAdapter(activityConfig()).customersIn({
      lapsedDays: 60,
      depotId: 'depot-1',
    });
    expect(out).toEqual(['c1', 'c2']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/reports/internal/segment-customers?');
    expect(url).toContain('lapsedDays=60');
    expect(url).toContain('depotId=depot-1');
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  it('refuses a truncated segment instead of broadcasting to part of it', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1'], truncated: true } }));
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig()).customersIn({ minOrders: 1 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });

  it.each([
    ['a non-2xx answer', () => fetchMock.mockResolvedValue(res({ ok: false, status: 503 }))],
    ['a network error', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('fails closed on %s', async (_case, arrange) => {
    arrange();
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig()).customersIn({ minOrders: 1 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });
});

/**
 * F1: this one FAILS OPEN, which is the opposite of its two neighbours above, so the
 * tests are mostly about that. A segment that fails closed loses a campaign nobody has
 * sent yet; a preference that fails closed silently swallows the order-status push
 * somebody is waiting on. Only an explicit `push: false` may mute.
 */
describe('NotificationPreferenceHttpAdapter', () => {
  const adapter = (over: Partial<Record<string, unknown>> = {}) =>
    new NotificationPreferenceHttpAdapter(
      makeConfig({ internalServiceKey: 'k', ...over }),
    );

  it('returns the stored preference when the read succeeds', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerId: 'c1', push: false } }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(false);
  });

  it('allows when the customer left push on', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerId: 'c1', push: true } }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });

  /*
   * K5.3. Same row, same request — the language rides along with the push preference
   * rather than opening a second endpoint or keeping a second copy of it here. It fails
   * open the same way, to Indonesian: an unreadable preference must cost a reader their
   * language, never the message.
   */
  it('returns the stored language', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerId: 'c1', locale: 'en' } }));
    await expect(adapter().localeFor('c1')).resolves.toBe('en');
  });

  it.each([
    ['a language crm holds no templates for', { locale: 'jv' }],
    ['a row written before the column existed', { push: true }],
  ])('falls back to Indonesian for %s', async (_case, body) => {
    fetchMock.mockResolvedValue(res({ body }));
    await expect(adapter().localeFor('c1')).resolves.toBe('id');
  });

  it('falls back to Indonesian when customer-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter().localeFor('c1')).resolves.toBe('id');
  });

  it('sends the internal key and the customer id, on customer-service', async () => {
    fetchMock.mockResolvedValue(res({ body: { push: true } }));
    await adapter().pushAllowed('c 1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://customer:3002/api/v1/profile/internal/notifications?customerId=c%201');
    expect((init as RequestInit).headers).toMatchObject({ 'x-internal-key': 'k' });
  });

  it('allows when the URL is not configured', async () => {
    await expect(adapter({ customerServiceUrl: '' }).pushAllowed('c1')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows when the internal key is not configured', async () => {
    await expect(adapter({ internalServiceKey: '' }).pushAllowed('c1')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows on a non-2xx answer', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });

  it('allows when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });

  it('allows on a body it cannot read — that is an outage, not a decision', async () => {
    fetchMock.mockResolvedValue(res({ throwJson: true }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });

  it('allows on a body with no push field at all', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });
});

/**
 * F1b: the same endpoint answers the marketing question. `categories.marketing` is an
 * OPT-OUT — absent means never asked, and this repo treats never asked as sendable. Only
 * an explicit `false` refuses.
 */
describe('NotificationPreferenceHttpAdapter · marketingAllowed', () => {
  const adapter = () => new NotificationPreferenceHttpAdapter(makeConfig({ internalServiceKey: 'k' }));

  it('refuses only on an explicit false', async () => {
    fetchMock.mockResolvedValue(res({ body: { categories: { marketing: false } } }));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(false);
  });

  it('allows when the customer switched it on', async () => {
    fetchMock.mockResolvedValue(res({ body: { categories: { marketing: true } } }));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(true);
  });

  it('allows when the customer was never asked — no key', async () => {
    fetchMock.mockResolvedValue(res({ body: { categories: {} } }));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(true);
  });

  it('allows when the customer was never asked — no preferences at all', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(true);
  });

  it('allows when the read fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(true);
  });

  it('does not confuse the push switch with the marketing one', async () => {
    fetchMock.mockResolvedValue(res({ body: { push: false, categories: { marketing: true } } }));
    await expect(adapter().marketingAllowed('c1')).resolves.toBe(true);
    fetchMock.mockResolvedValue(res({ body: { push: true, categories: { marketing: false } } }));
    await expect(adapter().pushAllowed('c1')).resolves.toBe(true);
  });
});

/*
 * F8. The roster lives in auth-service and stays there — crm growing its own depot-to-staff
 * map would be a second copy that drifts the first time somebody changes depots.
 *
 * FAILS SOFT and says why: the ops feed row is already written by the time this runs, so an
 * outage costs a push and never the alert. What it must not do is fail soft SILENTLY, or a
 * misconfigured URL looks exactly like a depot with nobody rostered.
 */
describe('DepotStaffHttpAdapter', () => {
  const cfg = (over: Record<string, unknown> = {}) =>
    ({
      authServiceUrl: 'http://auth.test',
      internalServiceKey: 'k',
      ...over,
    }) as never;

  it('returns the ids auth-service reports', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ids: ['s-1', 's-2'] }) } as never);
    expect(await new DepotStaffHttpAdapter(cfg()).staffIdsForDepot('d-1')).toEqual(['s-1', 's-2']);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toContain('/auth/internal/staff/depot/d-1');
    expect((init as RequestInit).headers).toMatchObject({ 'x-internal-key': 'k' });
  });

  it('answers empty, not undefined, when the key is missing', async () => {
    expect(await new DepotStaffHttpAdapter(cfg({ internalServiceKey: '' })).staffIdsForDepot('d-1')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers empty on a refusal', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as never);
    expect(await new DepotStaffHttpAdapter(cfg()).staffIdsForDepot('d-1')).toEqual([]);
  });

  it('answers empty when auth-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await new DepotStaffHttpAdapter(cfg()).staffIdsForDepot('d-1')).toEqual([]);
  });

  it('drops anything in the list that is not an id', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ids: ['s-1', 7, null] }) } as never);
    expect(await new DepotStaffHttpAdapter(cfg()).staffIdsForDepot('d-1')).toEqual(['s-1']);
  });
});

describe('DepotStaffHttpAdapter — a body that is not the shape it promised', () => {
  it('answers empty when auth-service returns no list at all', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
    const cfg = { authServiceUrl: 'http://auth.test', internalServiceKey: 'k' } as never;
    expect(await new DepotStaffHttpAdapter(cfg).staffIdsForDepot('d-1')).toEqual([]);
  });
});
