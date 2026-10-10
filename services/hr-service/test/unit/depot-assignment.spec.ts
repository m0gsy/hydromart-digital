import {
  MAX_BACKDATE_DAYS,
  MAX_HORIZON_DAYS,
  type BackdateFacts,
  planProblems,
  type OpenAssignment,
  type PlanInput,
  type PlanSubject,
} from '../../src/domain/depot-assignment';

const GALAKSI = '11111111-1111-1111-1111-111111111111';
const PEKAYON = '22222222-2222-2222-2222-222222222222';
const TODAY = '2026-10-10';

const subject: PlanSubject = {
  role: 'STAFF_DEPOT',
  hasAccount: true,
  status: 'ACTIVE',
  homeDepotId: GALAKSI,
  joinDate: '2026-01-01',
  exitDate: null,
};

const loan: PlanInput = {
  kind: 'LOAN',
  depotId: PEKAYON,
  startDate: '2026-10-16',
  endDate: '2026-10-25',
};

const problems = (
  input: Partial<PlanInput> = {},
  who: Partial<PlanSubject> = {},
  open: OpenAssignment[] = [],
) => planProblems({ ...loan, ...input }, { ...subject, ...who }, open, TODAY);

describe('planProblems', () => {
  it('accepts a normal loan', () => {
    expect(problems()).toEqual([]);
  });

  it('accepts a scheduled permanent move with no end date', () => {
    expect(problems({ kind: 'PERMANENT', endDate: null, startDate: '2026-11-01' })).toEqual([]);
  });

  it('rejects roles HR does not manage, and employees without a login or a depot', () => {
    expect(problems({}, { role: 'HR' })).toEqual([expect.stringMatching(/jabatan/i)]);
    expect(problems({}, { role: null })).toEqual([expect.stringMatching(/jabatan/i)]);
    expect(problems({}, { hasAccount: false })).toEqual([expect.stringMatching(/akun/i)]);
    expect(problems({}, { homeDepotId: null })).toEqual([expect.stringMatching(/depot asal/i)]);
  });

  it('rejects an employee who is not active', () => {
    expect(problems({}, { status: 'RESIGNED' })).toEqual([expect.stringMatching(/aktif/i)]);
  });

  it('rejects sending someone to the depot they already belong to', () => {
    expect(problems({ depotId: GALAKSI })).toEqual([expect.stringMatching(/depot asal/i)]);
  });

  it('a loan needs an end date on or after its start; a permanent move must not have one', () => {
    expect(problems({ endDate: null })).toEqual([expect.stringMatching(/akhir/i)]);
    expect(problems({ endDate: '2026-10-15' })).toEqual([expect.stringMatching(/akhir/i)]);
    expect(problems({ endDate: '2026-10-16' })).toEqual([]);
    expect(problems({ kind: 'PERMANENT', endDate: '2026-12-01' })).toEqual([
      expect.stringMatching(/permanen/i),
    ]);
  });

  it('does not plan in the past, and not beyond the horizon', () => {
    expect(problems({ startDate: '2026-10-09', endDate: '2026-10-20' })).toEqual([
      expect.stringMatching(/lampau|mundur/i),
    ]);
    expect(problems({ startDate: TODAY, endDate: '2026-10-20' })).toEqual([]);
    const far = '2027-10-12'; // 367 days after TODAY
    expect(MAX_HORIZON_DAYS).toBe(366);
    expect(problems({ startDate: far, endDate: '2027-10-20' })).toEqual([
      expect.stringMatching(/terlalu jauh/i),
    ]);
  });

  it('rejects dates outside the employment window', () => {
    expect(problems({}, { exitDate: '2026-10-20' })).toEqual([expect.stringMatching(/keluar/i)]);
    expect(problems({ kind: 'PERMANENT', endDate: null }, { exitDate: '2026-10-12' })).toEqual([
      expect.stringMatching(/keluar/i),
    ]);
  });

  it('rejects a start before the employee joined', () => {
    expect(problems({}, { joinDate: '2026-10-20' })).toEqual([expect.stringMatching(/masuk/i)]);
  });

  it('rejects an overlap with a planned or active loan, touching days included', () => {
    const open: OpenAssignment[] = [
      { id: 'a1', kind: 'LOAN', startDate: '2026-10-20', endDate: '2026-10-30' },
    ];
    expect(problems({}, {}, open)).toEqual([expect.stringMatching(/bertabrakan/i)]);
    expect(problems({ startDate: '2026-10-10', endDate: '2026-10-19' }, {}, open)).toEqual([]);
    expect(problems({ startDate: '2026-10-10', endDate: '2026-10-20' }, {}, open)).toEqual([
      expect.stringMatching(/bertabrakan/i),
    ]);
  });

  it('treats a scheduled permanent move as open-ended: nothing may be planned after it', () => {
    const open: OpenAssignment[] = [
      { id: 'p1', kind: 'PERMANENT', startDate: '2026-11-01', endDate: null },
    ];
    expect(problems({ startDate: '2026-12-01', endDate: '2026-12-05' }, {}, open)).toEqual([
      expect.stringMatching(/bertabrakan/i),
    ]);
    expect(problems({}, {}, open)).toEqual([]);
  });

  it('a new permanent move is open-ended too: it collides with anything planned after it', () => {
    const open: OpenAssignment[] = [
      { id: 'l1', kind: 'LOAN', startDate: '2026-12-01', endDate: '2026-12-05' },
    ];
    expect(
      problems({ kind: 'PERMANENT', endDate: null, startDate: '2026-11-01' }, {}, open),
    ).toEqual([expect.stringMatching(/bertabrakan/i)]);
  });

  it('reports every problem at once instead of one per attempt', () => {
    const r = problems({ endDate: null }, { hasAccount: false, status: 'RESIGNED' });
    expect(r.length).toBe(3);
  });
});

describe('planProblems: starting in the past', () => {
  const clean: BackdateFacts = { actorMayBackdate: true, lockedMonths: [], stampConflicts: 0 };
  const past = (input: Partial<PlanInput>, facts?: Partial<BackdateFacts>) =>
    planProblems(
      { ...loan, startDate: '2026-10-05', endDate: '2026-10-25', ...input },
      subject,
      [],
      TODAY,
      facts === undefined ? undefined : { ...clean, ...facts },
    );

  it('stays closed without the facts, and for anybody who may not backdate', () => {
    expect(past({})).toEqual([expect.stringMatching(/lampau/i)]);
    expect(past({}, { actorMayBackdate: false })).toEqual([expect.stringMatching(/lampau/i)]);
  });

  it('opens for a permitted actor when the books are clean', () => {
    expect(past({}, {})).toEqual([]);
  });

  it('refuses beyond the cap but allows exactly the cap', () => {
    expect(past({ startDate: '2026-07-10' }, {})).toEqual([]); // 92 days back
    expect(MAX_BACKDATE_DAYS).toBe(92);
    expect(past({ startDate: '2026-07-09' }, {})).toEqual([
      expect.stringMatching(/terlalu lampau/i),
    ]);
  });

  it('names the locked months and the conflicting stamps', () => {
    const r = past({}, { lockedMonths: ['2026-09', '2026-10'], stampConflicts: 2 });
    expect(r).toEqual([
      expect.stringMatching(/2026-09, 2026-10.*disetujui atau dibayar/),
      expect.stringMatching(/2 hari absensi/),
    ]);
  });

  it('a start today or later never asks for the facts', () => {
    expect(
      past({ startDate: TODAY }, { actorMayBackdate: false, lockedMonths: ['2026-10'] }),
    ).toEqual([]);
  });
});
