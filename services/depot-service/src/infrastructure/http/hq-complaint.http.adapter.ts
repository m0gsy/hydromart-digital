import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { HqComplaint, HqComplaintPort } from '../../application/ports/hq-complaint.port';

/**
 * CA-2-58 — mirrors a depot's customer complaint into head office's ticket queue, via
 * admin-service's internal route, authenticated by the shared INTERNAL_SERVICE_KEY.
 *
 * Fails SOFT, and the softness is recorded rather than swallowed: a null comes back, the
 * incident stores it, and the depot screen shows the complaint as NOT forwarded. Refusing
 * to save a depot's own complaint because head office was unreachable would throw away the
 * one copy that is certainly wanted — but a mirror that quietly did not happen is the shape
 * this whole row is about, so it is never reported as done.
 */
@Injectable()
export class HqComplaintHttpAdapter implements HqComplaintPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(HqComplaintHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async open(complaint: HqComplaint): Promise<string | null> {
    const { adminServiceUrl, internalServiceKey } = this.config;
    if (!adminServiceUrl || !internalServiceKey) {
      this.logger.debug('HQ complaint mirror skipped (admin-service URL or internal key unset)');
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HqComplaintHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${adminServiceUrl}/api/v1/tickets/internal/from-depot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          subject: complaint.subject,
          customerRef: complaint.customerRef,
          customerPhone: complaint.customerPhone,
          depotRef: complaint.depotId,
          orderRef: complaint.orderRef ?? undefined,
          body: complaint.body,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
      const ticket = (await res.json()) as { id?: string };
      return ticket.id ?? null;
    } catch (error) {
      this.logger.warn(`HQ complaint mirror failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
