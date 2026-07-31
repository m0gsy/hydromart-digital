import { Inject, Injectable } from '@nestjs/common';

import { AddressRecord, AddressRepository } from '../ports/address.repository';
import { DepotCrmRepository } from '../ports/depot-crm.repository';
import { IdentityPort } from '../ports/identity.port';
import { OrderCrmPort, DepotCustomerOrderStats } from '../ports/order-crm.port';
import { ProfileRepository } from '../ports/profile.repository';
import { MembershipTier } from '../../domain/membership-tier.enum';
import {
  classifySegment,
  daysBetween,
  needsFollowUp,
  CrmSegment,
} from '../../domain/crm-segment';
import { CustomerConfigService } from '../../config/customer-config.service';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * One directory row for the depot CRM list (6a). The cross-service aggregates
 * (order/gallon/deposit) are `null` — "not computed yet", not zero — until the
 * order/depot ports are wired; the FE renders null as "—".
 */
export interface DepotCustomerListItem {
  id: string;
  fullName: string | null;
  phone: string | null;
  membershipTier: MembershipTier;
  orderCount: number | null;
  gallonsOnLoan: number | null;
  depositHeldIdr: number | null;
  lastOrderAt: string | null;
  isSubscriber: boolean | null;
  /** CRM lifecycle segment (Fase 4); null when order-service is unreachable. */
  segment: CrmSegment | null;
}

/**
 * One at-risk customer surfaced in the depot CRM follow-up queue (Fase 4).
 *
 * The last order is NOT nullable here even though it is on the underlying stats row:
 * a customer who has never ordered cannot have gone quiet, so `needsFollowUp` excludes
 * them and nothing in this queue lacks a date. The response DTO stays nullable — it is
 * a published contract — but inside the service the invariant is the type.
 */
export interface CrmFollowUp {
  customerId: string;
  name: string | null;
  phone: string | null;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  orderCount: number;
  totalSpentIdr: number;
}

/** Depot CRM lifecycle dashboard (Fase 4, /dashboard/crm). */
export interface CrmDashboard {
  counts: { baru: number; aktif: number; inactive: number; total: number };
  /** Share of customers with >1 order, 0..100. */
  repeatRatePct: number;
  /** Customers past the follow-up threshold, most-overdue first. */
  followUps: CrmFollowUp[];
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
    /** null = "not computed yet" (cross-service aggregate unwired), not zero. */
    isSubscriber: boolean | null;
    orderCount: number | null;
    totalSpentIdr: number | null;
    gallonsOnLoan: number | null;
    depositHeldIdr: number | null;
    /** Manager churn-risk panel (12b); null while the forecast aggregate is unwired. */
    churnRisk: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  };
  addresses: DepotCrmAddress[];
  depositLedger: DepotDepositLedgerEntry[];
  recentOrders: DepotRecentOrder[];
}

/**
 * Case-insensitive contains over the name the staff member can actually SEE. Applied after
 * the account-name overlay rather than in SQL, because the searchable name is not in this
 * service's database.
 *
 * ponytail: in-memory scan over one depot's customers. Push it into the query only if a
 * single depot's directory ever gets big enough for that to matter.
 */
