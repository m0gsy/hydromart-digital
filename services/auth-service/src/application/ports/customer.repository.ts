import { Customer } from '../../domain/customer/customer.entity';
import { Role } from '../../domain/customer/role.enum';

export interface CreateCustomerData {
  phone: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  assignedDepotId?: string | null;
  vehicleType?: string | null;
  plateNumber?: string | null;
}

/**
 * Persistence port for the identity aggregate. The application layer depends only
 * on this interface; a Prisma adapter implements it in the infrastructure layer.
 */
export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  /** Resolve many ids at once (reseller-name display). Missing ids are simply absent. */
  findByIds(ids: string[]): Promise<Customer[]>;
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
  /** `search` matches name or phone — the directory is long past browsing by page. */
  listStaff(
    page: number,
    limit: number,
    role?: Role,
    depotId?: string,
    search?: string,
  ): Promise<{ items: Customer[]; total: number }>;
  /**
   * HQ metric: count of end-customer (role CUSTOMER, non-DELETED) accounts created
   * in the optional [from, to] window. Both bounds inclusive-of-start / exclusive-of-end.
   */
  countCustomersCreated(from?: Date, to?: Date): Promise<number>;
}
