import { BadRequestException } from '@nestjs/common';

import {
  CustomerNotFoundError,
  DataExportApprovalExpiredError,
  DataExportNotApprovedError,
  DataSubjectRequestAlreadyDecidedError,
  DataSubjectRequestNotFoundError,
  AccountHasOpenOrdersError,
  DuplicateDataSubjectRequestError,
} from '../../src/domain/errors/auth.errors';
import {
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../../src/domain/data-subject/data-subject-request';
import { ConsentService } from '../../src/application/services/consent.service';
import { DataSubjectService } from '../../src/application/services/data-subject.service';
import { InMemoryConsentRepository } from '../support/fakes';

const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
/** A customer who asked to be deleted, then was hired: the queue holds a staff login now. */
const STAFF_REQUESTER = '44444444-4444-4444-8444-444444444444';

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
      (r) =>
        r.customerId === customerId &&
        r.type === type &&
        (r.status === 'PENDING' || r.status === 'IN_PROGRESS'),
    );
    return row ? { ...row } : null;
  }
  async listForStaff(status?: DataSubjectRequestStatus) {
    return this.rows.filter((r) => !status || r.status === status).map((r) => ({ ...r }));
  }
  async release(id: string, staffId: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.status === 'IN_PROGRESS' && row.processedBy === staffId) {
      row.status = 'PENDING';
      row.processedBy = null;
    }
  }
  claimedAt = new Map<string, number>();
  async claim(id: string, staffId: string, now: Date, staleAfterMs: number) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    const stale =
      row.status === 'IN_PROGRESS' && now.getTime() - (this.claimedAt.get(id) ?? 0) > staleAfterMs;
    if (row.status !== 'PENDING' && !stale) return false;
    row.status = 'IN_PROGRESS';
    row.processedBy = staffId;
    this.claimedAt.set(id, now.getTime());
    return true;
  }
  async decide(data: {
    id: string;
    status: Exclude<DataSubjectRequestStatus, 'PENDING' | 'IN_PROGRESS'>;
    processedBy: string;
    reason: string | null;
    from?: 'PENDING' | 'IN_PROGRESS';
  }) {
    const row = this.rows.find((r) => r.id === data.id && r.status === (data.from ?? 'PENDING'));
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
  let customers: { findById: jest.Mock; findByIds: jest.Mock };
  let service: DataSubjectService;

  beforeEach(() => {
    requests = new FakeRequestRepo();
    customerData = { export: jest.fn(async () => ({ addresses: [] })), anonymise: jest.fn() };
    audit = { record: jest.fn() };
    customers = {
      // §G-3: the staff queue names whoever raised each request.
      findByIds: jest.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          fullName: id === CUSTOMER ? 'Budi' : null,
          role: id === STAFF_REQUESTER ? 'STAFF_DEPOT' : 'CUSTOMER',
          status: 'ACTIVE',
        })),
      ),
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
      new ConsentService(new InMemoryConsentRepository()),
    );
  });

  // HQ deleting a staff account: the same machinery, a different trigger. Every guard here
  // exists because the action cannot be undone.
  describe('deleteStaffAccount', () => {
    const ACTOR = '99999999-9999-4999-8999-999999999999';
    const TARGET = '11111111-1111-4111-8111-111111111111';

    function makeService(overrides: {
      role?: string;
      superAdminTotal?: number;
      hr?: { anonymiseEmployee: jest.Mock };
      ownedDepots?: { countOwned: jest.Mock };
    }) {
      const saved: { id: string; status: string }[] = [];
      const makeRow = (id: string) => {
        const row = { id, role: overrides.role ?? 'KEPALA_DEPOT', status: 'ACTIVE' };
        return {
          ...row,
          markDeleted: () => void (row.status = 'DELETED'),
          get status() {
            return row.status;
          },
        };
      };
      // B-4: the guard and the write are ONE repository call now, so the fake decides both
      // together — which is the whole point, and what a `listStaff` count could not express.
      const superAdmins = overrides.superAdminTotal ?? 3;
      const repo = {
        findById: jest.fn(async (id: string) => makeRow(id)),
        listStaff: jest.fn(async () => ({ items: [], total: superAdmins })),
        markDeletedGuardingLastSuperAdmin: jest.fn(async (id: string) => {
          if ((overrides.role ?? 'KEPALA_DEPOT') === 'SUPER_ADMIN' && superAdmins <= 1) {
            return 'last-super-admin' as const;
          }
          saved.push({ id, status: 'DELETED' });
          return 'deleted' as const;
        }),
        save: jest.fn(async (c: { id: string; status: string }) => {
          saved.push({ id: c.id, status: c.status });
          return c;
        }),
      };
      return {
        repo,
        saved,
        svc: new DataSubjectService(
          requests as never,
          repo as never,
          customerData as never,
          audit as never,
          new ConsentService(new InMemoryConsentRepository()),
          overrides.hr as never,
          undefined,
          undefined,
          undefined,
          overrides.ownedDepots as never,
        ),
      };
    }

    /*
     * AUT-07. Deactivating a franchise owner already refuses while they hold a revenue share
     * (applyActive); deleting one did not, and delete is the harder-to-undo of the two. An
     * owner's depots keep earning for an account that no longer exists.
     */
    it('refuses to delete a franchise owner who still holds a depot share (AUT-07)', async () => {
      const ownedDepots = { countOwned: jest.fn(async () => 2) };
      const { svc, repo } = makeService({ role: 'FRANCHISE_OWNER', ownedDepots });
      await expect(svc.deleteStaffAccount(TARGET, ACTOR)).rejects.toThrow(/2 depot/);
      expect(ownedDepots.countOwned).toHaveBeenCalledWith(TARGET);
      // Nothing was closed or scrubbed.
      expect(repo.markDeletedGuardingLastSuperAdmin).not.toHaveBeenCalled();
      expect(customerData.anonymise).not.toHaveBeenCalled();
    });

    it('deletes a franchise owner with no depot share, and asks nothing for other roles (AUT-07)', async () => {
      const ownedDepots = { countOwned: jest.fn(async () => 0) };
      const owner = makeService({ role: 'FRANCHISE_OWNER', ownedDepots });
      await expect(owner.svc.deleteStaffAccount(TARGET, ACTOR)).resolves.toMatchObject({ deleted: true });
      const other = makeService({ role: 'KEPALA_DEPOT', ownedDepots });
      await other.svc.deleteStaffAccount(TARGET, ACTOR);
      expect(ownedDepots.countOwned).toHaveBeenCalledTimes(1);
    });

    it('anonymises across services, closes the login, and audits it as an admin action', async () => {
      const hr = { anonymiseEmployee: jest.fn() };
      const { svc, saved } = makeService({ hr });

      await expect(svc.deleteStaffAccount(TARGET, ACTOR)).resolves.toEqual({
        deleted: true,
        employeeAnonymised: true,
      });

      expect(customerData.anonymise).toHaveBeenCalledWith(TARGET);
      expect(requests.anonymised).toContain(TARGET);
      expect(hr.anonymiseEmployee).toHaveBeenCalledWith(TARGET);
      expect(saved).toEqual([{ id: TARGET, status: 'DELETED' }]);
      // Its own action: "the owner asked" and "an admin did it" must stay distinguishable.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.account.deleted', customerId: ACTOR }),
      );
    });

    /*
     * B-5. This is the STAFF console's delete: it skips the PDP request queue (who asked,
     * who decided) and files the result as `staff.account.deleted`. Its two siblings,
     * `setStaffDepot` and `setStaffActiveInternal`, both refuse a customer; this one did
     * not, so a SUPER_ADMIN could erase an end customer through the staff route.
     */
    it('refuses an end customer — that deletion belongs to the PDP queue', async () => {
      const { svc, repo } = makeService({ role: 'CUSTOMER' });
      await expect(svc.deleteStaffAccount(TARGET, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(customerData.anonymise).not.toHaveBeenCalled();
      expect(repo.markDeletedGuardingLastSuperAdmin).not.toHaveBeenCalled();
    });

    // The row vanished between the read and the write — a concurrent delete. The repository
    // is the one that notices, and the caller has to translate that, not ignore it.
    it('reports not-found when the account disappears mid-delete', async () => {
      const { svc, repo } = makeService({});
      repo.markDeletedGuardingLastSuperAdmin = jest.fn(async (_id: string) => 'not-found') as never;
      await expect(svc.deleteStaffAccount(TARGET, ACTOR)).rejects.toBeInstanceOf(
        CustomerNotFoundError,
      );
    });

    it('refuses to delete the acting account', async () => {
      const { svc } = makeService({});
      await expect(svc.deleteStaffAccount(ACTOR, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(customerData.anonymise).not.toHaveBeenCalled();
    });

    // Deleting the last one would leave a system nobody can administer — including to
    // undo this.
    it('refuses to delete the last super admin, but allows one of several', async () => {
      const last = makeService({ role: 'SUPER_ADMIN', superAdminTotal: 1 });
      await expect(last.svc.deleteStaffAccount(TARGET, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const oneOfMany = makeService({ role: 'SUPER_ADMIN', superAdminTotal: 2 });
      await expect(oneOfMany.svc.deleteStaffAccount(TARGET, ACTOR)).resolves.toEqual({
        deleted: true,
        employeeAnonymised: true,
      });
    });

    // The login is already gone by then; raising here would report a failure for a
    // deletion that did happen.
    // B-10: it completes, and it SAYS the other half did not. `{deleted: true}` on its own
    // reads as finished, and the orphaned employee record is exactly what somebody has to
    // go and clean up by hand.
    it('still completes when hr-service cannot be told, and reports the half that failed', async () => {
      const hr = { anonymiseEmployee: jest.fn(async () => Promise.reject(new Error('hr down'))) };
      const { svc, saved } = makeService({ hr });

      await expect(svc.deleteStaffAccount(TARGET, ACTOR)).resolves.toEqual({
        deleted: true,
        employeeAnonymised: false,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ employeeAnonymised: false }),
        }),
      );
      expect(saved).toEqual([{ id: TARGET, status: 'DELETED' }]);
    });

    /*
     * HR-0063 / HR-0042. A customer asks to be deleted, waits in the queue, is hired, and the
     * approval lands on a staff login. The customer path erased the auth account only: the
     * employee row stayed ACTIVE behind a dead login, and the number re-registered as a
     * plain CUSTOMER on its next sign-in.
     */
    describe('approving a DELETE whose requester has since become staff', () => {
      const asStaffRequest = async () => {
        const hr = { anonymiseEmployee: jest.fn(async () => undefined) };
        const made = makeService({ hr });
        const raised = await requests.create({ customerId: TARGET, type: 'DELETE', reason: null });
        return { ...made, hr, raised };
      };

      it('takes the staff path: the employee record is closed and the request completes', async () => {
        const { svc, hr, raised, saved } = await asStaffRequest();

        const result = await svc.approve(raised.id, ACTOR);

        expect(hr.anonymiseEmployee).toHaveBeenCalledWith(TARGET);
        expect(saved).toEqual([{ id: TARGET, status: 'DELETED' }]);
        expect(result.request.status).toBe('COMPLETED');
        expect(result.request.processedBy).toBe(ACTOR);
        expect(requests.anonymised).toEqual([TARGET]);
      });

      it('keeps the staff guards: nobody approves their own deletion, and the request stays open', async () => {
        const { svc, hr, raised } = await asStaffRequest();

        await expect(svc.approve(raised.id, TARGET)).rejects.toBeInstanceOf(BadRequestException);

        expect(hr.anonymiseEmployee).not.toHaveBeenCalled();
        expect(requests.rows.find((r) => r.id === raised.id)?.status).toBe('PENDING');
      });
    });
  });

  it('refuses to raise a DELETE for a staff login, but not an EXPORT', async () => {
    customers.findById.mockResolvedValue({ id: STAFF_REQUESTER, role: 'STAFF_DEPOT' });

    await expect(service.request(STAFF_REQUESTER, 'DELETE', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(requests.rows).toHaveLength(0);
    await expect(service.request(STAFF_REQUESTER, 'EXPORT', null)).resolves.toMatchObject({
      type: 'EXPORT',
    });
  });

  it('flags a queue row whose requester is staff now, and not a customer or a deleted account', async () => {
    customers.findByIds.mockResolvedValueOnce([
      { id: STAFF_REQUESTER, fullName: 'Rouf', role: 'STAFF_DEPOT', status: 'ACTIVE' },
      { id: CUSTOMER, fullName: 'Budi', role: 'CUSTOMER', status: 'ACTIVE' },
      { id: 'gone', fullName: null, role: 'STAFF_DEPOT', status: 'DELETED' },
    ]);
    await requests.create({ customerId: STAFF_REQUESTER, type: 'DELETE', reason: null });
    await requests.create({ customerId: CUSTOMER, type: 'DELETE', reason: null });
    await requests.create({ customerId: 'gone', type: 'DELETE', reason: null });

    const queue = await service.listForStaff('PENDING');

    expect(queue.map((r) => [r.customerId, r.customerIsStaff])).toEqual([
      [STAFF_REQUESTER, true],
      [CUSTOMER, false],
      ['gone', false],
    ]);
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

  // Owner decision 2026-10-14: an account with orders in flight is not erased. The guard
  // runs before any side effect, fails closed, and only `force` (the controller grants it to
  // SUPER_ADMIN alone) gets past it — leaving a note of how many orders it ran over.
  describe('open orders', () => {
    const withOrders = (countOpen: jest.Mock) =>
      new DataSubjectService(
        requests as never,
        customers as never,
        customerData as never,
        audit as never,
        new ConsentService(new InMemoryConsentRepository()),
        undefined,
        undefined,
        undefined,
        { countOpen } as never,
      );

    it('refuses a DELETE while orders are open and touches nothing', async () => {
      const guarded = withOrders(jest.fn().mockResolvedValue(2));
      const created = await guarded.request(CUSTOMER, 'DELETE', null);

      await expect(guarded.approve(created.id, STAFF)).rejects.toBeInstanceOf(
        AccountHasOpenOrdersError,
      );
      expect(customerData.anonymise).not.toHaveBeenCalled();
      expect(requests.anonymised).toEqual([]);
    });

    it('goes through with force, and the audit row says how many orders it ran over', async () => {
      const guarded = withOrders(jest.fn().mockResolvedValue(3));
      const created = await guarded.request(CUSTOMER, 'DELETE', null);

      await guarded.approve(created.id, STAFF, { force: true });

      expect(customerData.anonymise).toHaveBeenCalledWith(CUSTOMER);
      expect(JSON.stringify(audit.record.mock.calls)).toContain('"openOrders":3');
    });

    it('approves normally at zero, and an EXPORT never asks', async () => {
      const count = jest.fn().mockResolvedValue(0);
      const guarded = withOrders(count);
      const del = await guarded.request(CUSTOMER, 'DELETE', null);
      await expect(guarded.approve(del.id, STAFF)).resolves.toBeDefined();
      expect(count).toHaveBeenCalledTimes(1);

      count.mockClear();
      const exp = await guarded.request(CUSTOMER, 'EXPORT', null);
      await guarded.approve(exp.id, STAFF);
      expect(count).not.toHaveBeenCalled();
    });

    it('fails closed when order-service cannot answer', async () => {
      const guarded = withOrders(jest.fn().mockRejectedValue(new Error('order-service down')));
      const created = await guarded.request(CUSTOMER, 'DELETE', null);

      await expect(guarded.approve(created.id, STAFF)).rejects.toThrow('order-service down');
      expect(customerData.anonymise).not.toHaveBeenCalled();
    });
  });

  it('leaves the request PENDING when the downstream scrub fails, so it can be retried', async () => {
    const created = await service.request(CUSTOMER, 'DELETE', null);
    customerData.anonymise.mockRejectedValueOnce(new Error('customer-service unreachable'));

    await expect(service.approve(created.id, STAFF)).rejects.toThrow(
      'customer-service unreachable',
    );

    expect((await requests.findById(created.id))?.status).toBe('PENDING');
    expect(requests.anonymised).toEqual([]);
  });

  it('an export whose downstream is down says so instead of looking complete', async () => {
    customerData.export.mockRejectedValueOnce(new Error('boom'));
    const created = await service.request(CUSTOMER, 'EXPORT', null);

    const result = await service.approve(created.id, STAFF);

    expect(result.export?.customer).toMatchObject({
      error: expect.stringContaining('unreachable'),
    });
  });

  it('two approvals at once: one erases, the other is told it is already being decided', async () => {
    const r = await service.request(CUSTOMER, 'DELETE', null);
    const res = await Promise.allSettled([
      service.approve(r.id, STAFF),
      service.approve(r.id, '33333333-3333-3333-3333-333333333333'),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(customerData.anonymise).toHaveBeenCalledTimes(1);
  });

  it('a run that died without throwing stays IN_PROGRESS, refuses a second approver, and resumes once stale', async () => {
    const r = await service.request(CUSTOMER, 'DELETE', null);
    // The process died after claiming: nothing ran to release it.
    await requests.claim(r.id, STAFF, new Date(), 600_000);
    await expect(service.approve(r.id, '33333333-3333-3333-3333-333333333333')).rejects.toThrow();
    requests.claimedAt.set(r.id, Date.now() - 11 * 60_000);
    const done = await service.approve(r.id, STAFF);
    expect(done.request.status).toBe('COMPLETED');
  });

  it('a run that threw gives the request back so it can be retried at once', async () => {
    const r = await service.request(CUSTOMER, 'DELETE', null);
    customerData.anonymise.mockRejectedValueOnce(new Error('down'));
    await expect(service.approve(r.id, STAFF)).rejects.toThrow('down');
    expect((await requests.findById(r.id))?.status).toBe('PENDING');
    expect((await service.approve(r.id, STAFF)).request.status).toBe('COMPLETED');
  });

  it('a failing export gives the request back too', async () => {
    const r = await service.request(CUSTOMER, 'EXPORT', null);
    jest.spyOn(requests, 'decide').mockRejectedValueOnce(new Error('db down'));
    await expect(service.approve(r.id, STAFF)).rejects.toThrow('db down');
    expect((await requests.findById(r.id))?.status).toBe('PENDING');
  });

  it('a rejection cannot decide a request an approval has claimed', async () => {
    const r = await service.request(CUSTOMER, 'DELETE', null);
    await requests.claim(r.id, STAFF, new Date(), 600_000);
    await expect(service.reject(r.id, STAFF, 'no')).rejects.toThrow();
  });

  it('a second request of the same type is still refused while the first is IN_PROGRESS', async () => {
    const r = await service.request(CUSTOMER, 'DELETE', null);
    await requests.claim(r.id, STAFF, new Date(), 600_000);
    await expect(service.request(CUSTOMER, 'DELETE', null)).rejects.toThrow();
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

    // §G-3: HQ decides a deletion request; it has to say who is asking, not eight hex
    // characters. An account with no name stays null so the console falls back.
    const queue = await service.listForStaff('PENDING');
    expect(queue).toHaveLength(2);
    expect(queue.find((r) => r.customerId === CUSTOMER)?.customerName).toBe('Budi');
    expect(queue.find((r) => r.customerId !== CUSTOMER)?.customerName).toBeNull();
  });

  /*
   * CA-3-54. The approval queue existed and worked; this one route walked around it, and
   * the only thing that ever gated it was a browser screen — a cookie and curl skipped
   * that. Head office decides, `processedBy` says who, and (owner decision 2026-09-04)
   * the decision is good for seven days.
   */
  const approveExport = async (processedAt: Date) => {
    const request = await service.request(CUSTOMER, 'EXPORT', null);
    await service.approve(request.id, STAFF);
    const row = requests.rows.find((r) => r.id === request.id)!;
    row.processedAt = processedAt;
    return row;
  };

  it('refuses the export until head office has approved one', async () => {
    await expect(service.exportFor(CUSTOMER)).rejects.toBeInstanceOf(DataExportNotApprovedError);
    expect(customers.findById).not.toHaveBeenCalled();
  });

  it('exports once an approval exists, and records who approved it', async () => {
    const row = await approveExport(new Date());
    const payload = await service.exportFor(CUSTOMER);

    expect(payload.account).toMatchObject({ id: CUSTOMER });
    expect(row.processedBy).toBe(STAFF);
  });

  /*
   * The payload is rebuilt at DOWNLOAD time, so an approval that never expires is a
   * permanent door onto today's data — not onto the data head office actually looked at.
   */
  it('refuses an approval older than seven days', async () => {
    await approveExport(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await expect(service.exportFor(CUSTOMER)).rejects.toBeInstanceOf(
      DataExportApprovalExpiredError,
    );
  });

  it('still allows one approved six days ago', async () => {
    await approveExport(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
    await expect(service.exportFor(CUSTOMER)).resolves.toBeDefined();
  });

  // An approval nobody can date cannot be shown to be inside its window, so it is refused.
  /*
   * A customer who asked twice has two COMPLETED rows, and the window must be measured
   * against the NEWEST decision — otherwise an old approval would expire a fresh one.
   */
  it('measures the window against the newest approval, whichever order they arrive in', async () => {
    const old = await approveExport(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    // A second request needs the first to be closed, which `approve` already did.
    const fresh = await approveExport(new Date());
    expect(old.processedAt!.getTime()).toBeLessThan(fresh.processedAt!.getTime());

    await expect(service.exportFor(CUSTOMER)).resolves.toBeDefined();

    // And the other way round: newest first in the list must give the same answer.
    requests.rows.reverse();
    await expect(service.exportFor(CUSTOMER)).resolves.toBeDefined();
  });

  it('refuses a COMPLETED row that carries no decision time', async () => {
    const row = await approveExport(new Date());
    row.processedAt = null;
    await expect(service.exportFor(CUSTOMER)).rejects.toBeInstanceOf(
      DataExportApprovalExpiredError,
    );
  });

  it('an export for an unknown account yields an empty account block, not a crash', async () => {
    await approveExport(new Date());
    customers.findById.mockResolvedValueOnce(null);
    expect((await service.exportFor(CUSTOMER)).account).toEqual({});
  });

  /*
   * The erasure REGISTRY (UU PDP item 13, docs/AUDIT_L3.md §4.2).
   *
   * Before it, "delete my account" was one HTTP call to customer-service, and §4.2 counted
   * what that left standing on the live cluster: 4.124 rows across eight tables, including
   * 21 subscriptions still placing orders to the phone number of somebody who had asked to
   * be forgotten. The registry does not promise completeness — it promises that whatever is
   * not covered is NAMED, exactly as `purge-executor.registry.ts` does for retention.
   *
   * Delete the `eraseEverywhere` call in `approve` and every case below fails.
   */
  describe('erasure registry', () => {
    const withRegistry = (
      erasers: unknown[],
      exemptions: { dataset: string; reason: string }[] = [],
    ) =>
      new DataSubjectService(
        requests as never,
        customers as never,
        customerData as never,
        audit as never,
        new ConsentService(new InMemoryConsentRepository()),
        undefined,
        erasers as never,
        exemptions as never,
      );

    const executor = (
      dataset: string,
      over: Partial<{
        configured: boolean;
        rows: number;
        fail: string;
        unenforcedReason: string;
      }> = {},
    ) => ({
      dataset,
      configured: over.configured ?? true,
      unenforcedReason: over.unenforcedReason,
      erase: jest.fn(async () => {
        if (over.fail) throw new Error(over.fail);
        return over.rows ?? 1;
      }),
    });

    it('fans the erasure out and reports what each owner did', async () => {
      const crm = executor('crm.messages', { rows: 3050 });
      const subs = executor('order.subscriptions', { rows: 21 });
      const svc = withRegistry([crm, subs]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      await svc.approve(created.id, STAFF);

      // The phone rides along: half the surviving rows carry a number and no id.
      expect(crm.erase).toHaveBeenCalledWith({ customerId: CUSTOMER, phone: '+628111' });
      const coverage = audit.record.mock.calls.at(-1)?.[0].metadata.coverage;
      expect(coverage).toEqual(
        expect.arrayContaining([
          { dataset: 'crm.messages', coverage: 'ERASED', rows: 3050, note: '' },
          { dataset: 'order.subscriptions', coverage: 'ERASED', rows: 21, note: '' },
        ]),
      );
    });

    // The whole point. A dataset nobody can reach is a ROW in the report, not an omission.
    it('reports an unreachable owner as UNENFORCED rather than skipping it', async () => {
      const svc = withRegistry([executor('crm.messages', { configured: false })]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      await svc.approve(created.id, STAFF);

      expect(audit.record.mock.calls.at(-1)?.[0].metadata.coverage).toContainEqual(
        expect.objectContaining({ dataset: 'crm.messages', coverage: 'UNENFORCED' }),
      );
    });

    // A dataset that is known and deliberately has no executor yet carries its own reason,
    // not the generic "not configured" — `depot.order_disputes` has no customerId column.
    it('carries the declared reason for a dataset with no executor yet', async () => {
      const svc = withRegistry([
        executor('depot.order_disputes', {
          configured: false,
          unenforcedReason: 'no customerId column',
        }),
      ]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      await svc.approve(created.id, STAFF);

      expect(audit.record.mock.calls.at(-1)?.[0].metadata.coverage).toContainEqual(
        expect.objectContaining({ coverage: 'UNENFORCED', note: 'no customerId column' }),
      );
    });

    /*
     * A failing owner must not roll back a deletion that has largely happened — the account
     * is already anonymised by this point. It is recorded as FAILED with its message, which
     * a human can act on; an exception would lose which halves succeeded.
     */
    it('records a failing owner as FAILED and still completes the request', async () => {
      const svc = withRegistry([executor('crm.messages', { fail: 'owner responded 503' })]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      const result = await svc.approve(created.id, STAFF);

      expect(result.request.status).toBe('COMPLETED');
      expect(audit.record.mock.calls.at(-1)?.[0].metadata.coverage).toContainEqual(
        expect.objectContaining({
          dataset: 'crm.messages',
          coverage: 'FAILED',
          note: 'owner responded 503',
        }),
      );
    });

    /*
     * `order.orders` is the row the console audit called a Kritis defect and AUDIT_L3 §4.2
     * called a written decision. AUDIT_L3 is right, and the decision now has somewhere to
     * live: an EXEMPT row with its reason, in the same report as everything else.
     */
    it('reports a written exemption as EXEMPT with its reason', async () => {
      const svc = withRegistry([], [{ dataset: 'order.orders', reason: 'FINANCIAL, 10 tahun' }]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      await svc.approve(created.id, STAFF);

      expect(audit.record.mock.calls.at(-1)?.[0].metadata.coverage).toContainEqual({
        dataset: 'order.orders',
        coverage: 'EXEMPT',
        rows: null,
        note: 'FINANCIAL, 10 tahun',
      });
    });

    // An account row that has already gone (a retried approve) must not stop the fan-out:
    // the id still erases everything keyed on it, and only the phone-keyed rows are lost.
    it('sends a null phone rather than failing when the account row is already gone', async () => {
      const crm = executor('crm.messages');
      const svc = withRegistry([crm]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);
      // Twice: approve() reads the account for its role first, then again for the phone.
      customers.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await svc.approve(created.id, STAFF);

      expect(crm.erase).toHaveBeenCalledWith({ customerId: CUSTOMER, phone: null });
    });

    // Read BEFORE `anonymiseCustomer`: once the account is scrubbed the phone key is gone,
    // and the rows keyed on it would be unreachable forever.
    it('reads the phone before the account is anonymised', async () => {
      const crm = executor('crm.messages');
      const svc = withRegistry([crm]);
      const created = await svc.request(CUSTOMER, 'DELETE', null);

      await svc.approve(created.id, STAFF);

      expect(crm.erase).toHaveBeenCalledWith(expect.objectContaining({ phone: '+628111' }));
      expect(requests.anonymised).toEqual([CUSTOMER]);
    });
  });
});
