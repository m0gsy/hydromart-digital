import { DataSubjectController } from '../../src/modules/auth/data-subject.controller';
import { DataSubjectRequestPrismaRepository } from '../../src/infrastructure/prisma/repositories/data-subject-request.prisma.repository';
import { CustomerDataHttpAdapter } from '../../src/infrastructure/http/customer-data.http.adapter';
import { RemoteErasureExecutor } from '../../src/infrastructure/http/remote-erasure.executor';
import { UnenforcedErasure } from '../../src/infrastructure/http/unenforced-erasure.executor';
import {
  anonymisedIdentity,
  isDecidable,
} from '../../src/domain/data-subject/data-subject-request';
import { isConsentPurpose } from '../../src/domain/data-subject/consent';
import { ConsentPrismaRepository } from '../../src/infrastructure/prisma/repositories/consent.prisma.repository';

const USER = { sub: 'cust-1' } as never;

describe('DataSubjectController (delegation)', () => {
  const row = {
    id: 'req-1',
    customerId: 'cust-1',
    type: 'EXPORT' as const,
    status: 'PENDING' as const,
    reason: null,
    requestedAt: new Date('2026-07-29T00:00:00.000Z'),
    processedBy: null,
    processedAt: null,
  };
  const service = {
    request: jest.fn(async () => row),
    listMine: jest.fn(async () => [row]),
    listForStaff: jest.fn(async () => [row]),
    exportFor: jest.fn(async () => ({
      exportedAt: 'now',
      account: {},
      customer: {},
      notIncluded: [],
    })),
    approve: jest.fn(async () => ({ request: { ...row, status: 'COMPLETED' as const } })),
    reject: jest.fn(async () => ({ ...row, status: 'REJECTED' as const, reason: 'no' })),
  };
  const ctrl = new DataSubjectController(service as never);
  beforeEach(() => jest.clearAllMocks());

  it('create() scopes the request to the caller and maps the dates to ISO', async () => {
    const out = await ctrl.create(USER, { type: 'EXPORT' } as never);
    expect(service.request).toHaveBeenCalledWith('cust-1', 'EXPORT', null);
    expect(out.requestedAt).toBe('2026-07-29T00:00:00.000Z');
    expect(out.processedAt).toBeNull();
  });

  it('create() passes an explicit reason through', async () => {
    await ctrl.create(USER, { type: 'DELETE', reason: 'pindah kota' } as never);
    expect(service.request).toHaveBeenCalledWith('cust-1', 'DELETE', 'pindah kota');
  });

  it('mine() lists the caller’s own rows', async () => {
    expect(await ctrl.mine(USER)).toHaveLength(1);
    expect(service.listMine).toHaveBeenCalledWith('cust-1');
  });

  it('queue() accepts only the three real statuses and drops anything else', async () => {
    await ctrl.queue('PENDING');
    expect(service.listForStaff).toHaveBeenCalledWith('PENDING');
    await ctrl.queue('garbage');
    expect(service.listForStaff).toHaveBeenLastCalledWith(undefined);
    await ctrl.queue();
    expect(service.listForStaff).toHaveBeenLastCalledWith(undefined);
  });

  it('approve() omits the export key entirely for a DELETE', async () => {
    const out = await ctrl.approve({ sub: 'staff-1' } as never, 'req-1');
    expect(service.approve).toHaveBeenCalledWith('req-1', 'staff-1');
    expect(out.request.status).toBe('COMPLETED');
    expect('export' in out).toBe(false);
  });

  it('approve() carries the payload back for an EXPORT', async () => {
    service.approve.mockResolvedValueOnce({
      request: { ...row, status: 'COMPLETED' as const },
      export: { exportedAt: 'now', account: { id: 'cust-1' }, customer: {}, notIncluded: [] },
    } as never);
    const out = await ctrl.approve({ sub: 'staff-1' } as never, 'req-1');
    expect(out.export?.account).toEqual({ id: 'cust-1' });
  });

  it('reject() forwards the reason', async () => {
    const out = await ctrl.reject({ sub: 'staff-1' } as never, 'req-1', { reason: 'no' } as never);
    expect(service.reject).toHaveBeenCalledWith('req-1', 'staff-1', 'no');
    expect(out.status).toBe('REJECTED');
  });

  it('export() builds the payload for the caller', async () => {
    await ctrl.export(USER);
    expect(service.exportFor).toHaveBeenCalledWith('cust-1');
  });
});

describe('data-subject domain rules', () => {
  it('only a PENDING request is decidable', () => {
    const base = { status: 'PENDING' } as never;
    expect(isDecidable(base)).toBe(true);
    expect(isDecidable({ status: 'COMPLETED' } as never)).toBe(false);
    expect(isDecidable({ status: 'REJECTED' } as never)).toBe(false);
  });

  it('the tombstone keeps the phone UNIQUE constraint satisfiable', () => {
    expect(anonymisedIdentity('abc')).toEqual({
      phone: 'deleted-abc',
      email: null,
      fullName: 'Pengguna dihapus',
      avatarUrl: null,
      googleSub: null,
    });
  });
});

