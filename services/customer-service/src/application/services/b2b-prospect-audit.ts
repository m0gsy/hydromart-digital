import { Logger } from '@nestjs/common';

import { recordAuditEvent } from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';

type Meta = Record<string, string | number | boolean | null | Record<string, number>>;

/**
 * One audit entry for a B2B prospect action, through the platform trail (fail-open: a dropped entry
 * is logged, never blocks the change). Ids, reason codes and counts ONLY: never a phone, a name or a
 * coordinate. That is why the generic mutation interceptor is not attached to these routes: its
 * redacted body still copies the phone and the business name.
 */
export function auditProspect(
  config: CustomerConfigService,
  logger: Logger,
  event: { action: string; actorId: string; target: string; metadata: Meta },
): Promise<void> {
  return recordAuditEvent(
    { authServiceUrl: config.authServiceUrl, internalServiceKey: config.internalServiceKey },
    event,
    logger,
  );
}
