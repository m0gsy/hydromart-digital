// Leave rules. Pure, no Nest/Prisma — every policy question about leave is answered here so
// a change in policy is a change in one file with tests around it.

import { workingDaysInRange } from './calendar';

export type LeaveType = 'ANNUAL' | 'SICK' | 'PERMISSION' | 'EMERGENCY';
export type LeaveStatus =
  | 'PENDING_MANAGER'
  | 'PENDING_HR'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * Which types eat the yearly quota. SICK and EMERGENCY are recorded and paid but never
 * deducted: nobody plans to fall ill, and making illness cost annual leave pushes people to
 * come in sick.
 */
export function deductsQuota(type: LeaveType): boolean {
  return type === 'ANNUAL' || type === 'PERMISSION';
}

/**
 * The days a leave actually consumes: weekdays that were expected working days. A national
 * holiday or a weekly-off day inside the range costs the employee nothing — it was never a
 * day they owed.
 */
export function leaveWorkingDays(
  startIso: string,
  endIso: string,
  holidays: ReadonlySet<string>,
  weeklyOffDays: ReadonlySet<number>,
): string[] {
  return workingDaysInRange(startIso, endIso, holidays, weeklyOffDays);
}

/** Two inclusive date ranges touch at all. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Statuses that still hold the days: a pending or approved request blocks a second one. */
export const BLOCKING_STATUSES: readonly LeaveStatus[] = [
  'PENDING_MANAGER',
  'PENDING_HR',
  'APPROVED',
];

/**
 * The legal transitions. Manager decides first, HR second; the employee may withdraw while
 * it is pending. APPROVED / REJECTED / CANCELLED are terminal — a decision on someone's time
 * off is not quietly re-opened, it is re-applied for.
 */
export type LeaveAction = 'MANAGER_APPROVE' | 'MANAGER_REJECT' | 'HR_APPROVE' | 'HR_REJECT' | 'CANCEL';

const TRANSITIONS: Record<LeaveAction, { from: LeaveStatus; to: LeaveStatus }[]> = {
  MANAGER_APPROVE: [{ from: 'PENDING_MANAGER', to: 'PENDING_HR' }],
  MANAGER_REJECT: [{ from: 'PENDING_MANAGER', to: 'REJECTED' }],
  HR_APPROVE: [{ from: 'PENDING_HR', to: 'APPROVED' }],
  HR_REJECT: [{ from: 'PENDING_HR', to: 'REJECTED' }],
  CANCEL: [
    { from: 'PENDING_MANAGER', to: 'CANCELLED' },
    { from: 'PENDING_HR', to: 'CANCELLED' },
  ],
};

/** The resulting status, or null when the action is not legal from `current`. */
export function nextStatus(current: LeaveStatus, action: LeaveAction): LeaveStatus | null {
  return TRANSITIONS[action].find((t) => t.from === current)?.to ?? null;
}
