import { DepotAssignmentApplier } from '../../src/application/services/depot-assignment-applier.service';

const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

function build(updateError?: unknown) {
  const row = {
    id: 'as-1',
    employeeId: 'emp-1',
    kind: 'LOAN',
    depotId: P,
    startDate: day('2026-10-10'),
    endDate: day('2026-10-12'),
    status: 'PLANNED',
    attempts: 0,
    createdByRole: 'HR',
  };
  const failures: unknown[][] = [];
  const update = jest.fn(async () => {
    if (updateError) throw updateError;
    return {};
  });
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new DepotAssignmentApplier(
    {
      findDue: async () => [row],
      findById: async () => row,
      recordFailure: async (...a: unknown[]) => void failures.push(a),
    } as never,
    {
      findById: async () => ({
        id: 'emp-1', role: 'STAFF_DEPOT', status: 'ACTIVE', authSubjectId: 'a', depotId: G, homeDepotId: G,
      }),
      update,
    } as never,
    { assignRole: jest.fn(async () => undefined) } as never,
    { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
    audit as never,
  );
  return { svc, failures, update, audit };
}
const NOW = new Date('2026-10-10T03:00:00.000Z');

describe('two sweeps at the same moment', () => {
  it('the loser of the race is a success: no failure counted, no second audit line', async () => {
    const { svc, failures, audit } = build({ code: 'P2002', message: 'Unique constraint failed' });
    const r = await svc.applyDue(NOW);
    expect(r.failed).toBe(0);
    expect(r.applied).toBe(1);
    expect(failures).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled(); // the winner already wrote it
  });

  it('any other write failure is still a failure of the row', async () => {
    const { svc, failures } = build(new Error('connection reset'));
    const r = await svc.applyDue(NOW);
    expect(r.failed).toBe(1);
    expect(failures[0]).toEqual(['as-1', 'connection reset', DepotAssignmentApplier.MAX_ATTEMPTS]);
  });
});
