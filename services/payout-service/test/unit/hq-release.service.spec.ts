import { HqReleaseService } from '../../src/application/services/hq-release.service';
import type { PayoutService } from '../../src/application/services/payout.service';
import type {
  CreateReleaseRequestData,
  ReleaseRequestRecord,
  ReleaseRequestRepository,
} from '../../src/application/ports/release-request.repository';

/*
 * PYO-2, owner decision 2026-09-17 — maker-checker.
 *
 * One FINANCE account used to release any owner's whole balance to a destination it typed,
 * alone and irreversibly. The request and the approval are two people now, and nothing
 * leaves a balance until the second one acts.
 */
class FakeRequests implements ReleaseRequestRepository {
  rows: ReleaseRequestRecord[] = [];

  async create(data: CreateReleaseRequestData): Promise<ReleaseRequestRecord | null> {
    // Mirrors the partial unique index: one PENDING request per owner.
    const open = this.rows.find(
      (r) => r.franchiseOwnerId === data.franchiseOwnerId && r.status === 'PENDING',
    );
    if (open) return null;
    const row: ReleaseRequestRecord = {
      id: `req-${this.rows.length}`,
      ...data,
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      reason: null,
      withdrawalId: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: string): Promise<ReleaseRequestRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listByStatus(status: ReleaseRequestRecord['status']): Promise<ReleaseRequestRecord[]> {
    return this.rows.filter((r) => r.status === status);
  }

  async decide(
    id: string,
    data: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null },
  ): Promise<ReleaseRequestRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'PENDING') return null;
    Object.assign(row, data, { decidedAt: new Date() });
    return row;
  }

  async attachWithdrawal(id: string, withdrawalId: string): Promise<ReleaseRequestRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    row.withdrawalId = withdrawalId;
    return row;
  }

  async reopen(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id)!;
    if (row.status === 'APPROVED' && !row.withdrawalId) {
      Object.assign(row, { status: 'PENDING', decidedBy: null, decidedAt: null, reason: null });
    }
  }
}

const OWNER = 'owner-1';
const FINANCE = 'finance-1';
const DIRECTOR = 'direktur-1';

describe('HqReleaseService', () => {
  let requests: FakeRequests;
  let releaseForOwner: jest.Mock;
  let service: HqReleaseService;

  beforeEach(() => {
    requests = new FakeRequests();
    releaseForOwner = jest.fn().mockResolvedValue({ id: 'wd-1' });
    service = new HqReleaseService(
      requests,
      { balanceFor: jest.fn(async () => 250_000) } as never,
      { releaseForOwner } as unknown as PayoutService,
    );
  });

  it('records a request with the balance it was raised against, and moves nothing', async () => {
    const created = await service.request(OWNER, ' BCA ···· 4821 ', FINANCE);
    expect(created).toMatchObject({
      franchiseOwnerId: OWNER,
      bankAccountRef: 'BCA ···· 4821',
      amountAtRequest: 250_000,
      requestedBy: FINANCE,
      status: 'PENDING',
    });
    expect(releaseForOwner).not.toHaveBeenCalled();
    expect(await service.listPending()).toHaveLength(1);
  });

  it('refuses a second request for the same owner, and a balance of nothing', async () => {
    await service.request(OWNER, undefined, FINANCE);
    await expect(service.request(OWNER, undefined, FINANCE)).rejects.toThrow(/sudah diajukan/);

    const broke = new HqReleaseService(
      new FakeRequests(),
      { balanceFor: jest.fn(async () => 0) } as never,
      { releaseForOwner } as unknown as PayoutService,
    );
    await expect(broke.request(OWNER, undefined, FINANCE)).rejects.toThrow();
  });

  it('pays only on approval, by somebody other than the requester', async () => {
    const req = await service.request(OWNER, 'BCA ···· 4821', FINANCE);

    await expect(service.approve(req.id, FINANCE)).rejects.toThrow(/sendiri/);
    expect(releaseForOwner).not.toHaveBeenCalled();

    const approved = await service.approve(req.id, DIRECTOR);
    expect(releaseForOwner).toHaveBeenCalledWith(OWNER, 'BCA ···· 4821');
    expect(approved).toMatchObject({
      status: 'APPROVED',
      decidedBy: DIRECTOR,
      withdrawalId: 'wd-1',
    });

    // Decided once: the second approver changes nothing and pays nothing twice.
    await expect(service.approve(req.id, 'super-1')).rejects.toThrow(/sudah diputuskan/);
    expect(releaseForOwner).toHaveBeenCalledTimes(1);
  });

  it('puts an approval back to pending when the release itself fails', async () => {
    const req = await service.request(OWNER, undefined, FINANCE);
    releaseForOwner.mockRejectedValueOnce(new Error('ledger down'));

    await expect(service.approve(req.id, DIRECTOR)).rejects.toThrow('ledger down');
    expect((await requests.findById(req.id))?.status).toBe('PENDING');

    await expect(service.approve(req.id, DIRECTOR)).resolves.toMatchObject({ status: 'APPROVED' });
  });

  // The race the WHERE clause exists for: the row is still PENDING when we read it and
  // decided by the time we write. Whoever loses moves no money and is told so.
  it('loses a decision race cleanly, on both approve and reject', async () => {
    const req = await service.request(OWNER, undefined, FINANCE);
    jest.spyOn(requests, 'decide').mockResolvedValue(null);
    await expect(service.approve(req.id, DIRECTOR)).rejects.toThrow(/sudah diputuskan/);
    await expect(service.reject(req.id, DIRECTOR, null)).rejects.toThrow(/sudah diputuskan/);
    expect(releaseForOwner).not.toHaveBeenCalled();
  });

  it('rejects with a reason, by somebody other than the requester, and moves nothing', async () => {
    const req = await service.request(OWNER, undefined, FINANCE);
    await expect(service.reject(req.id, FINANCE, 'salah')).rejects.toThrow(/sendiri/);
    const rejected = await service.reject(req.id, DIRECTOR, '  rekening salah  ');
    expect(rejected).toMatchObject({ status: 'REJECTED', decidedBy: DIRECTOR, reason: 'rekening salah' });
    expect(releaseForOwner).not.toHaveBeenCalled();
    await expect(service.reject(req.id, DIRECTOR, null)).rejects.toThrow(/sudah diputuskan/);
    await expect(service.approve('nope', DIRECTOR)).rejects.toThrow(/tidak ditemukan/);
  });
});
