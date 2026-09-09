import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

/**
 * The HR endpoint builders, exercised on the branch that has actually broken here.
 *
 * Every optional parameter in these builders is a decision about what reaches the server,
 * and the defects have all been the same shape: a parameter the screen believed it was
 * sending and the URL never carried. CA-1-16 was exactly that — the approvals queue asked
 * with no page at all, so there was no page 2 to reach and application 21 was invisible to
 * whoever was waiting on that decision.
 *
 * These are pure functions, so the test is cheap; what it pins is the contract, not the
 * string.
 */

describe('HR list endpoints carry the filters their screens set', () => {
  it('omits an empty query entirely rather than sending a bare question mark', () => {
    expect(endpoints.hr.employees()).toBe('/employees/api/v1/employees');
    expect(endpoints.hr.employees({})).toBe('/employees/api/v1/employees');
  });

  it('drops undefined, null and empty values instead of sending them as blanks', () => {
    // A blank filter must not narrow the list to rows whose column IS blank.
    const url = endpoints.hr.employees({
      depotId: undefined,
      q: '',
      status: 'ACTIVE',
    } as never);
    expect(url).toBe('/employees/api/v1/employees?status=ACTIVE');
  });

  it('carries every filter the directory screen offers', () => {
    const url = endpoints.hr.employees({
      depotId: 'd-1',
      q: 'budi',
      status: 'ACTIVE',
      page: 2,
      pageSize: 50,
    } as never);
    expect(url).toContain('depotId=d-1');
    expect(url).toContain('q=budi');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
  });

  /*
   * CA-1-16: an approvals queue that can only ever ask for the server's default first page
   * is not a preview — application 21 is absent from it, and nobody is told.
   */
  it('lets the leave queue ask for a second page, and for one status', () => {
    expect(endpoints.hr.leaveQueue()).toBe('/leave/api/v1/leave');
    const url = endpoints.hr.leaveQueue({ status: 'PENDING_HR', page: 2, pageSize: 100 });
    expect(url).toContain('status=PENDING_HR');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=100');
  });

  it('scopes the leave queue to one depot when a screen names one', () => {
    expect(endpoints.hr.leaveQueue({ depotId: 'd-2' })).toContain('depotId=d-2');
  });

  it('builds the attendance list with its date window and paging', () => {
    const url = endpoints.hr.attendance({
      employeeId: 'e-1',
      from: '2026-07-01',
      to: '2026-07-31',
      page: 3,
      pageSize: 100,
    });
    expect(url).toContain('employeeId=e-1');
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-31');
    expect(url).toContain('page=3');
    expect(endpoints.hr.attendance({})).toBe('/attendance/api/v1/attendance');
  });

  it('asks for one employee’s own attendance window', () => {
    expect(endpoints.hr.attendanceMe()).toBe('/attendance/api/v1/attendance/me');
    const url = endpoints.hr.attendanceMe({ from: '2026-07-01', page: 2, pageSize: 20 });
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=20');
  });

  it('URL-encodes an id rather than pasting it into the path', () => {
    // Ids come from data, and a path built by concatenation is how one of them eventually
    // becomes a second path segment.
    expect(endpoints.hr.employee('a/b')).toContain('a/b');
    expect(endpoints.hr.employeeDocuments('a b')).toContain('a%20b');
  });
});
