import { ApprovalService } from '../../src/application/services/approval.service';
import { ApprovalStatus, ApprovalType } from '../../src/domain/approval';
import {
  ApprovalAlreadyDecidedError,
  ApprovalNotFoundError,
  ApprovalSelfDecideError,
} from '../../src/domain/errors';
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

  // The amount column is an INT4. 100,000 gallons at a Rp1,000,000 deposit is Rp99,999,000,000 and
  // used to reach the database as-is: a 500 raised AFTER the return that queued it was written.
  it('caps an amount the column cannot hold instead of failing, and still queues it for a human', async () => {
    const huge = await raise(99_999_000_000);
    expect(huge.amountIdr).toBe(2_147_483_647);
    expect(huge.status).toBe(ApprovalStatus.PENDING);

    const hugeLoss = await raise(-99_999_000_000);
    expect(hugeLoss.amountIdr).toBe(-2_147_483_647);
    expect(hugeLoss.status).toBe(ApprovalStatus.PENDING);
  });

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

  /*
   * CA-2-20, owner decision D7 (2 September 2026).
   *
   * `submittedBy` is the account that performed the act being reviewed — the stock count
   * whose loss this is, the gallon return whose refund this is — and every one of those acts
   * is reachable by a MANAGER, who is also the role holding `approvals`. So one account could
   * count a shortfall, raise the item for it, and sign it off, and the ledger would show two
   * names that were the same name.
   *
   * The refusal IS the escalation: nothing is deleted, no status is invented, the item stays
   * PENDING in the same queue for the next approver.
   */
  describe('CA-2-20 · nobody decides their own item', () => {
    it('refuses APPROVE from the person who raised it', async () => {
      const a = await raise(-240_000);
      await expect(service.decide(a.id, 'APPROVE', null, SUBMITTER)).rejects.toBeInstanceOf(
        ApprovalSelfDecideError,
      );
    });

    it('refuses REJECT too — a rejection is a decision about your own item', async () => {
      const a = await raise(-240_000);
      await expect(service.decide(a.id, 'REJECT', null, SUBMITTER)).rejects.toBeInstanceOf(
        ApprovalSelfDecideError,
      );
    });

    it('refuses HOLD too — parking your own item is still deciding it', async () => {
      const a = await raise(-240_000);
      await expect(service.decide(a.id, 'HOLD', 'nanti', SUBMITTER)).rejects.toBeInstanceOf(
        ApprovalSelfDecideError,
      );
    });

    it('leaves the item PENDING and decidable by somebody else', async () => {
      const a = await raise(-240_000);
      await expect(service.decide(a.id, 'APPROVE', null, SUBMITTER)).rejects.toThrow();

      // The refusal must not consume the item: this is an escalation, not a dead end.
      const still = await service.get(a.id);
      expect(still.status).toBe(ApprovalStatus.PENDING);
      expect(still.decidedAt).toBeNull();

      const approved = await service.decide(a.id, 'APPROVE', 'ditinjau manajer lain', MANAGER);
      expect(approved.status).toBe(ApprovalStatus.APPROVED);
      expect(approved.decidedBy).toBe(MANAGER);
    });

    it('still lets a different account decide normally', async () => {
      const a = await raise(-240_000);
      const ok = await service.decide(a.id, 'APPROVE', null, MANAGER);
      expect(ok.status).toBe(ApprovalStatus.APPROVED);
    });
  });
});

/*
 * Telling the decider. The item goes to the TOP of the depot's supervision chain - that is
 * where `approvals` (managers) sits - and to nobody when there is no chain, rather than
 * somebody guessed.
 */
