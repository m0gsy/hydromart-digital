import { ApprovalService } from '../../src/application/services/approval.service';
import { ApprovalStatus, ApprovalType } from '../../src/domain/approval';
import { ApprovalAlreadyDecidedError, ApprovalNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  buildTestConfig,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
} from '../support/fakes';

const SUBMITTER = '11111111-1111-1111-1111-111111111111';
const MANAGER = '22222222-2222-2222-2222-222222222222';

describe('ApprovalService', () => {
  let repo: InMemoryApprovalRepository;
  let service: ApprovalService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryApprovalRepository();
    // Threshold 100k: |amount| <= 100k auto-passes, above waits PENDING.
    service = new ApprovalService(repo, depotRepo, buildTestConfig());
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const raise = (amountIdr: number) =>
    service.create(
      { depotId, type: ApprovalType.OPNAME_VARIANCE, title: 'Selisih opname', amountIdr },
      SUBMITTER,
    );

  it('auto-passes (APPROVED) a value at or under the threshold', async () => {
    const under = await raise(-80_000);
    expect(under.status).toBe(ApprovalStatus.APPROVED);
    expect(under.decidedAt).not.toBeNull();
    expect(under.autoPassThreshold).toBe(100_000);

    const exact = await raise(100_000);
    expect(exact.status).toBe(ApprovalStatus.APPROVED);
  });

  it('holds (PENDING) a value above the threshold', async () => {
    const over = await raise(-240_000);
    expect(over.status).toBe(ApprovalStatus.PENDING);
    expect(over.decidedAt).toBeNull();
  });

  it('approves and rejects a pending item, stamping the decider', async () => {
    const a = await raise(-240_000);
    const approved = await service.decide(a.id, 'APPROVE', 'Selisih wajar', MANAGER);
    expect(approved.status).toBe(ApprovalStatus.APPROVED);
    expect(approved.decidedBy).toBe(MANAGER);
    expect(approved.decisionNote).toBe('Selisih wajar');
    expect(approved.decidedAt).not.toBeNull();

    const b = await raise(-300_000);
    const rejected = await service.decide(b.id, 'REJECT', null, MANAGER);
    expect(rejected.status).toBe(ApprovalStatus.REJECTED);
  });

  it('holds without a final decision, then still allows a later decision', async () => {
    const a = await raise(-240_000);
    const held = await service.decide(a.id, 'HOLD', 'Tunggu bukti', MANAGER);
    expect(held.status).toBe(ApprovalStatus.HELD);
    expect(held.decidedAt).toBeNull();
    // HELD is not terminal — it can still be approved.
    const approved = await service.decide(a.id, 'APPROVE', null, MANAGER);
    expect(approved.status).toBe(ApprovalStatus.APPROVED);
  });

  it('refuses to re-decide a terminal item', async () => {
    const a = await raise(-240_000);
    await service.decide(a.id, 'REJECT', null, MANAGER);
    await expect(service.decide(a.id, 'APPROVE', null, MANAGER)).rejects.toBeInstanceOf(
      ApprovalAlreadyDecidedError,
    );
  });

  it('rejects an unknown id and counts only PENDING by type', async () => {
    await expect(service.get('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      ApprovalNotFoundError,
    );
    await raise(-240_000); // PENDING
    await raise(-80_000); // auto-APPROVED, must not count
    const counts = await service.counts(depotId);
    expect(counts.total).toBe(1);
    expect(counts.byType.OPNAME_VARIANCE).toBe(1);
  });
});
