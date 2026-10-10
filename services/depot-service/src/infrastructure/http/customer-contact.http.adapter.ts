import { Injectable, Logger } from '@nestjs/common';

import { CustomerContact, CustomerContactPort } from '../../application/ports/customer-contact.port';
import { DepotConfigService } from '../../config/depot-config.service';

interface ContactBody {
  name?: string | null;
  phone?: string | null;
}

/**
 * Resolves ONE customer's name and phone from customer-service, by id, over the shared
 * internal key — the same read promo-service makes to address a voucher notification. Never
 * the whole directory: the answer to "who is customer X" is one row.
 *
 * Fails OPEN to `null` on any error and when unconfigured. A customer with no number on file
 * has none to remind; the sweep counts them as skipped.
 */
@Injectable()
export class CustomerContactHttpAdapter implements CustomerContactPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerContactHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async resolveByPhone(phone: string, fullName?: string, depotId?: string): Promise<string | null> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    try {
      const res = await fetch(`${base}/api/v1/customers/internal/resolve-by-phone`, {
        method: 'POST',
        headers: { 'x-internal-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ phone, ...(fullName ? { fullName } : {}), ...(depotId ? { depotId } : {}) }),
        signal: AbortSignal.timeout(CustomerContactHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json()) as { customerId?: string } | null;
      return body?.customerId ?? null;
    } catch (error) {
      this.logger.warn(`customer resolve-by-phone failed: ${(error as Error).message}`);
      return null;
    }
  }

  async resolve(customerId: string): Promise<CustomerContact | null> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    try {
      const res = await fetch(`${base}/api/v1/profile/internal/contact/${encodeURIComponent(customerId)}`, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(CustomerContactHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json()) as ContactBody | null;
      // No primary address means no number: a null, not a contact with undefined fields.
      return body?.name && body?.phone ? { name: body.name, phone: body.phone } : null;
    } catch (error) {
      this.logger.warn(`customer contact lookup skipped: ${(error as Error).message}`);
      return null;
    }
  }
}