describe('DataSubjectRequestPrismaRepository', () => {
  const dataSubjectRequest = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const customer = { update: jest.fn() };
  const refreshToken = { deleteMany: jest.fn() };
  const $transaction = jest.fn(async (ops: unknown) => ops);
  const repo = new DataSubjectRequestPrismaRepository({
    dataSubjectRequest,
    customer,
    refreshToken,
    $transaction,
  } as never);

  const row = {
    id: 'req-1',
    customerId: 'cust-1',
    type: 'DELETE',
    status: 'PENDING',
    reason: null,
    requestedAt: new Date('2026-07-29T00:00:00.000Z'),
    processedBy: null,
    processedAt: null,
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and narrows the TEXT columns back to the union types', async () => {
    dataSubjectRequest.create.mockResolvedValue(row);
    const out = await repo.create({ customerId: 'cust-1', type: 'DELETE', reason: null });
    expect(out.type).toBe('DELETE');
    expect(out.status).toBe('PENDING');
  });

  it('findById returns null on a miss', async () => {
    dataSubjectRequest.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
    dataSubjectRequest.findUnique.mockResolvedValue(row);
    expect(await repo.findById('req-1')).toMatchObject({ id: 'req-1' });
  });

  it('findOpen looks only for a PENDING row of that type', async () => {
    dataSubjectRequest.findFirst.mockResolvedValue(null);
    expect(await repo.findOpen('cust-1', 'EXPORT')).toBeNull();
    expect(dataSubjectRequest.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', type: 'EXPORT', status: 'PENDING' },
    });
    dataSubjectRequest.findFirst.mockResolvedValue(row);
    expect(await repo.findOpen('cust-1', 'DELETE')).toMatchObject({ status: 'PENDING' });
  });

  it('lists a customer’s own requests newest first', async () => {
    dataSubjectRequest.findMany.mockResolvedValue([row]);
    await repo.listByCustomer('cust-1');
    expect(dataSubjectRequest.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { requestedAt: 'desc' },
    });
  });

  it('the staff queue puts pending first and the longest wait first', async () => {
    dataSubjectRequest.findMany.mockResolvedValue([row]);
    await repo.listForStaff();
    expect(dataSubjectRequest.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    });
    await repo.listForStaff('COMPLETED');
    expect(dataSubjectRequest.findMany).toHaveBeenLastCalledWith({
      where: { status: 'COMPLETED' },
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    });
  });

  it('decide() guards on PENDING so two approvals cannot both win', async () => {
    dataSubjectRequest.update.mockResolvedValue({ ...row, status: 'COMPLETED' });
    await repo.decide({ id: 'req-1', status: 'COMPLETED', processedBy: 'staff-1', reason: null });
    expect(dataSubjectRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-1', status: 'PENDING' } }),
    );
    // A null reason must not overwrite the customer's own note.
    expect(dataSubjectRequest.update.mock.calls[0]?.[0].data.reason).toBeUndefined();
  });

  it('decide() stores a rejection reason when one is given', async () => {
    dataSubjectRequest.update.mockResolvedValue({ ...row, status: 'REJECTED', reason: 'no' });
    await repo.decide({ id: 'req-1', status: 'REJECTED', processedBy: 'staff-1', reason: 'no' });
    expect(dataSubjectRequest.update.mock.calls[0]?.[0].data.reason).toBe('no');
  });

  it('anonymiseCustomer destroys the identity and every session in one transaction', async () => {
    await repo.anonymiseCustomer('cust-1', anonymisedIdentity('cust-1'));
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: expect.objectContaining({ status: 'DELETED', email: null, googleSub: null }),
    });
    expect(refreshToken.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });
});

describe('CustomerDataHttpAdapter', () => {
  const configured = {
    customerData: { customerUrl: 'http://customer', internalKey: 'k' },
  } as never;
  const blank = { customerData: { customerUrl: '', internalKey: '' } } as never;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fails closed when the downstream is not configured', async () => {
    const adapter = new CustomerDataHttpAdapter(blank);
    await expect(adapter.export('cust-1')).rejects.toThrow('not configured');
    await expect(adapter.anonymise('cust-1')).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exports with the internal key and returns the parsed body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ addresses: [] }) });
    const adapter = new CustomerDataHttpAdapter(configured);

    expect(await adapter.export('cust-1')).toEqual({ addresses: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://customer/api/v1/customers/internal/pdp-export?customerId=cust-1');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('posts the customerId when anonymising', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await new CustomerDataHttpAdapter(configured).anonymise('cust-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ customerId: 'cust-1' }));
  });

  it('raises on a non-2xx rather than returning an empty export', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(new CustomerDataHttpAdapter(configured).export('cust-1')).rejects.toThrow('500');
  });

  it('raises when the call never lands', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new CustomerDataHttpAdapter(configured).anonymise('cust-1')).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});

