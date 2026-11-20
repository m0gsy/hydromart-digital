import { Inject, Injectable } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { AddressNotFoundError, AddressPinInvalidError } from '../../domain/errors';
import {
  AddressRecord,
  AddressRepository,
  CreateAddressData,
  UpdateAddressData,
  PinSource,
} from '../ports/address.repository';
import { CUSTOMER_TOKENS } from '../tokens';

/** Both halves or neither (an import has none yet), and never 0,0. */
function assertPin(lat: number | null | undefined, lng: number | null | undefined): void {
  if ((lat == null) !== (lng == null) || (lat === 0 && lng === 0)) {
    throw new AddressPinInvalidError();
  }
  // In range too: the imports call this directly, not via a DTO.
  if (lat != null && lng != null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
    throw new AddressPinInvalidError();
  }
}

export interface CreateAddressInput {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province?: string | null;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  isPrimary?: boolean;
  pinAccuracyM?: number;
  pinSource?: PinSource;
}

/**
 * Address book with the invariants from PRD §17:
 * - BR-004: at most `maxAddresses` per customer.
 * - Exactly one primary; the first address is always primary; deleting the primary
 *   promotes the most-recent remaining address.
 * - Every operation is scoped to the caller's customerId (no cross-tenant access).
 */
/**
 * What is kept about how good a pin is: nothing without a pin, and metres only for a GPS fix —
 * a typed pin has no accuracy to claim, whatever was sent with it.
 */
function pinQualityFor(
  lat: number | null | undefined,
  source: PinSource | null | undefined,
  accuracy: number | null | undefined,
): { pinSource: PinSource | null; pinAccuracyM: number | null } {
  if (lat == null) return { pinSource: null, pinAccuracyM: null };
  return { pinSource: source ?? null, pinAccuracyM: source === 'GPS' ? (accuracy ?? null) : null };
}

@Injectable()
export class AddressService {
  constructor(
    @Inject(CUSTOMER_TOKENS.AddressRepository) private readonly addresses: AddressRepository,
    private readonly config: CustomerConfigService,
  ) {}

  /**
   * D10: the address a subscription created FOR this customer by depot staff delivers to.
   *
   * The primary one, because that is the same rule the customer's own subscription screen
   * uses — one definition of "where a standing order goes", not two that can disagree.
   * `null` when they have none: the caller has to refuse rather than invent one.
   */
  async primary(customerId: string): Promise<AddressRecord | null> {
    const all = await this.addresses.listByCustomer(customerId);
    return all.find((a) => a.isPrimary) ?? all[0] ?? null;
  }

  list(customerId: string): Promise<AddressRecord[]> {
    return this.addresses.listByCustomer(customerId);
  }

  async getOrThrow(customerId: string, id: string): Promise<AddressRecord> {
    const address = await this.addresses.findByIdForCustomer(customerId, id);
    if (!address) {
      throw new AddressNotFoundError();
    }
    return address;
  }

  async create(customerId: string, input: CreateAddressInput): Promise<AddressRecord> {
    assertPin(input.latitude, input.longitude);
    const data: Omit<CreateAddressData, 'isPrimary'> = {
      customerId,
      label: input.label,
      recipientName: input.recipientName,
      phone: input.phone,
      addressLine: input.addressLine,
      // Trimmed here, where every write passes (the imports call this directly, not the DTO).
      city: input.city.trim(),
      province: input.province,
      postalCode: input.postalCode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      ...pinQualityFor(input.latitude, input.pinSource, input.pinAccuracyM),
      notes: input.notes ?? null,
    };

    // The cap, the primary decision and the insert are one step per customer: counted
    // separately, two requests both saw room under the cap, and two "add as primary" both won.
    return this.addresses.createWithinLimit(
      data,
      input.isPrimary === true,
      this.config.maxAddresses,
    );
  }

  async update(customerId: string, id: string, patch: UpdateAddressData): Promise<AddressRecord> {
    const current = await this.getOrThrow(customerId, id); // ownership first: someone else's is a 404
    assertPin(patch.latitude, patch.longitude);
    const data = patch.city === undefined ? { ...patch } : { ...patch, city: patch.city.trim() };
    // The quality belongs to the pin: a moved pin takes what was sent with it (or nothing);
    // an edit that re-sends the same pin (the /addresses form always does) keeps it — unless
    // the stored pin's quality was never known (saved before it was kept) and is now told.
    const moved =
      patch.latitude !== undefined &&
      (patch.latitude !== current.latitude || patch.longitude !== current.longitude);
    const told =
      patch.latitude !== undefined && current.pinSource == null && patch.pinSource !== undefined;
    if (moved || told) {
      Object.assign(data, pinQualityFor(patch.latitude, patch.pinSource, patch.pinAccuracyM));
    } else {
      delete data.pinAccuracyM;
      delete data.pinSource;
    }
    return this.addresses.update(customerId, id, data);
  }

  async setPrimary(customerId: string, id: string): Promise<AddressRecord> {
    await this.getOrThrow(customerId, id);
    await this.addresses.setPrimaryExclusive(customerId, id);
    return this.getOrThrow(customerId, id);
  }

  async remove(customerId: string, id: string): Promise<void> {
    if (!(await this.addresses.removeAndPromote(customerId, id))) {
      throw new AddressNotFoundError();
    }
  }
}
