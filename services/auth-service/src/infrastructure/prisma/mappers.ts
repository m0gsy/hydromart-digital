import {
  Customer as PrismaCustomer,
  CustomerStatus as PrismaCustomerStatus,
  OtpPurpose as PrismaOtpPurpose,
  Role as PrismaRole,
} from '@prisma/client';

import { Customer } from '../../domain/customer/customer.entity';
import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { Role } from '../../domain/customer/role.enum';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';

/*
 * Domain and Prisma enums intentionally share identical string members, so mapping
 * is a value-preserving cast. These helpers localize that coupling to one file.
 */
export const toDomainRole = (role: PrismaRole): Role => role as unknown as Role;
export const toPrismaRole = (role: Role): PrismaRole => role as unknown as PrismaRole;

export const toDomainStatus = (status: PrismaCustomerStatus): CustomerStatus =>
  status as unknown as CustomerStatus;
export const toPrismaStatus = (status: CustomerStatus): PrismaCustomerStatus =>
  status as unknown as PrismaCustomerStatus;

export const toDomainOtpPurpose = (purpose: PrismaOtpPurpose): OtpPurpose =>
  purpose as unknown as OtpPurpose;
export const toPrismaOtpPurpose = (purpose: OtpPurpose): PrismaOtpPurpose =>
  purpose as unknown as PrismaOtpPurpose;

/** Map a persisted customer row to the domain aggregate. */
export function toCustomerEntity(row: PrismaCustomer): Customer {
  return Customer.fromPersistence({
    id: row.id,
    phone: row.phone,
    email: row.email,
    fullName: row.fullName,
    role: toDomainRole(row.role),
    status: toDomainStatus(row.status),
    googleSub: row.googleSub,
    avatarUrl: row.avatarUrl,
    phoneVerifiedAt: row.phoneVerifiedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
