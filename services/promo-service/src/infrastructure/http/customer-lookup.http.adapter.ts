import { Injectable, Logger } from '@nestjs/common';

import { CustomerContact, CustomerLookupPort } from '../../application/ports/customer-lookup.port';
import { PromoConfigService } from '../../config/promo-config.service';

interface DirectoryRecipient {
  customerId: string;
  name: string;
  phone: string;
}

/**
 * Resolves a single customer's name+phone by scanning customer-service's staff directory
 * (GET /profile/directory), forwarding the acting staff member's token. ponytail: a bulk
 * scan filtered client-side — grant is a low-frequency admin action; add a by-id endpoint
 * on customer-service if grant volume grows. Fails OPEN (returns null) on any error.
 */
@Injectable()
export class CustomerLookupHttpAdapter implements CustomerLookupPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerLookupHttpAdapter.name);

  constructor(private readonly config: PromoConfigService) {}

  async resolve(customerId: string, authorization: string): Promise<CustomerContact | null> {
    const base = this.config.customerServiceUrl;
    if (!base || !authorization) return null;
    const url = `${base}/api/v1/profile/directory`;
    try {
      const res = await fetch(url, {
        headers: { authorization },
        signal: AbortSignal.timeout(CustomerLookupHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const recipients = (await res.json()) as DirectoryRecipient[];
      const match = recipients.find((r) => r.customerId === customerId);
      return match ? { name: match.name, phone: match.phone } : null;
    } catch (error) {
      this.logger.warn(`customer lookup skipped: ${(error as Error).message}`);
      return null;
    }
  }
}
