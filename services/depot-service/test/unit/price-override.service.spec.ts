import { PriceOverrideService } from '../../src/application/services/price-override.service';
import { PricingService, CreateRuleInput } from '../../src/application/services/pricing.service';
import { PricingAdjustType } from '../../src/domain/pricing-rule';
import { PriceOverrideStatus } from '../../src/domain/price-override-proposal';
import {
  DepotNotFoundError,
  PriceOverrideProposalDecidedError,
  PriceOverrideProposalNotFoundError,
  PriceOverrideSelfApprovalError,
} from '../../src/domain/errors';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  CreatePriceOverrideProposalData,
  ListProposalsFilter,
  PriceOverrideProposalRepository,
  UpdatePriceOverrideProposalData,
} from '../../src/application/ports/price-override-proposal.repository';
import { PriceOverrideProposalRecord } from '../../src/domain/price-override-proposal';
import { DepotRecord, DepotRepository } from '../../src/application/ports/depot.repository';

/** The queue is what these tests are about; the names decorate it. */
const noNames = async () => new Map<string, string>();


class InMemoryProposalRepository implements PriceOverrideProposalRepository {
  rows: PriceOverrideProposalRecord[] = [];
  private seq = 0;

  async create(data: CreatePriceOverrideProposalData): Promise<PriceOverrideProposalRecord> {
    const at = new Date(1_800_000_000_000 + this.seq * 1000);
    const row: PriceOverrideProposalRecord = {
      id: `p${++this.seq}`,
      ...data,
      status: PriceOverrideStatus.PENDING,
      decidedBy: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return row;
  }
  async list(filter: ListProposalsFilter) {
    const all = this.rows
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return { items: all.slice(start, start + filter.limit), total: all.length };
  }
  async countByProduct(status?: PriceOverrideStatus) {
    const map = new Map<string, number>();
    for (const r of this.rows) {
      if (status && r.status !== status) continue;
      map.set(r.productId, (map.get(r.productId) ?? 0) + 1);
    }
    return [...map.entries()].map(([productId, count]) => ({ productId, count }));
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, patch: UpdatePriceOverrideProposalData) {
    const row = this.rows.find((r) => r.id === id)!;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.decidedBy !== undefined) row.decidedBy = patch.decidedBy;
    return row;
  }
}

// Only findById is exercised; the rest throw if reached.
const fakeDepots = (name: string | null): DepotRepository =>
  ({
    findById: async (id: string) =>
      name === null ? null : ({ id, name } as unknown as DepotRecord),
  }) as unknown as DepotRepository;

const PROPOSE = {
  productId: '11111111-1111-1111-1111-111111111111',
  productName: 'Galon 19L isi ulang',
  currentPrice: 20000,
  adjustType: PricingAdjustType.PERCENT,
  value: -10,
  note: 'ikut harga pesaing',
};

