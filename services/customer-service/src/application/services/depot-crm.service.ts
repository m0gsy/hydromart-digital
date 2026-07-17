import { Inject, Injectable } from '@nestjs/common';

import { AddressRecord, AddressRepository } from '../ports/address.repository';
import { DepotCrmRepository } from '../ports/depot-crm.repository';
import { ProfileRepository } from '../ports/profile.repository';
import { MembershipTier } from '../../domain/membership-tier.enum';
import { CUSTOMER_TOKENS } from '../tokens';

/** One directory row for the depot CRM list (6a). */
export interface DepotCustomerListItem {
  id: string;
  fullName: string | null;
  phone: string | null;
  membershipTier: MembershipTier;
  orderCount: number;
  gallonsOnLoan: number;
  depositHeldIdr: number;
  lastOrderAt: string | null;
  isSubscriber: boolean;
}

export interface DepotCrmAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  /** True/false when the depot serviceRadiusKm is known; null while the depot port is unwired. */
  inRadius: boolean | null;
  distanceKm: number | null;
}

export interface DepotDepositLedgerEntry {
  id: string;
  type: 'ISSUE' | 'RETURN';
  quantity: number;
  amountIdr: number;
  at: string;
}

export interface DepotRecentOrder {
  id: string;
  status: string;
  totalIdr: number;
  placedAt: string;
}

export interface DepotCustomerDetail {
  profile: {
    id: string;
    fullName: string | null;
    phone: string | null;
    membershipTier: MembershipTier;
    isSubscriber: boolean;
    orderCount: number;
    totalSpentIdr: number;
    gallonsOnLoan: number;
    depositHeldIdr: number;
    /** Manager churn-risk panel (12b); null while the forecast aggregate is unwired. */
    churnRisk: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  };
  addresses: DepotCrmAddress[];
  depositLedger: DepotDepositLedgerEntry[];
  recentOrders: DepotRecentOrder[];
}

/**
 * Depot customer directory (Depot Operator 6a/7a, Depot Manager 12b). Profile + address data
 * is served for real from customer-service; the order and gallon-deposit aggregates are
 * cross-service and returned as zero/empty for now.
 *
 * ponytail: TODO wire order/depot aggregate — orderCount/lastOrderAt/totalSpent/isSubscriber
 * from an order-service port; gallonsOnLoan/depositHeldIdr + the deposit ledger + address
 * inRadius from a depot-service (gallon-issue/gallon-return + serviceRadiusKm) port. The DTO
 * and FE already render these fields, so wiring is drop-in once those internal endpoints exist.
 */
@Injectable()
export class DepotCrmService {
  constructor(
    @Inject(CUSTOMER_TOKENS.DepotCrmRepository) private readonly crm: DepotCrmRepository,
    @Inject(CUSTOMER_TOKENS.AddressRepository) private readonly addresses: AddressRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  async listDepotCustomers(depotId: string, q?: string): Promise<DepotCustomerListItem[]> {
    const rows = await this.crm.listDepotCustomers(depotId, q);
    return rows.map((r) => ({
      id: r.customerId,
      fullName: r.fullName,
      phone: r.phone,
      membershipTier: r.membershipTier,
      // TODO wire order/depot aggregate (see class doc).
      orderCount: 0,
      gallonsOnLoan: 0,
      depositHeldIdr: 0,
      lastOrderAt: null,
      isSubscriber: false,
    }));
  }

  async getDepotDetail(customerId: string, _depotId: string): Promise<DepotCustomerDetail> {
    const [profile, addressRecords] = await Promise.all([
      this.profiles.findByCustomerId(customerId),
      this.addresses.listByCustomer(customerId),
    ]);
    const primary = addressRecords.find((a) => a.isPrimary) ?? addressRecords[0] ?? null;

    return {
      profile: {
        id: customerId,
        fullName: primary?.recipientName ?? null,
        phone: primary?.phone ?? null,
        membershipTier: profile?.membershipTier ?? MembershipTier.BASIC,
        // TODO wire order/depot aggregate (see class doc).
        isSubscriber: false,
        orderCount: 0,
        totalSpentIdr: 0,
        gallonsOnLoan: 0,
        depositHeldIdr: 0,
        churnRisk: null,
      },
      addresses: addressRecords.map((a) => this.toAddress(a)),
      // TODO wire order/depot aggregate — deposit ledger + recent orders (see class doc).
      depositLedger: [],
      recentOrders: [],
    };
  }

  private toAddress(a: AddressRecord): DepotCrmAddress {
    return {
      id: a.id,
      label: a.label,
      recipientName: a.recipientName,
      phone: a.phone,
      addressLine: a.addressLine,
      city: a.city,
      province: a.province,
      latitude: a.latitude,
      longitude: a.longitude,
      isPrimary: a.isPrimary,
      // TODO wire depot serviceRadiusKm/location port to compute these.
      inRadius: null,
      distanceKm: null,
    };
  }
}
