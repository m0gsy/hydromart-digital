// The HR console's navigation model: every screen the HR rail offers and the gate its row
// needs. Data, not a component (the `lib/ops-nav.ts` pattern): the rail, the phone's bottom
// nav and `canOpenRoute` all read this one table, and it carries no icons, so route-access
// does not bundle the rail. The icons are `HR_ICONS` in `components/hr/hr-rail.tsx`, keyed by
// the `HrHref` below, so a row without one does not build.

import type { Capability } from '@hydromart/access';
import { isServedHere } from '@/lib/deep-link';
import { can, canManageHr, isHq } from '@/lib/roles';

type Role = string | null | undefined;

export interface HrNavRow {
  href: string;
  /** Dictionary KEY — resolved where the item is rendered. */
  label: string;
  adminOnly?: boolean;
  /**
   * CA-1-32: the capability whose absence makes this screen a door to a denial.
   *
   * `adminOnly` above answers one question — "may this reader change HR data" — and two of
   * these screens are not hr-service's at all. Pelanggan reads customer-service's depot CRM
   * (`depotCrm`) and Reseller reads its agen registry (`resellerView`), and neither list
   * includes every role that holds `hrView`. So FINANCE was offered both, and
   * ASSISTANT_SUPERVISOR was offered Reseller, and each one opened onto a 403 rendered as a
   * load failure. Named per item rather than hard-coded in the filter so the next
   * cross-service screen added here has somewhere to say so.
   *
   * A list means any of them: Pinjam karyawan is the requester's (`employeeAssignRequest`) and
   * the decider's (`employeeAssign`) screen alike.
   */
  can?: Capability | readonly Capability[];
}

/** May this role open an HR row with this capability (or any of these)? */
export function mayOpenHrRow(cap: HrNavRow['can'], role: Role): boolean {
  if (!cap) return true;
  return typeof cap === 'string' ? can(cap, role) : cap.some((c) => can(c, role));
}

/*
 * CA-1-33: the phone's bottom nav reads this SAME table.
 *
 * The rail is `hidden sm:flex` and was the whole of the HR console's navigation, so below
 * 640px there was none at all — every one of these twenty screens could only be reached by
 * typing its URL. HQ had the identical defect and CA-2-61 fixed it by making the bar read
 * the rail's own model. Two copies of a nav model is how a door gets hidden in one place
 * and offered in another; there is one here.
 */
export const HR_ITEMS = [
  { href: '/hr', label: 'hrFix.nav.dashboard' },
  { href: '/hr/employees', label: 'hrFix.nav.employees' },
  { href: '/hr/departments', label: 'hrFix.nav.departments' },
  // Both live in customer-service, not hr-service, and their capability lists are narrower
  // than `hrView` — see the `can` note on HrNavRow.
  { href: '/hr/customers', label: 'hrFix.nav.customers', can: 'depotCrm' },
  { href: '/hr/resellers', label: 'hrFix.nav.resellers', can: 'resellerView' },
  { href: '/hr/attendance', label: 'hrFix.nav.attendance' },
  { href: '/hr/leave', label: 'hrFix.nav.leave' },
  // Pay figures: payrollRead (owner decision 2026-11-19), not every HR reader.
  { href: '/hr/payroll', label: 'hrFix.nav.payroll', can: 'payrollRead' },
  { href: '/hr/adjustments', label: 'hrFix.nav.adjustments', can: 'payrollRead' },
  { href: '/hr/allowances', label: 'hrFix.nav.allowances', can: 'payrollRead' },
  // CA-1-34: the kasbon ledger. It had an import wizard and no list.
  { href: '/hr/loans', label: 'hrFix.nav.loans' },
  // A depot manager asks to borrow somebody; HR (who plans directly) has no use for it.
  {
    href: '/hr/depot-requests',
    label: 'hrFix.nav.depotRequests',
    can: ['employeeAssignRequest', 'employeeAssign'],
  },
  { href: '/hr/assets', label: 'hrFix.nav.assets' },
  { href: '/hr/announcements', label: 'hrFix.nav.announcements' },
  { href: '/hr/rules', label: 'hrFix.nav.rules', adminOnly: true },
  { href: '/hr/performance', label: 'hrFix.nav.performance' },
  { href: '/hr/shift', label: 'hrFix.nav.shift' },
  { href: '/hr/calendar', label: 'hrFix.nav.calendar' },
  { href: '/hr/reports', label: 'hrFix.nav.reports' },
  { href: '/hr/settings', label: 'hrFix.nav.settings', adminOnly: true },
  { href: '/hr/audit', label: 'hrFix.nav.audit', adminOnly: true },
  /*
   * CA-1-36. HR staff are employees too — they punch in, take leave and are paid — and the
   * console they work in all day had no link to their own record. `/hr/me` was reachable
   * from the courier profile, the ops rail and the operator shell; the one rail belonging
   * to the people who run HR did not mention it. Last on purpose: it is the reader's own
   * business, not part of the queues above it.
   */
  { href: '/hr/me', label: 'hrFix.nav.me' },
] as const satisfies readonly HrNavRow[];

/** CA-2-17: the way back out, for the roles whose console is elsewhere (see the rail). */
const HQ_DOOR = { href: '/hq', label: 'hrFix.nav.hqConsole' } as const;

export type HrNavItem = (typeof HR_ITEMS)[number] | typeof HQ_DOOR;
export type HrHref = HrNavItem['href'];

/**
 * The items this reader may actually open — the rail's own list, gates and all.
 *
 * Shared with the phone's bottom nav (CA-1-33) so the two cannot disagree: `adminOnly`
 * screens stay hidden from a non-admin on both, and the `/hq` door appears on both for the
 * roles whose console is elsewhere.
 */
export function hrNavItems(role: Role): HrNavItem[] {
  return [
    ...(isHq(role) && isServedHere('/hq') ? [HQ_DOOR] : []),
    ...HR_ITEMS.filter(
      (i: HrNavRow) =>
        isServedHere(i.href) && (!i.adminOnly || canManageHr(role)) && mayOpenHrRow(i.can, role),
    ),
  ];
}
