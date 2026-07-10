import { Inject, Injectable } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { AddressLimitError, AddressNotFoundError } from '../../domain/errors';
import {
  AddressRecord,
  AddressRepository,
  UpdateAddressData,
} from '../ports/address.repository';
import { CUSTOMER_TOKENS } from '../tokens';

export interface CreateAddressInput {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isPrimary?: boolean;
}

/**
 * Address book with the invariants from PRD §17:
 * - BR-004: at most `maxAddresses` per customer.
 * - Exactly one primary; the first address is always primary; deleting the primary
 *   promotes the most-recent remaining address.
 * - Every operation is scoped to the caller's customerId (no cross-tenant access).
 */
@Injectable()
export class AddressService {
  constructor(
    @Inject(CUSTOMER_TOKENS.AddressRepository) private readonly addresses: AddressRepository,
    private readonly config: CustomerConfigService,
  ) {}

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
    const count = await this.addresses.countByCustomer(customerId);
    if (count >= this.config.maxAddresses) {
      throw new AddressLimitError(this.config.maxAddresses);
    }

    const makePrimary = input.isPrimary === true || count === 0;
    if (makePrimary) {
      await this.addresses.unsetPrimary(customerId);
    }

    return this.addresses.create({
      customerId,
      label: input.label,
      recipientName: input.recipientName,
      phone: input.phone,
      addressLine: input.addressLine,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      isPrimary: makePrimary,
    });
  }

  async update(customerId: string, id: string, patch: UpdateAddressData): Promise<AddressRecord> {
    await this.getOrThrow(customerId, id);
    return this.addresses.update(customerId, id, patch);
  }

  async setPrimary(customerId: string, id: string): Promise<AddressRecord> {
    await this.getOrThrow(customerId, id);
    await this.addresses.unsetPrimary(customerId);
    await this.addresses.markPrimary(customerId, id);
    return this.getOrThrow(customerId, id);
  }

  async remove(customerId: string, id: string): Promise<void> {
    const address = await this.getOrThrow(customerId, id);
    await this.addresses.delete(customerId, id);
    if (address.isPrimary) {
      const next = await this.addresses.findMostRecent(customerId, id);
      if (next) {
        await this.addresses.markPrimary(customerId, next.id);
      }
    }
  }
}
