import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

/**
 * The HR query builders, both ways round.
 *
 * Every one of these is a chain of `if (q.x)` guards, and the console had tests for the
 * paths that pass a value and almost none for the paths that do not. That asymmetry is
 * how a builder that silently drops a filter survives: the screen sends `status`, the
 * test sends `status`, and nobody ever checks that omitting it produces a URL without a
 * dangling `?` or a `status=undefined`.
 *
 * Two properties per builder: with everything set, and with nothing set. The second is
 * the one that catches `?status=undefined`, `&asOfPeriod=undefined` and a trailing `?`.
 */

/** A URL must never carry the string "undefined" or "null" as a value. */
const noPlaceholders = (url: string) => {
  expect(url).not.toContain('=undefined');
  expect(url).not.toContain('=null');
  expect(url).not.toMatch(/\?$/);
  expect(url).not.toContain('?&');
  expect(url).not.toContain('&&');
};

const hr = endpoints.hr;

describe('HR list builders with no filters at all', () => {
  const bare: Array<[string, string]> = [
    ['employees', hr.employees()],
    ['payroll', hr.payroll()],
    ['attendanceMe', hr.attendanceMe()],
    ['payrollMe', hr.payrollMe()],
    ['allLoans', hr.allLoans()],
    ['departments', hr.departments()],
  ];

  for (const [name, url] of bare) {
    it(`${name} emits a clean path`, () => {
      noPlaceholders(url);
      expect(url.startsWith('/')).toBe(true);
    });
  }
});

describe('HR list builders with every filter set', () => {
  it('employees carries status, depot, search and the page bounds', () => {
    const url = hr.employees({
      status: 'ACTIVE',
      depotId: 'depot-1',
      search: 'budi',
      departmentId: 'dept-1',
      page: 2,
      pageSize: 50,
    });
    noPlaceholders(url);
    for (const part of [
      'status=ACTIVE',
      'depotId=depot-1',
      'departmentId=dept-1',
      'page=2',
      'pageSize=50',
    ]) {
      expect(url).toContain(part);
    }
    // The search term is the one a person types, so it has to survive encoding.
    expect(url).toContain('budi');
  });

  it('payroll carries the period, the employee and the status the API accepts', () => {
    const url = hr.payroll({
      periodMonth: '2026-08',
      employeeId: 'e1',
      status: 'DRAFT',
      page: 3,
      pageSize: 100,
    });
    noPlaceholders(url);
    for (const part of ['periodMonth=2026-08', 'employeeId=e1', 'status=DRAFT', 'page=3']) {
      expect(url).toContain(part);
    }
  });

  it('attendanceMe carries both ends of the window', () => {
    const url = hr.attendanceMe({ from: '2026-08-01', to: '2026-08-31', page: 2, pageSize: 60 });
    noPlaceholders(url);
    expect(url).toContain('from=2026-08-01');
    expect(url).toContain('to=2026-08-31');
  });

  it('payrollMe carries the period and the page', () => {
    const url = hr.payrollMe({ periodMonth: '2026-08', page: 2, pageSize: 20 });
    noPlaceholders(url);
    expect(url).toContain('periodMonth=2026-08');
  });

  it('allLoans carries the activeOnly flag as the literal the server reads', () => {
    const url = hr.allLoans({ page: 2, pageSize: 25, activeOnly: true });
    noPlaceholders(url);
    // Not `activeOnly=1` and not `activeOnly=[object Object]` — the server reads 'true'.
    expect(url).toContain('activeOnly=true');
  });

  it('allLoans omits activeOnly entirely when it is false', () => {
    // `if (q.activeOnly)` — false must drop the key, not send `activeOnly=false`, which a
    // truthiness check on the server would read as "yes".
    const url = hr.allLoans({ activeOnly: false });
    noPlaceholders(url);
    expect(url).not.toContain('activeOnly');
  });
});

describe('HR builders that take an id', () => {
  it('bonusRules scopes to a depot when given one, and to none when not', () => {
    expect(hr.bonusRules('depot-1')).toContain('depotId=depot-1');
    const all = hr.bonusRules();
    noPlaceholders(all);
    expect(all).not.toContain('depotId');
  });

  it('bonusRules encodes a depot id rather than pasting it', () => {
    expect(hr.bonusRules('a/b')).toContain('depotId=a%2Fb');
  });

  it('loans appends the period only when asked for one', () => {
    expect(hr.loans('e1', '2026-08')).toContain('asOfPeriod=2026-08');
    const bare = hr.loans('e1');
    expect(bare).not.toContain('asOfPeriod');
    noPlaceholders(bare);
  });

  it('allowances encodes the employee id', () => {
    expect(hr.allowances('a b')).toContain('employeeId=a%20b');
  });

  it('the single-record paths carry the id they were given', () => {
    expect(hr.employee('e1')).toContain('/e1');
    expect(hr.updateEmployee('e1')).toContain('/e1');
    expect(hr.payrollById('p1')).toContain('/p1');
    expect(hr.updateBonusRule('r1')).toContain('/r1');
  });
});
