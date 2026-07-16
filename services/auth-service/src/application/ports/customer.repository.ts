import { Customer } from '../../domain/customer/customer.entity';
import { Role } from '../../domain/customer/role.enum';

export interface CreateCustomerData {
  phone: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

/**
 * Persistence port for the identity aggregate. The application layer depends only
 * on this interface; a Prisma adapter implements it in the infrastructure layer.
 */
export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByPhone(phone: string): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  findByGoogleSub(googleSub: string): Promise<Customer | null>;
  create(data: CreateCustomerData): Promise<Customer>;
  /** Persist mutations made to an existing aggregate. */
  save(customer: Customer): Promise<Customer>;
  /**
   * Staff directory (PRD Module 7): non-customer accounts, newest first, paginated.
   * Excludes DELETED accounts; filters to one role when given.
   */
  listStaff(page: number, limit: number, role?: Role): Promise<{ items: Customer[]; total: number }>;
  /**
   * HQ metric: count of end-customer (role CUSTOMER, non-DELETED) accounts created
   * in the optional [from, to] window. Both bounds inclusive-of-start / exclusive-of-end.
   */
  countCustomersCreated(from?: Date, to?: Date): Promise<number>;
}
