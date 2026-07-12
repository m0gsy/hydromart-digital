import { Inject, Injectable } from '@nestjs/common';

import { PaymentMethodNotFoundError } from '../../domain/errors';
import {
  CreatePaymentMethodData,
  PaymentMethodRecord,
  PaymentMethodRepository,
  SavedPaymentType,
  UpdatePaymentMethodData,
} from '../ports/payment-method.repository';
import { CUSTOMER_TOKENS } from '../tokens';

export interface CreatePaymentMethodInput {
  type: SavedPaymentType;
  label: string;
  maskedIdentifier?: string;
  isDefault?: boolean;
}

/**
 * Saved payment instruments (spec 4f). Invariants mirror the address book:
 * - Exactly one default; the first saved method is always default; deleting the
 *   default promotes the most-recent remaining method.
 * - Every operation is scoped to the caller's customerId.
 */
@Injectable()
export class PaymentMethodService {
  constructor(
    @Inject(CUSTOMER_TOKENS.PaymentMethodRepository)
    private readonly methods: PaymentMethodRepository,
  ) {}

  list(customerId: string): Promise<PaymentMethodRecord[]> {
    return this.methods.listByCustomer(customerId);
  }

  async getOrThrow(customerId: string, id: string): Promise<PaymentMethodRecord> {
    const method = await this.methods.findByIdForCustomer(customerId, id);
    if (!method) {
      throw new PaymentMethodNotFoundError();
    }
    return method;
  }

  async create(customerId: string, input: CreatePaymentMethodInput): Promise<PaymentMethodRecord> {
    const count = (await this.methods.listByCustomer(customerId)).length;
    const makeDefault = input.isDefault === true || count === 0;
    if (makeDefault) {
      await this.methods.unsetDefault(customerId);
    }
    const data: CreatePaymentMethodData = {
      customerId,
      type: input.type,
      label: input.label,
      maskedIdentifier: input.maskedIdentifier ?? null,
      isDefault: makeDefault,
    };
    return this.methods.create(data);
  }

  async update(
    customerId: string,
    id: string,
    patch: UpdatePaymentMethodData,
  ): Promise<PaymentMethodRecord> {
    await this.getOrThrow(customerId, id);
    return this.methods.update(customerId, id, patch);
  }

  async setDefault(customerId: string, id: string): Promise<PaymentMethodRecord> {
    await this.getOrThrow(customerId, id);
    await this.methods.unsetDefault(customerId);
    await this.methods.markDefault(customerId, id);
    return this.getOrThrow(customerId, id);
  }

  async remove(customerId: string, id: string): Promise<void> {
    const method = await this.getOrThrow(customerId, id);
    await this.methods.delete(customerId, id);
    if (method.isDefault) {
      const next = await this.methods.findMostRecent(customerId, id);
      if (next) {
        await this.methods.markDefault(customerId, next.id);
      }
    }
  }
}
