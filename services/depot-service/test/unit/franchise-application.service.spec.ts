import { FranchiseApplicationService } from '../../src/application/services/franchise-application.service';
import {
  ChecklistItemStatus,
  FranchiseAppStage,
  emptyChecklist,
} from '../../src/domain/franchise-application';
import {
  ApplicationAlreadyDecidedError,
  DuplicateDepotCodeError,
  FranchiseApplicationNotFoundError,
} from '../../src/domain/errors';
import { DepotRepository } from '../../src/application/ports/depot.repository';
import {
  CreateFranchiseApplicationData,
  FranchiseApplicationRecord,
  FranchiseApplicationRepository,
  ListApplicationsFilter,
  UpdateFranchiseApplicationData,
} from '../../src/application/ports/franchise-application.repository';

class InMemoryApplicationRepository implements FranchiseApplicationRepository {
  rows: FranchiseApplicationRecord[] = [];
  private seq = 0;

  async create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
    // Older seq → older submittedAt so ordering is deterministic in tests.
    const at = new Date(1_800_000_000_000 + this.seq * 1000);
    const row: FranchiseApplicationRecord = {
      id: `a${++this.seq}`,
      ...data,
      stage: data.stage ?? FranchiseAppStage.PENDING,
      submittedAt: at,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return row;
  }
  async list(filter: ListApplicationsFilter) {
    const all = this.rows
      .filter((r) => !filter.stage || r.stage === filter.stage)
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return { items: all.slice(start, start + filter.limit), total: all.length };
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, patch: UpdateFranchiseApplicationData) {
    const row = this.rows.find((r) => r.id === id)!;
    if (patch.stage !== undefined) row.stage = patch.stage;
    if (patch.checklist !== undefined) row.checklist = patch.checklist;
    // The rejection IS the last write, which is what makes updatedAt a decision date.
    row.updatedAt = new Date(row.updatedAt.getTime() + 1);
    return row;
  }
  async purgeRejectedBefore(cutoff: Date) {
    const doomed = this.rows.filter(
      (r) => r.stage === FranchiseAppStage.REJECTED && r.updatedAt.getTime() < cutoff.getTime(),
    );
    this.rows = this.rows.filter((r) => !doomed.includes(r));
    return doomed.length;
  }
}

const APP = (
  over: Partial<CreateFranchiseApplicationData> = {},
): CreateFranchiseApplicationData => ({
  applicantName: 'Rudi Hartono',
  applicantPhone: '0812-1111-2222',
  proposedCode: 'DPK-01',
  proposedName: 'Depot Sumber Jernih',
  city: 'Depok',
  province: 'Jawa Barat',
  lat: -6.4,
  lng: 106.8,
  investmentAmount: 120_000_000,
  projectedMonthlyRevenue: 18_000_000,
  checklist: emptyChecklist(),
  ...over,
});

/** Only findByCode matters here — create() checks the proposed code against live depots. */
function depotsWithCodes(...codes: string[]): DepotRepository {
  return {
    findByCode: async (code: string) =>
      codes.includes(code) ? ({ id: `d-${code}`, code } as never) : null,
  } as unknown as DepotRepository;
}

