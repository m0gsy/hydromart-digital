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
 * Deliberately short: the two datasets here are pure history (a security trail and
 * message history). Business records — orders, deliveries, stock — are NOT enforced from
 * a central sweep, because deleting them touches money and inventory and needs its own
 * decision per service, not a generic loop.
 */
const REMOTE_DATASETS = [
  { dataset: 'audit_logs', envKey: 'AUTH_SERVICE_URL', path: '/api/v1/auth/internal/audit-logs/purge', mode: 'DELETE' },
  { dataset: 'notifications_messages', envKey: 'CRM_SERVICE_URL', path: '/api/v1/notifications/internal/purge', mode: 'DELETE' },
  // Proof-of-delivery photos. Delivery used to run its own nightly sweep off a per-depot
  // setting; that setting is gone, so the window lives in exactly one place now.
  { dataset: 'proof_of_delivery', envKey: 'DELIVERY_SERVICE_URL', path: '/api/v1/proofs/purge-expired', mode: 'DELETE' },
  // Departed employee records: identity stripped, biometrics/attendance/reviews deleted,
  // payroll kept without an owner. The employee row itself survives on purpose —
  // deleting it would orphan the money records that must last ten years.
  { dataset: 'hr_employee_records', envKey: 'HR_SERVICE_URL', path: '/api/v1/employees/internal/retention-anonymise', mode: 'DELETE' },
  // Biometrics on their own, far shorter window (30d). A face cannot be reissued after a
  // leak, and its only purpose ends the day the employee does.
  { dataset: 'hr_face_embeddings', envKey: 'HR_SERVICE_URL', path: '/api/v1/employees/internal/retention-biometrics', mode: 'DELETE' },
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