describe('ConsentPrismaRepository', () => {
  const consentRecord = { create: jest.fn(), findMany: jest.fn() };
  const $transaction = jest.fn(async (ops: unknown) => ops);
  const repo = new ConsentPrismaRepository({ consentRecord, $transaction } as never);
  const row = {
    id: 'c-1',
    customerId: 'cust-1',
    purpose: 'MARKETING',
    granted: true,
    documentVersion: '1.0',
    source: 'account-settings',
    recordedAt: new Date('2026-07-29T00:00:00.000Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('appends one decision and narrows the TEXT purpose back to the union', async () => {
    consentRecord.create.mockResolvedValue(row);
    const out = await repo.record({
      customerId: 'cust-1',
      purpose: 'MARKETING',
      granted: true,
      documentVersion: '1.0',
      source: 'account-settings',
    });
    expect(out.purpose).toBe('MARKETING');
    expect(consentRecord.create).toHaveBeenCalledTimes(1);
  });

  it('writes a registration batch in ONE transaction so evidence is never half-written', async () => {
    consentRecord.create.mockReturnValue(row as never);
    $transaction.mockResolvedValue([row, row] as never);
    const out = await repo.recordMany([
      {
        customerId: 'cust-1',
        purpose: 'TERMS',
        granted: true,
        documentVersion: '1.0',
        source: 'registration',
      },
      {
        customerId: 'cust-1',
        purpose: 'PRIVACY',
        granted: true,
        documentVersion: '1.0',
        source: 'registration',
      },
    ]);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
  });

  it('an empty batch touches the database at all', async () => {
    expect(await repo.recordMany([])).toEqual([]);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('lists a customer history oldest-first', async () => {
    consentRecord.findMany.mockResolvedValue([row]);
    await repo.listForCustomer('cust-1');
    expect(consentRecord.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { recordedAt: 'asc' },
    });
  });
});

describe('isConsentPurpose', () => {
  it('accepts only the three known purposes', () => {
    expect(isConsentPurpose('TERMS')).toBe(true);
    expect(isConsentPurpose('MARKETING')).toBe(true);
    expect(isConsentPurpose('ANALYTICS')).toBe(false);
    expect(isConsentPurpose(null)).toBe(false);
  });
});

/*
 * RemoteErasureExecutor — the erasure half of the registry (UU PDP item 13).
 *
 * It mirrors `RemotePurgeExecutor` in admin-service down to the rule that matters: it
 * RAISES rather than answering 0. An erasure that quietly reports "nothing changed" when
 * the call never landed is indistinguishable from "there was nothing to change", and that
 * confusion is exactly what `docs/AUDIT_L3.md` §4.2 measured — 4.124 rows nobody knew were
 * still there.
 */
describe('RemoteErasureExecutor', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const subject = { customerId: 'cust-1', phone: '+628111' };
  const make = (url = 'https://crm.example.com', key = 'k') =>
    new RemoteErasureExecutor(
      'crm.messages',
      url,
      '/api/v1/notifications/internal/pdp-anonymise',
      key,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('posts the subject with the internal key and reports the rows the owner changed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ erased: 3050 }) });

    expect(await make().erase(subject)).toBe(3050);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://crm.example.com/api/v1/notifications/internal/pdp-anonymise');
    expect(init.headers['x-internal-key']).toBe('k');
    // The PHONE rides along: a campaign recipient who never registered has no id.
    expect(JSON.parse(init.body)).toEqual(subject);
  });

  it('answers null when the owner does not say how many, rather than inventing 0', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await make().erase(subject)).toBeNull();
  });

  it('survives an owner that answers with something that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });
    expect(await make().erase(subject)).toBeNull();
  });

  it('raises on a rejected call instead of reporting a silent success', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(make().erase(subject)).rejects.toThrow('crm.messages: owner responded 503');
  });

  it('raises when the owner cannot be reached at all', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(make().erase(subject)).rejects.toThrow('owner unreachable');
  });

  // `configured: false` is what puts a dataset on the UNENFORCED path rather than silently
  // succeeding — the same rule purge-executor.registry.ts follows.
  it('is unconfigured without a URL or a key', () => {
    expect(make('', 'k').configured).toBe(false);
    expect(make('https://x', '').configured).toBe(false);
    expect(make().configured).toBe(true);
  });
});

/*
 * A dataset the registry KNOWS holds this person and cannot erase yet. It exists so the gap
 * is a ROW in the coverage report with the reason and the next step, rather than an
 * omission from it — `depot.order_disputes` has no `customerId` column, so erasing by name
 * would delete other people's disputes.
 */
describe('UnenforcedErasure', () => {
  it('reports itself unconfigured, carries the reason, and touches nothing', async () => {
    const declared = new UnenforcedErasure('depot.order_disputes', 'no customerId column');
    expect(declared.configured).toBe(false);
    expect(declared.unenforcedReason).toBe('no customerId column');
    expect(await declared.erase()).toBeNull();
  });
});
