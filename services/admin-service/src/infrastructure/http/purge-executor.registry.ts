import { Provider } from '@nestjs/common';

import { PURGE_EXECUTORS, PurgeExecutor } from '../../application/ports/purge-executor.port';
import { AdminConfigService } from '../../config/admin-config.service';
import { RemotePurgeExecutor } from './remote-purge.executor';

/**
 * Which datasets retention is actually enforced for today.
 *
 * The `dataset` string must match a row in `retention_policies` exactly — a typo means
 * the policy is silently never enforced, which is the failure this whole feature exists
 * to make visible, so keep them in step. Datasets absent from this list are reported as
 * UNENFORCED by the sweep rather than skipped quietly.
 *
 * Deliberately limited to data that is not a business record: history (a security trail,
 * message history), evidence photos, and personal data of people who never became customers.
 * Business records — orders, deliveries, stock, payments — are NOT enforced from a central
 * sweep, because deleting them touches money and inventory and needs its own decision per
 * service, not a generic loop.
 */
const REMOTE_DATASETS = [
  {
    dataset: 'audit_logs',
    envKey: 'AUTH_SERVICE_URL',
    path: '/api/v1/auth/internal/audit-logs/purge',
    mode: 'DELETE',
  },
  {
    dataset: 'notifications_messages',
    envKey: 'CRM_SERVICE_URL',
    path: '/api/v1/notifications/internal/purge',
    mode: 'DELETE',
  },
  // Proof-of-delivery photos. Delivery used to run its own nightly sweep off a per-depot
  // setting; that setting is gone, so the window lives in exactly one place now.
  {
    dataset: 'proof_of_delivery',
    envKey: 'DELIVERY_SERVICE_URL',
    path: '/api/v1/proofs/purge-expired',
    mode: 'DELETE',
  },
  /*
   * CA-3-07 / CA-3-53 — the two promises the privacy policy makes in writing and no executor
   * kept. Both had a policy row (migration 20260902140000) and nothing to run it, so the sweep
   * reported them UNENFORCED while the public text said "dihapus".
   *
   * payment_proof: the transfer receipt a customer uploads, 12 months. The payment ROW is a
   * financial record and stays; only the photo (and the pointer to it) goes.
   */
  {
    dataset: 'payment_proof',
    envKey: 'PAYMENT_SERVICE_URL',
    path: '/api/v1/payments/internal/purge-proofs',
    mode: 'DELETE',
  },
  // franchise_applications_rejected: name, WhatsApp number and a GPS pin of somebody we told no,
  // 24 months from the decision. Approved applications are the paper trail of how a depot came
  // to exist and are not touched; a pending one has no clock yet.
  {
    dataset: 'franchise_applications_rejected',
    envKey: 'DEPOT_SERVICE_URL',
    path: '/api/v1/franchise-applications/internal/purge-rejected',
    mode: 'DELETE',
  },
  // Departed employee records: identity stripped, biometrics/attendance/reviews deleted,
  // payroll kept without an owner. The employee row itself survives on purpose —
  // deleting it would orphan the money records that must last ten years.
  {
    dataset: 'hr_employee_records',
    envKey: 'HR_SERVICE_URL',
    path: '/api/v1/employees/internal/retention-anonymise',
    mode: 'DELETE',
  },
  /*
   * HR-4, owner decision 2026-09-17: attendance selfies of staff who are still here.
   *
   * The only sweep that ever deleted one was the departed-employee scrub, so a face frame
   * taken on a Tuesday was kept for as long as that person worked here. The punch, its
   * hours and its match score stay — they are payroll evidence; the photo is the proof of
   * a dispute nobody raised, and ninety days is well past the cycle it could be raised in.
   */
  {
    dataset: 'hr_attendance_photos',
    envKey: 'HR_SERVICE_URL',
    path: '/api/v1/attendance/internal/retention-photos',
    mode: 'DELETE',
  },
  /*
   * HR-2: the HR service keeps its own audit trail in its own database. `audit_logs` above is
   * auth-service's; this one had no window at all and no sweep knew it existed, so it held the
   * personal data of departed staff indefinitely. Same two years as the other trail.
   */
  {
    dataset: 'hr_audit_logs',
    envKey: 'HR_SERVICE_URL',
    path: '/api/v1/hr-audit/internal/retention',
    mode: 'DELETE',
  },
  // Biometrics on their own, far shorter window (30d). A face cannot be reissued after a
  // leak, and its only purpose ends the day the employee does.
  {
    dataset: 'hr_face_embeddings',
    envKey: 'HR_SERVICE_URL',
    path: '/api/v1/employees/internal/retention-biometrics',
    mode: 'DELETE',
  },
] as const;

export const purgeExecutorProvider: Provider = {
  provide: PURGE_EXECUTORS,
  inject: [AdminConfigService],
  useFactory: (config: AdminConfigService): PurgeExecutor[] =>
    REMOTE_DATASETS.map(
      (d) =>
        new RemotePurgeExecutor(
          d.dataset,
          config.serviceUrl(d.envKey),
          d.path,
          config.internalServiceKey,
          d.mode,
        ),
    ).filter((e) => e.configured),
};
