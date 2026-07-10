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
}
