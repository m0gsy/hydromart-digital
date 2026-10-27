import { LoanService } from '../../src/application/services/loan.service';

type Row = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  principal: number;
  installmentAmount: number;
  startPeriod: string;
  createdAt: Date;
};

const loan = (over: Partial<Row> & { id: string }): Row => ({
  employeeId: 'e1',
  employeeName: 'Budi',
  employeeCode: 'EMP-1',
  principal: 1_000_000,
  installmentAmount: 250_000,
  startPeriod: '2026-09',
  createdAt: new Date('2026-09-05T03:00:00Z'),
  ...over,
});

function make(rows: Row[], ledger: Record<string, number> = {}) {
  const calls: { listAll?: unknown; before?: string } = {};
  const repo = {
    listAll: async (f: unknown) => {
      calls.listAll = f;
      return { rows, total: rows.length };
    },
  };
  const payrolls = {
    deductedBySourceRefBefore: async (_e: null, before: string) => {
      calls.before = before;
      return new Map(Object.entries(ledger));
    },
  };
  const svc = new LoanService(
    repo as never,
    {} as never,
    { timeZone: 'Asia/Jakarta' } as never,
    payrolls as never,
  );
  return { svc, calls };
}

// `to` is the exclusive end of the window: 1 Nov 00:00 WIB covers October.
const TO = new Date('2026-10-31T17:00:00Z');

describe('LoanService.reportTable', () => {
  it('rolls an employee up, reading balances from the payroll ledger as of the window', async () => {
    const { svc, calls } = make(
      [
        loan({ id: 'a' }),
        loan({
          id: 'b',
          principal: 500_000,
          installmentAmount: 100_000,
          createdAt: new Date('2026-08-30T20:00:00Z'),
        }),
      ],
      { a: 500_000, b: 100_000 },
    );
    const t = await svc.reportTable(TO);

    expect(t.truncated).toBe(false);
    expect(t.columns.map((c) => c.key)).toEqual([
      'employee',
      'code',
      'loans',
      'principal',
      'repaid',
      'remaining',
      'installment',
      'oldest',
    ]);
    // 1,5jt pokok, 600rb sudah dipotong payroll, sisa 900rb; tertua = 31 Agu WIB (03:00 +7).
    expect(t.rows).toEqual([
      ['Budi', 'EMP-1', 2, 1_500_000, 600_000, 900_000, 350_000, '2026-08-31'],
    ]);
    expect(calls.before).toBe('2026-11');
    expect(calls.listAll).toMatchObject({ activeOnly: true, skip: 0, take: 5001 });
  });

  it('drops settled loans, orders by balance, and survives a missing name', async () => {
    const { svc } = make(
      [
        loan({ id: 'done', employeeId: 'e2', principal: 100_000, installmentAmount: 100_000 }),
        loan({
          id: 'small',
          employeeId: 'e3',
          employeeName: null,
          employeeCode: null,
          principal: 200_000,
        }),
        loan({ id: 'big', employeeId: 'e1', principal: 900_000 }),
      ],
      { done: 100_000 },
    );
    const t = await svc.reportTable(TO);
    expect(t.rows.map((r) => r[0])).toEqual(['Budi', '—']);
    expect(t.rows[1].slice(0, 2)).toEqual(['—', '']);
  });

  it('says so when the loan list was cut at the cap', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => loan({ id: `l${i}`, employeeId: `e${i}` }));
    const t = await make(rows).svc.reportTable(TO);
    expect(t.truncated).toBe(true);
    expect(t.rows).toHaveLength(5000);
  });

  it('is empty, not an error, when nobody owes', async () => {
    const t = await make([]).svc.reportTable(TO);
    expect(t).toMatchObject({ rows: [], truncated: false });
  });
});
