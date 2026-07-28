import {
  DataSubjectRequestAlreadyDecidedError,
  DataSubjectRequestNotFoundError,
  DuplicateDataSubjectRequestError,
} from '../../src/domain/errors/auth.errors';
import {
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../../src/domain/data-subject/data-subject-request';
import { DataSubjectService } from '../../src/application/services/data-subject.service';

const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';

/** In-memory queue mirroring the Prisma repo, including its PENDING-only decide guard. */
class FakeRequestRepo {
  rows: DataSubjectRequestRecord[] = [];
  anonymised: string[] = [];
  private seq = 0;

  async create(data: { customerId: string; type: DataSubjectRequestType; reason: string | null }) {
    const row: DataSubjectRequestRecord = {
      id: `req-${++this.seq}`,
      customerId: data.customerId,
      type: data.type,
      status: 'PENDING',
      reason: data.reason,
      requestedAt: new Date('2026-07-29T00:00:00.000Z'),
      processedBy: null,
      processedAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async findById(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
  async listByCustomer(customerId: string) {
    return this.rows.filter((r) => r.customerId === customerId).map((r) => ({ ...r }));
  }
  async findOpen(customerId: string, type: DataSubjectRequestType) {
    const row = this.rows.find(
      (r) => r.customerId === customerId && r.type === type && r.status === 'PENDING',
    );
    return row ? { ...row } : null;
  }
  async listForStaff(status?: DataSubjectRequestStatus) {
    return this.rows.filter((r) => !status || r.status === status).map((r) => ({ ...r }));
  }
  async decide(data: {
    id: string;
    status: Exclude<DataSubjectRequestStatus, 'PENDING'>;
    processedBy: string;
    reason: string | null;
  }) {
    const row = this.rows.find((r) => r.id === data.id && r.status === 'PENDING');
    if (!row) throw new Error('not pending');
    row.status = data.status;
    row.processedBy = data.processedBy;
    row.processedAt = new Date('2026-07-29T01:00:00.000Z');
    if (data.reason !== null) row.reason = data.reason;
    return { ...row };
  }
  async anonymiseCustomer(customerId: string) {
    this.anonymised.push(customerId);
  }
}

describe('DataSubjectService (UU PDP tahap 1)', () => {
  let requests: FakeRequestRepo;
  let customerData: { export: jest.Mock; anonymise: jest.Mock };
  let audit: { record: jest.Mock };
  let customers: { findById: jest.Mock };
  let service: DataSubjectService;

  beforeEach(() => {
    requests = new FakeRequestRepo();
    customerData = { export: jest.fn(async () => ({ addresses: [] })), anonymise: jest.fn() };
    audit = { record: jest.fn() };
    customers = {
      findById: jest.fn(async () => ({
        id: CUSTOMER,
        phone: '+628111',
        email: 'a@b.c',
        fullName: 'Budi',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    };
    service = new DataSubjectService(
      requests as never,
      customers as never,
      customerData as never,
      audit as never,
    );
  });

  it('refuses a second open request of the same type', async () => {
    await service.request(CUSTOMER, 'DELETE', 'ganti nomor');
    await expect(service.request(CUSTOMER, 'DELETE', null)).rejects.toBeInstanceOf(
      DuplicateDataSubjectRequestError,
    );
    // A different right is still allowed while the first is open.
    await expect(service.request(CUSTOMER, 'EXPORT', null)).resolves.toMatchObject({
      type: 'EXPORT',
    });
  });

  it('approving an EXPORT returns the payload and never anonymises anything', async () => {
    const created = await service.request(CUSTOMER, 'EXPORT', null);

    const result = await service.approve(created.id, STAFF);

    expect(result.request.status).toBe('COMPLETED');
    expect(result.request.processedBy).toBe(STAFF);
    expect(result.export?.account).toMatchObject({ fullName: 'Budi' });
    expect(result.export?.customer).toEqual({ addresses: [] });
    // Financial history is out of scope for tahap 1 and the payload says so.
    expect(result.export?.notIncluded.length).toBeGreaterThan(0);
    expect(requests.anonymised).toEqual([]);
    expect(customerData.anonymise).not.toHaveBeenCalled();
  });

  it('approving a DELETE scrubs both services before closing the request', async () => {
    const created = await service.request(CUSTOMER, 'DELETE', null);

    const result = await service.approve(created.id, STAFF);

    expect(customerData.anonymise).toHaveBeenCalledWith(CUSTOMER);
    expect(requests.anonymised).toEqual([CUSTOMER]);
    expect(result.request.status).toBe('COMPLETED');
    expect(result.export).toBeUndefined();
  });

  it('leaves the request PENDING when the downstream scrub fails, so it can be retried', async () => {
    const created = await service.request(CUSTOMER, 'DELETE', null);
    customerData.anonymise.mockRejectedValueOnce(new Error('customer-service unreachable'));

    await expect(service.approve(created.id, STAFF)).rejects.toThrow('customer-service unreachable');

    expect((await requests.findById(created.id))?.status).toBe('PENDING');
    expect(requests.anonymised).toEqual([]);
  });

  it('an export whose downstream is down says so instead of looking complete', async () => {
    customerData.export.mockRejectedValueOnce(new Error('boom'));
    const created = await service.request(CUSTOMER, 'EXPORT', null);

    const result = await service.approve(created.id, STAFF);

    expect(result.export?.customer).toMatchObject({ error: expect.stringContaining('unreachable') });
  });

  it('refuses to decide the same request twice', async () => {
    const created = await service.request(CUSTOMER, 'EXPORT', null);
    await service.approve(created.id, STAFF);

    await expect(service.approve(created.id, STAFF)).rejects.toBeInstanceOf(
      DataSubjectRequestAlreadyDecidedError,
    );
    await expect(service.reject(created.id, STAFF, 'nope')).rejects.toBeInstanceOf(
      DataSubjectRequestAlreadyDecidedError,
    );
  });

  it('rejecting records the reason the customer will read', async () => {
    const created = await service.request(CUSTOMER, 'DELETE', null);

    const rejected = await service.reject(created.id, STAFF, 'Identitas belum terverifikasi');

    expect(rejected).toMatchObject({
      status: 'REJECTED',
      reason: 'Identitas belum terverifikasi',
      processedBy: STAFF,
    });
  });

  it('reports a missing request rather than pretending it decided one', async () => {
    await expect(service.approve('req-none', STAFF)).rejects.toBeInstanceOf(
      DataSubjectRequestNotFoundError,
    );
  });

  it('lists only the caller’s own requests', async () => {
    await service.request(CUSTOMER, 'EXPORT', null);
    await service.request('33333333-3333-3333-3333-333333333333', 'EXPORT', null);

    expect(await service.listMine(CUSTOMER)).toHaveLength(1);
    expect(await service.listForStaff('PENDING')).toHaveLength(2);
  });

  it('exports on demand for the customer without a queue entry', async () => {
    const payload = await service.exportFor(CUSTOMER);
    expect(payload.account).toMatchObject({ id: CUSTOMER });
    expect(customers.findById).toHaveBeenCalledWith(CUSTOMER);
  });

  it('an export for an unknown account yields an empty account block, not a crash', async () => {
    customers.findById.mockResolvedValueOnce(null);
    expect((await service.exportFor(CUSTOMER)).account).toEqual({});
  });
});