function matches(item: DepotCustomerListItem, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    (item.fullName?.toLowerCase().includes(needle) ?? false) ||
    (item.phone?.toLowerCase().includes(needle) ?? false)
  );
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
    @Inject(CUSTOMER_TOKENS.OrderCrmPort) private readonly orderCrm: OrderCrmPort,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    private readonly config: CustomerConfigService,
  ) {}

  async listDepotCustomers(depotId: string, q?: string): Promise<DepotCustomerListItem[]> {
    const [rows, stats] = await Promise.all([
      this.crm.listDepotCustomers(depotId),
      this.orderCrm.depotCustomerStats(depotId),
    ]);
    // The account name, not the primary address's recipient — a customer who never saved
    // an address has an account name but no address, and used to list as "Tanpa nama".
    const identities = await this.identity.getCustomerNames(rows.map((r) => r.customerId));
    const statsBy = new Map(stats.map((s) => [s.customerId, s]));
    const now = new Date();
    const t = this.config.crmThresholds;
    const items = rows.map((r) => {
      const s = statsBy.get(r.customerId);
      const account = identities.get(r.customerId);
      return {
        id: r.customerId,
        fullName: account?.fullName ?? r.fullName,
        phone: account?.phone ?? r.phone,
        membershipTier: r.membershipTier,
        // Order aggregates from order-service; null (not 0) when it had no data / was unreachable.
        orderCount: s ? s.orderCount : null,
        lastOrderAt: s?.lastOrderAt ? s.lastOrderAt.toISOString() : null,
        segment: s ? classifySegment(s, now, t) : null,
        // Still cross-service-unwired (depot-service gallon/deposit ledger) — null, never fabricated.
        gallonsOnLoan: null,
        depositHeldIdr: null,
        isSubscriber: null,
      };
    });
    return q && q.trim() !== '' ? items.filter((i) => matches(i, q.trim())) : items;
  }

  /**
   * CRM lifecycle dashboard for a depot (Fase 4): segment counts, repeat rate, and the
   * follow-up queue (customers past the follow-up threshold, most-overdue first). The WA
   * follow-up link is built client-side from `phone` — no auto-send.
   *
   * ponytail: queue is DERIVED on read (no persisted follow-up table / cron) — it self-clears
   * when a customer orders again. Add a `crm_follow_ups` table only if ops need to mark
   * "contacted" or assign an owner; the segment math above is the reusable core either way.
   */
  async getCrmDashboard(depotId: string): Promise<CrmDashboard> {
    const stats = await this.orderCrm.depotCustomerStats(depotId);
    const now = new Date();
    const t = this.config.crmThresholds;
    const counts = { baru: 0, aktif: 0, inactive: 0, total: stats.length };
    let repeat = 0;
    const followUps: CrmFollowUp[] = [];
    for (const s of stats) {
      const seg = classifySegment(s, now, t);
      if (seg === 'BARU') counts.baru++;
      else if (seg === 'AKTIF') counts.aktif++;
      else counts.inactive++;
      if (s.orderCount > 1) repeat++;
      if (needsFollowUp(s, now, t)) followUps.push(this.toFollowUp(s, now));
    }
    // Longest-silent first — who to call today. Both sides are non-null here: only rows
    // that passed needsFollowUp are in this list, and that requires a last order.
    followUps.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);
    return {
      counts,
      repeatRatePct: counts.total > 0 ? Math.round((repeat / counts.total) * 100) : 0,
      followUps,
    };
  }

  /**
   * Only ever called for a row that passed `needsFollowUp`, which is false without a
   * `lastOrderAt` — so the date is present by construction. It was re-checked here with
   * a ternary that could not take its null branch; asserting the invariant instead keeps
   * the caller's guarantee visible rather than quietly duplicated.
   */
  private toFollowUp(s: DepotCustomerOrderStats, now: Date): CrmFollowUp {
    const lastOrderAt = s.lastOrderAt as Date;
    return {
      customerId: s.customerId,
      name: s.name,
      phone: s.phone,
      lastOrderAt: lastOrderAt.toISOString(),
      daysSinceLastOrder: daysBetween(lastOrderAt, now),
      orderCount: s.orderCount,
      totalSpentIdr: Math.round(s.totalSpent),
    };
  }

  /** Ids of all customers whose favourite depot is this one (service-to-service). */
  listCustomerIdsByDepot(depotId: string): Promise<string[]> {
    return this.crm.findIdsByDepot(depotId);
  }

  async getDepotDetail(customerId: string, _depotId: string): Promise<DepotCustomerDetail> {
    const [profile, addressRecords, identities] = await Promise.all([
      this.profiles.findByCustomerId(customerId),
      this.addresses.listByCustomer(customerId),
      this.identity.getCustomerNames([customerId]),
    ]);
    const primary = addressRecords.find((a) => a.isPrimary) ?? addressRecords[0] ?? null;
    const account = identities.get(customerId);

    return {
      profile: {
        id: customerId,
        // Same rule as the list: account name first, address recipient as the fallback.
        fullName: account?.fullName ?? primary?.recipientName ?? null,
        phone: account?.phone ?? primary?.phone ?? null,
        membershipTier: profile?.membershipTier ?? MembershipTier.BASIC,
        // Cross-service aggregates unwired — null ("unknown"), never a fabricated 0/false.
        isSubscriber: null,
        orderCount: null,
        totalSpentIdr: null,
        gallonsOnLoan: null,
        depositHeldIdr: null,
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
