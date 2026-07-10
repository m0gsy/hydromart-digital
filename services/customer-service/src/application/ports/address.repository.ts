export interface AddressRecord {
  id: string;
  customerId: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateAddressData = Omit<AddressRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAddressData = Partial<
  Omit<AddressRecord, 'id' | 'customerId' | 'isPrimary' | 'createdAt' | 'updatedAt'>
>;

export interface AddressRepository {
  listByCustomer(customerId: string): Promise<AddressRecord[]>;
  findByIdForCustomer(customerId: string, id: string): Promise<AddressRecord | null>;
  countByCustomer(customerId: string): Promise<number>;
  create(data: CreateAddressData): Promise<AddressRecord>;
  update(customerId: string, id: string, patch: UpdateAddressData): Promise<AddressRecord>;
  /** Clear the primary flag on all of a customer's addresses. */
  unsetPrimary(customerId: string): Promise<void>;
  markPrimary(customerId: string, id: string): Promise<void>;
  delete(customerId: string, id: string): Promise<void>;
  /** Most recently created address, optionally excluding one id (for promote-on-delete). */
  findMostRecent(customerId: string, exceptId?: string): Promise<AddressRecord | null>;
}
