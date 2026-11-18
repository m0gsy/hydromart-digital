// Flow PR-4: every queue that waits for somebody's decision, for the "Menunggu keputusan Anda"
// card on the approvals screens. Each queue has its own adapter because each list answers in
// its own shape; a count is read only from an answer that carries a total. The others show
// "Buka" and nothing is invented for them. No backend change.
//
// Not here: the depot approval queue (it IS the approvals screen the card sits on), and the
// depot loan-of-staff requests (decided on each employee's record; there is no queue screen).

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { can, canManageHr } from '@/lib/roles';
import { canOpenRoute } from '@/lib/route-access';

type Role = string | null | undefined;

/** The envelope of a paged list: hr-service `{ rows, total }`, payout `{ items, total, ... }`. */
export interface Totalled {
  total: number;
}
export const totalOf = (page: Totalled): number => page.total;

export interface DecisionQueue {
  key: string;
  /** i18n key: the label of the screen where the queue is decided. */
  label: string;
  /** Where the queue is decided. */
  href: string;
  /** May this role decide what waits here? */
  decides: (role: Role) => boolean;
  /** How many wait, when the list answers with a total. Absent: the card offers "Buka". */
  count?: (role: Role) => Promise<number>;
}

const leaveStage = (role: Role) => (canManageHr(role) ? 'PENDING_HR' : 'PENDING_MANAGER');

export const DECISION_QUEUES: DecisionQueue[] = [
  {
    key: 'kasbon',
    label: 'ops.nav.hrLoans',
    href: '/hr/loans/requests',
    decides: (role) => can('kasbonApprove', role),
    count: () => api.get<Totalled>(endpoints.hr.loanRequestsPendingCount, true).then(totalOf),
  },
  {
    // Two stages: a manager decides PENDING_MANAGER, HR admin PENDING_HR (the screen's default).
    key: 'leave',
    label: 'ops.nav.hrLeave',
    href: '/hr/leave',
    decides: (role) => can('leaveApprove', role) || canManageHr(role),
    count: (role) =>
      api.get<Totalled>(endpoints.hr.leavePendingCount(leaveStage(role)), true).then(totalOf),
  },
  {
    key: 'expenses',
    label: 'ops.nav.expenseClaims',
    href: '/dashboard/expense-claims',
    decides: (role) => can('expenseApprove', role),
    count: () => api.get<Totalled>(endpoints.expenseApprovals.pendingCount, true).then(totalOf),
  },
  // A bare list, no total: owners with a balance to release.
  {
    key: 'payouts',
    label: 'hq.nav.payments',
    href: '/hq/payments',
    decides: (role) => can('hqPayout', role) || can('hqPayoutApprove', role),
  },
  // Undecided spans three stages and the list filters one: no total to read.
  {
    key: 'franchiseApplications',
    label: 'hq.nav.applications',
    href: '/hq/applications',
    decides: (role) => can('franchiseApplications', role),
  },
  // A bare list, no total.
  {
    key: 'dataRequests',
    label: 'hq.nav.pdp',
    href: '/hq/pdp',
    decides: (role) => can('pdpRequests', role),
  },
];

/** The queues this role decides, that this binary serves and the role may open. */
export function queuesFor(role: Role): DecisionQueue[] {
  return DECISION_QUEUES.filter((q) => q.decides(role) && canOpenRoute(q.href, role));
}
