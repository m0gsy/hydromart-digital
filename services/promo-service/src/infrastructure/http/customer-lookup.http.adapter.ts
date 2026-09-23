import { Injectable, Logger } from '@nestjs/common';

import { CustomerContact, CustomerLookupPort } from '../../application/ports/customer-lookup.port';
import { PromoConfigService } from '../../config/promo-config.service';

interface DirectoryRecipient {
  customerId: string;
  name: string;
  phone: string;
}

/**
 * PRM-9: resolves ONE customer's name + phone from customer-service, by id.
 *
 * It used to download the entire staff directory — every name and phone number in the
 * network — on the acting staff member's token and filter it in memory. The note above this
 * code called that acceptable because granting is rare; what it missed is that rarity does
 * not make the payload smaller, and the whole directory crossing a service boundary to
 * answer a one-row question is the exposure, not the cost.
 *
 * Internal key rather than the caller's token, like every other service-to-service read
 * here: the answer should not depend on whether the staff member who clicked "grant"
 * happens to hold `customerDirectory`.
 *
 * Fails OPEN (returns null) on any error — the grant itself still happens; only the
 * notification is skipped.
 */
@Injectable()
export class CustomerLookupHttpAdapter implements CustomerLookupPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerLookupHttpAdapter.name);

  constructor(private readonly config: PromoConfigService) {}

  async resolve(customerId: string): Promise<CustomerContact | null> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    const url = `${base}/api/v1/profile/internal/contact/${customerId}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(CustomerLookupHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const match = (await res.json()) as DirectoryRecipient | null;
      // A customer with no primary address has no number to notify: that is a null, not a
      // contact with undefined fields.
      return match?.name && match?.phone ? { name: match.name, phone: match.phone } : null;
    } catch (error) {
      this.logger.warn(`customer lookup skipped: ${(error as Error).message}`);
      return null;
    }
  }
}