describe('FranchiseApplicationService', () => {
  let repo: InMemoryApplicationRepository;
  let service: FranchiseApplicationService;

  beforeEach(() => {
    repo = new InMemoryApplicationRepository();
    service = new FranchiseApplicationService(repo, depotsWithCodes());
  });

  it('refuses a code a live depot already wears, before a human reviews the application', async () => {
    const taken = new FranchiseApplicationService(repo, depotsWithCodes('DPK-01'));
    await expect(taken.create(APP({ proposedCode: 'DPK-01' }))).rejects.toBeInstanceOf(
      DuplicateDepotCodeError,
    );
    expect(repo.rows).toHaveLength(0);
    // A free code still goes through on the same service.
    await expect(taken.create(APP({ proposedCode: 'DPK-02' }))).resolves.toMatchObject({
      proposedCode: 'DPK-02',
    });
  });

  it('allows two pending applications to propose the same code', async () => {
    // Nothing is provisioned yet; picking between two candidates for one area is what
    // the queue is for.
    await service.create(APP({ applicantName: 'Rudi' }));
    await expect(service.create(APP({ applicantName: 'Sari' }))).resolves.toMatchObject({
      applicantName: 'Sari',
    });
  });

  it('lists the queue oldest-first (highest SLA age at the top)', async () => {
    await service.create(APP({ applicantName: 'Oldest' }));
    await service.create(APP({ applicantName: 'Newest' }));
    const page = await service.list({ page: 1, limit: 20 });
    expect(page.total).toBe(2);
    expect(page.items[0].applicantName).toBe('Oldest');
  });

  it('rejects an unknown application id', async () => {
    await expect(service.get('missing')).rejects.toBeInstanceOf(FranchiseApplicationNotFoundError);
  });

  it('merges only known checklist items and ignores unknown keys', async () => {
    const created = await service.create(APP());
    const updated = await service.patch(created.id, {
      checklist: { ktpNpwp: ChecklistItemStatus.VERIFIED, bogus: 'X' } as never,
    });
    expect(updated.checklist.ktpNpwp).toBe(ChecklistItemStatus.VERIFIED);
    expect(updated.checklist.fieldSurvey).toBe(ChecklistItemStatus.PENDING);
    expect((updated.checklist as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('approve returns the proposed-depot prefill and marks it APPROVED', async () => {
    const created = await service.create(APP());
    const result = await service.approve(created.id);
    expect(result.application.stage).toBe(FranchiseAppStage.APPROVED);
    expect(result.proposedDepot).toEqual({
      code: 'DPK-01',
      name: 'Depot Sumber Jernih',
      ownershipType: 'WARALABA',
      city: 'Depok',
      province: 'Jawa Barat',
      lat: -6.4,
      lng: 106.8,
    });
  });

  it('refuses to re-decide or edit a terminal application', async () => {
    const created = await service.create(APP());
    await service.reject(created.id);
    await expect(service.approve(created.id)).rejects.toBeInstanceOf(
      ApplicationAlreadyDecidedError,
    );
    await expect(
      service.patch(created.id, { stage: FranchiseAppStage.SURVEY }),
    ).rejects.toBeInstanceOf(ApplicationAlreadyDecidedError);
  });
});

/*
 * CA-3-53. A rejected application is a name, a WhatsApp number and a GPS pin belonging to
 * somebody we told no, and it had no retention window at all — the table only ever grew.
 * Owner decision 2026-09-02: 24 months, counted from the decision.
 */
describe('FranchiseApplicationService.purgeRejectedOlderThan', () => {
  const FAR_FUTURE = new Date(2_000_000_000_000);

  it('deletes rejected applications older than the cutoff and keeps everything else', async () => {
    const repo = new InMemoryApplicationRepository();
    const service = new FranchiseApplicationService(repo, depotsWithCodes());

    const rejected = await service.create(APP({ proposedCode: 'AAA-01' }));
    const approved = await service.create(APP({ proposedCode: 'BBB-01' }));
    const pending = await service.create(APP({ proposedCode: 'CCC-01' }));
    await service.reject(rejected.id);
    await service.approve(approved.id);

    expect(await service.purgeRejectedOlderThan(FAR_FUTURE)).toEqual({ deleted: 1 });
    expect(repo.rows.map((r) => r.id).sort()).toEqual([approved.id, pending.id].sort());
  });

  it('leaves a rejection that is still inside its window alone', async () => {
    const repo = new InMemoryApplicationRepository();
    const service = new FranchiseApplicationService(repo, depotsWithCodes());
    const rejected = await service.create(APP({ proposedCode: 'AAA-02' }));
    await service.reject(rejected.id);

    expect(await service.purgeRejectedOlderThan(new Date(0))).toEqual({ deleted: 0 });
    expect(repo.rows).toHaveLength(1);
  });
});