describe('PriceOverrideService', () => {
  let repo: InMemoryProposalRepository;
  let pricingCreate: jest.Mock;
  let pricing: PricingService;

  beforeEach(() => {
    repo = new InMemoryProposalRepository();
    pricingCreate = jest.fn(async (_depotId: string, _input: CreateRuleInput) => ({}) as never);
    pricing = { create: pricingCreate } as unknown as PricingService;
  });

  // PROPOSE is -10% of 20000 = 2000 impact, well under this auto-pass limit, so the
  // existing tests keep their old behaviour; the M18-15 cases tune it per test.
  const fakeConfig = (autoPassIdr = 100000, audited = false) =>
    ({
      approvalAutoPassIdr: () => autoPassIdr,
      // Blank by default: the audit client is a no-op when unconfigured, so the tests
      // that are not about the trail make no network call at all.
      authServiceUrl: audited ? 'http://auth:3001' : '',
      internalServiceKey: audited ? 'k'.repeat(16) : '',
    }) as unknown as DepotConfigService;

  const service = (
    depotName: string | null = 'Depot Kelapa Gading',
    autoPassIdr = 100000,
    audited = false,
  ) =>
    new PriceOverrideService(
      repo,
      fakeDepots(depotName),
      pricing,
      fakeConfig(autoPassIdr, audited),
      noNames,
    );

  // H-29: a price override is money — the comment in this service used to say outright
  // that a log line WAS the trail, because depot-service has no audit store. It has one
  // now (auth-service's, over the internal ingest route), and all three outcomes land in
  // it: approved, rejected, and a blocked self-approval.
  describe('audit trail', () => {
    let fetchMock: jest.SpyInstance;
    beforeEach(() => {
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    });
    afterEach(() => fetchMock.mockRestore());
    const entries = () =>
      fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

    it('records an approval with who proposed it, who decided, and the impact', async () => {
      const svc = service('Depot Kelapa Gading', 100000, true);
      const created = await svc.propose('d1', 'mgr-1', PROPOSE);
      await svc.approve(created.id, 'hq-1');

      expect(entries()).toEqual([
        expect.objectContaining({
          action: 'depot.price_override.approved',
          actorId: 'hq-1',
          success: true,
          metadata: expect.objectContaining({
            proposedBy: 'mgr-1',
            depotId: 'd1',
            proposalId: created.id,
          }),
        }),
      ]);
    });

    it('records a rejection', async () => {
      const svc = service('Depot Kelapa Gading', 100000, true);
      const created = await svc.propose('d1', 'mgr-1', PROPOSE);
      await svc.reject(created.id, 'hq-1');
      expect(entries()[0]).toMatchObject({
        action: 'depot.price_override.rejected',
        actorId: 'hq-1',
        success: false,
      });
    });

    it('records a blocked self-approval — an attempt is the thing worth keeping', async () => {
      const svc = service('Depot Kelapa Gading', 0, true);
      const created = await svc.propose('d1', 'mgr-1', PROPOSE);
      await expect(svc.approve(created.id, 'mgr-1')).rejects.toBeInstanceOf(
        PriceOverrideSelfApprovalError,
      );
      expect(entries()[0]).toMatchObject({
        action: 'depot.price_override.self_approve_blocked',
        actorId: 'mgr-1',
        success: false,
      });
    });

    it('records a blank actor as a system event, not as an actor named ""', async () => {
      const svc = service('Depot Kelapa Gading', 100000, true);
      const created = await svc.propose('d1', 'mgr-1', PROPOSE);
      await svc.reject(created.id, '');
      expect(entries()[0].actorId).toBeUndefined();
    });

    // Fail-open: the pricing rule is already created by the time the trail is written.
    it('still approves when the trail is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = service('Depot Kelapa Gading', 100000, true);
      const created = await svc.propose('d1', 'mgr-1', PROPOSE);
      await expect(svc.approve(created.id, 'hq-1')).resolves.toMatchObject({
        status: PriceOverrideStatus.APPROVED,
      });
    });
  });

  it('proposes an override, denormalizing the depot name', async () => {
    const created = await service().propose('d1', 'mgr-1', PROPOSE);
    expect(created.status).toBe(PriceOverrideStatus.PENDING);
    expect(created.depotName).toBe('Depot Kelapa Gading');
    expect(created.proposedBy).toBe('mgr-1');
  });

  it('bulk-imports proposals, failing only the rows whose depot is gone', async () => {
    const svc = service();
    const summary = await svc.importProposals('d1', 'mgr-1', [PROPOSE, PROPOSE]);
    expect(summary).toMatchObject({ created: 2, skipped: 0, failed: 0 });

    const missingDepot = await service(null).importProposals('d0', 'mgr-1', [PROPOSE]);
    expect(missingDepot).toMatchObject({ created: 0, failed: 1 });
  });

  it('rejects a proposal for an unknown depot', async () => {
    await expect(service(null).propose('d0', 'mgr-1', PROPOSE)).rejects.toBeInstanceOf(
      DepotNotFoundError,
    );
  });

  it('approving creates the winning pricing rule and marks it APPROVED', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.approve(created.id, 'hq-1');

    expect(decided.status).toBe(PriceOverrideStatus.APPROVED);
    expect(decided.decidedBy).toBe('hq-1');
    expect(pricingCreate).toHaveBeenCalledTimes(1);
    const [depotId, input] = pricingCreate.mock.calls[0] as [string, CreateRuleInput];
    expect(depotId).toBe('d1');
    expect(input).toMatchObject({
      productId: PROPOSE.productId,
      adjustType: PricingAdjustType.PERCENT,
      value: -10,
      priority: 100,
      active: true,
    });
  });

  it('blocks the proposer from approving their own above-threshold override (M18-15)', async () => {
    const svc = service('Depot Kelapa Gading', 1000); // impact 2000 > 1000 auto-pass
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);

    await expect(svc.approve(created.id, 'mgr-1')).rejects.toBeInstanceOf(
      PriceOverrideSelfApprovalError,
    );
    expect(pricingCreate).not.toHaveBeenCalled();
    // Stays in HQ's queue rather than being closed off.
    expect((await svc.get(created.id)).status).toBe(PriceOverrideStatus.PENDING);
  });

  it('still lets the proposer approve their own override under the threshold (M18-15)', async () => {
    const svc = service('Depot Kelapa Gading', 100000); // impact 2000 <= 100000
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.approve(created.id, 'mgr-1');
    expect(decided.status).toBe(PriceOverrideStatus.APPROVED);
  });

  it('lets a different approver decide an above-threshold override (M18-15)', async () => {
    const svc = service('Depot Kelapa Gading', 1000);
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.approve(created.id, 'hq-1');
    expect(decided.status).toBe(PriceOverrideStatus.APPROVED);
  });

  it('a zero auto-pass limit blocks every self-approval (M18-15)', async () => {
    const svc = service('Depot Kelapa Gading', 0);
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    await expect(svc.approve(created.id, 'mgr-1')).rejects.toBeInstanceOf(
      PriceOverrideSelfApprovalError,
    );
  });

  it('measures a FIXED override by its rupiah delta, either direction (M18-15)', async () => {
    const svc = service('Depot Kelapa Gading', 1000);
    const created = await svc.propose('d1', 'mgr-1', {
      ...PROPOSE,
      adjustType: PricingAdjustType.FIXED,
      value: -5000,
    });
    await expect(svc.approve(created.id, 'mgr-1')).rejects.toBeInstanceOf(
      PriceOverrideSelfApprovalError,
    );
  });

  it('rejecting closes the proposal without creating a rule', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.reject(created.id, 'hq-1');
    expect(decided.status).toBe(PriceOverrideStatus.REJECTED);
    expect(pricingCreate).not.toHaveBeenCalled();
  });

  it('refuses to re-decide a terminal proposal', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    await svc.approve(created.id, 'hq-1');
    await expect(svc.reject(created.id, 'hq-1')).rejects.toBeInstanceOf(
      PriceOverrideProposalDecidedError,
    );
  });

  it('rejects an unknown proposal id', async () => {
    await expect(service().approve('missing', 'hq-1')).rejects.toBeInstanceOf(
      PriceOverrideProposalNotFoundError,
    );
  });

  it('lists the pending queue newest-first', async () => {
    const svc = service();
    await svc.propose('d1', 'mgr-1', { ...PROPOSE, productName: 'Oldest' });
    await svc.propose('d1', 'mgr-1', { ...PROPOSE, productName: 'Newest' });
    const page = await svc.list({ page: 1, limit: 20, status: PriceOverrideStatus.PENDING });
    expect(page.total).toBe(2);
    expect(page.items[0].productName).toBe('Newest');
  });

  // §G-3. The four-eyes rule below turns on WHO proposed it, and the queue was showing
  // eight characters of an account id.
  it('names the manager who proposed each row, and copes when it cannot', async () => {
    const svc = new PriceOverrideService(
      repo,
      fakeDepots('Depot Kelapa Gading'),
      pricing,
      fakeConfig(100000, false),
      async () => new Map([['mgr-1', 'Budi']]),
    );
    await svc.propose('d1', 'mgr-1', PROPOSE);
    await svc.propose('d1', 'mgr-2', { ...PROPOSE, productId: 'p2' });

    const page = await svc.list({ page: 1, limit: 20, status: PriceOverrideStatus.PENDING });

    expect(page.items.map((i) => [i.proposedBy, i.proposedByName]).sort()).toEqual([
      ['mgr-1', 'Budi'],
      ['mgr-2', null],
    ]);
  });
});
