export interface CartItemRecord {
  id: string;
  customerId: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartRepository {
  findByCustomer(customerId: string): Promise<CartItemRecord[]>;
  findItem(customerId: string, productId: string): Promise<CartItemRecord | null>;
  /** Insert or overwrite the quantity for (customer, product). */
  upsert(customerId: string, productId: string, quantity: number): Promise<CartItemRecord>;
  remove(customerId: string, productId: string): Promise<void>;
  clear(customerId: string): Promise<void>;
}
