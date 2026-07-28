import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { CustomerDataPort } from '../../application/ports/customer-data.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * The customer-service half of a PDP request (item 13), over the shared
 * INTERNAL_SERVICE_KEY.
 *
 * Fails CLOSED, unlike the welcome-notification adapter: a missing URL or a rejected
 * call raises. An export silently missing the customer's addresses would look complete
 * to whoever receives it, and an anonymisation that skipped this call would leave the
 * recipient name and phone of every delivery address in place — the exact data the
 * customer asked to have removed.
 */
@Injectable()
export class CustomerDataHttpAdapter implements CustomerDataPort {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: AuthConfigService) {}

  async export(customerId: string): Promise<Record<string, unknown>> {
    const response = await this.call(`internal/pdp-export?customerId=${customerId}`, 'GET');
    return (await response.json()) as Record<string, unknown>;
  }

  async anonymise(customerId: string): Promise<void> {
    await this.call('internal/pdp-anonymise', 'POST', { customerId });
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
    const { customerUrl, internalKey } = this.config.customerData;
    if (!customerUrl || !internalKey) {
      throw new ServiceUnavailableException(
        'CUSTOMER_SERVICE_URL/INTERNAL_SERVICE_KEY not configured; PDP requests cannot be processed.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CustomerDataHttpAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${customerUrl}/api/v1/customers/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `customer-service unreachable: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(`customer-service responded ${response.status}`);
    }
    return response;
  }
}