describe('ApprovalService - telling the approver', () => {
  const ASSISTANT = '33333333-3333-3333-3333-333333333333';
  const SUPERVISOR = '44444444-4444-4444-4444-444444444444';
  const TOP_MANAGER = '55555555-5555-5555-5555-555555555555';

  async function build(opts: {
    assistant?: string | null;
    superiors?: Record<string, string | null>;
    alertPhone?: string;
    send?: jest.Mock;
  }) {
    const depotRepo = new InMemoryDepotRepository();
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-02',
      name: 'Depot Menteng',
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
    if (opts.assistant !== undefined) {
      (depotRepo as unknown as { rows: { id: string; assistantSupervisorId: string | null }[] }).rows
        ?.filter((r) => r.id === depot.id)
        .forEach((r) => (r.assistantSupervisorId = opts.assistant ?? null));
    }
    const send = opts.send ?? jest.fn(async () => true);
    const hierarchy = {
      superiorOf: jest.fn(async (id: string) => opts.superiors?.[id] ?? null),
    } as never;
    const config = buildTestConfig(opts.alertPhone === undefined ? {} : { DEPOT_ALERT_PHONE: opts.alertPhone });
    const service = new ApprovalService(
      new InMemoryApprovalRepository(),
      depotRepo,
      config,
      hierarchy,
      { send } as never,
    );
    return { service, depotId: depot.id, send, depotRepo };
  }

  const big = (service: ApprovalService, depotId: string) =>
    service.create(
      { depotId, type: ApprovalType.OPNAME_VARIANCE, title: 'Selisih opname', amountIdr: -500_000 },
      SUBMITTER,
    );

  it('pages the top of the chain, not the assistant it starts from', async () => {
    const { service, depotId, send } = await build({
      assistant: ASSISTANT,
      superiors: { [ASSISTANT]: SUPERVISOR, [SUPERVISOR]: TOP_MANAGER },
      alertPhone: '0800-ops',
    });
    const approval = await big(service, depotId);
    expect(send).toHaveBeenCalledWith(
      'APPROVAL_REQUESTED',
      '0800-ops',
      TOP_MANAGER,
      expect.objectContaining({ title: 'Selisih opname', approvalId: approval.id }),
    );
  });

  it('says nothing for an item that auto-passed', async () => {
    const { service, depotId, send } = await build({ assistant: ASSISTANT, alertPhone: '0800-ops' });
    await service.create(
      { depotId, type: ApprovalType.OPNAME_VARIANCE, title: 'kecil', amountIdr: -1_000 },
      SUBMITTER,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('pages nobody when the depot has no assistant supervisor', async () => {
    const { service, depotId, send } = await build({ assistant: null, alertPhone: '0800-ops' });
    await big(service, depotId);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not page the person who raised it', async () => {
    const { service, depotId, send } = await build({ assistant: SUBMITTER, alertPhone: '0800-ops' });
    await big(service, depotId);
    expect(send).not.toHaveBeenCalled();
  });

  it('pages nobody when the depot cannot be read back', async () => {
    const { service, depotId, send, depotRepo } = await build({
      assistant: ASSISTANT,
      alertPhone: '0800-ops',
    });
    jest.spyOn(depotRepo, 'findById').mockResolvedValue(null);
    await big(service, depotId);
    expect(send).not.toHaveBeenCalled();
  });

  it('survives a cycle in the supervision data', async () => {
    const { service, depotId, send } = await build({
      assistant: ASSISTANT,
      superiors: { [ASSISTANT]: SUPERVISOR, [SUPERVISOR]: ASSISTANT },
      alertPhone: '0800-ops',
    });
    await expect(big(service, depotId)).resolves.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not fail the item when the notice throws, or when there is no ops phone', async () => {
    const boom = await build({
      assistant: ASSISTANT,
      alertPhone: '0800-ops',
      send: jest.fn(async () => {
        throw new Error('crm down');
      }),
    });
    await expect(big(boom.service, boom.depotId)).resolves.toBeDefined();

    const noPhone = await build({ assistant: ASSISTANT, alertPhone: '' });
    await big(noPhone.service, noPhone.depotId);
    expect(noPhone.send).not.toHaveBeenCalled();
  });
});
