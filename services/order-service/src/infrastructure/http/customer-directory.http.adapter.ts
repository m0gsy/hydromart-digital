import { Injectable, Logger } from '@nestjs/common';

import { CounterBuyerDirectoryUnconfiguredError } from '../../domain/errors';
import { OrderConfigService } from '../../config/order-config.service';
import { CustomerDirectoryPort } from '../../application/ports/customer-directory.port';
import { DeliveryAddressSnapshot } from '../../application/ports/order.repository';

/**
 * Tells customer-service where a customer just bought (§I), over the shared internal key.
 *
 * Internal rather than the customer's own bearer: a counter sale is rung up on the
 * cashier's token, and the subscription runner has no token at all, so a caller-token route
 * would work for exactly one of the three order paths.
 *
 * Fails OPEN, like every other non-critical checkout call: the order exists whatever
 * happens here, and the worst case is the customer stays out of that depot's directory
 * until their next order.
 */
@Injectable()
export class CustomerDirectoryHttpAdapter implements CustomerDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean> {
    const key = this.config.internalServiceKey;
    if (!key) return false;
    const url = `${this.config.customerServiceUrl}/api/v1/customers/internal/favorite-depot`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CustomerDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ customerId, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json().catch(() => null)) as { claimed?: boolean } | null;
      return body?.claimed === true;
    } catch (error) {
      this.logger.warn(`Favourite depot not recorded: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * D10: the customer's primary address, for a subscription depot staff created for them.
   *
   * Fails to `null`, never throws and never invents: the caller refuses the subscription
   * rather than sending water to a guess.
   */
  async primaryAddress(customerId: string): Promise<DeliveryAddressSnapshot | null> {
    const key = this.config.internalServiceKey;
    if (!key) return null;
    const url = `${this.config.customerServiceUrl}/api/v1/addresses/internal/primary?customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(CustomerDirectoryHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      // No `.catch` on the parse: a body that is not JSON throws into the same catch below
      // and answers `null` there. Adding one would only leave a callback nothing ever runs.
      const body = (await res.json()) as Record<string, unknown> | null;
      if (!body || typeof body.addressLine !== 'string') return null;
      return {
        recipientName: String(body.recipientName ?? ''),
        phone: String(body.phone ?? ''),
        addressLine: body.addressLine,
        city: String(body.city ?? ''),
        province: String(body.province ?? ''),
        postalCode: (body.postalCode as string | null) ?? null,
        latitude: (body.latitude as number | null) ?? null,
        longitude: (body.longitude as number | null) ?? null,
        notes: (body.notes as string | null) ?? null,
      };
    } catch (error) {
      this.logger.warn(`Primary address not read: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * K3.1: null means "could not reach it", and it must not also mean "there is nothing to
   * reach".
   *
   * Both used to return null. The counter fails CLOSED for a named buyer, so the cashier was
   * handed "nomor pembeli belum bisa dicek sekarang — coba lagi" against a wall: with no
   * `INTERNAL_SERVICE_KEY` the answer is identical for as long as that deployment stands.
   * They retried, it failed, they retried, and nothing anywhere said the key was missing.
   *
   * Thrown from HERE, not from the caller, because this is the only layer that knows: the
   * key belongs to this adapter, and a fake or in-process directory needs no key at all — a
   * guard in the service would refuse work the port could perfectly well do. The first
   * attempt at this fix put it in the service and ten tests said so.
   *
   * Note the asymmetry with the rest of this class, which is deliberate: the other methods
   * fail OPEN, so an absent key correctly yields null there. This one is the caller's only
   * source of a buyer id it must have.
   */
  async resolveByPhone(phone: string, fullName: string | null, depotId: string): Promise<string | null> {
    const key = this.config.internalServiceKey;
    if (!key) throw new CounterBuyerDirectoryUnconfiguredError();
    const url = `${this.config.customerServiceUrl}/api/v1/customers/internal/resolve-by-phone`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CustomerDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
        // C9: omitted rather than sent as null when the cashier typed no name — the DTO
        // treats absent as "unnamed", and a null would have to be special-cased there too.
        body: JSON.stringify({ phone, fullName: fullName ?? undefined, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json().catch(() => null)) as { customerId?: string } | null;
      return body?.customerId ?? null;
    } catch (error) {
      // Fail OPEN like the rest of this adapter: the sale goes through as anonymous rather
      // than the cashier being stopped mid-transaction.
      this.logger.warn(`Counter buyer not resolved: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
