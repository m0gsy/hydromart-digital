export type SavedPaymentType = 'CASH' | 'TRANSFER' | 'QRIS' | 'EWALLET' | 'VA';

export interface PaymentMethodRecord {
  id: string;
  customerId: string;
  type: SavedPaymentType;
  label: string;
  maskedIdentifier: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePaymentMethodData = Omit<
  PaymentMethodRecord,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdatePaymentMethodData = Partial<
  Pick<PaymentMethodRecord, 'type' | 'label' | 'maskedIdentifier'>
>;

export interface PaymentMethodRepository {
  listByCustomer(customerId: string): Promise<PaymentMethodRecord[]>;
  findByIdForCustomer(customerId: string, id: string): Promise<PaymentMethodRecord | null>;
  create(data: CreatePaymentMethodData): Promise<PaymentMethodRecord>;
  update(customerId: string, id: string, patch: UpdatePaymentMethodData): Promise<PaymentMethodRecord>;
  /** Clear the default flag on all of a customer's methods. */
  unsetDefault(customerId: string): Promise<void>;
  markDefault(customerId: string, id: string): Promise<void>;
  /** Clear-all then set-one in a single transaction so "exactly one default" holds under a race. */
  setDefaultExclusive(customerId: string, id: string): Promise<void>;
  delete(customerId: string, id: string): Promise<void>;
  /** Most recently created method, optionally excluding one id (promote-on-delete). */
  findMostRecent(customerId: string, exceptId?: string): Promise<PaymentMethodRecord | null>;
}
