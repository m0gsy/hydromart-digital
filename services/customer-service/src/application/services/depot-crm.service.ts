import { Inject, Injectable, Optional } from '@nestjs/common';
import { haversineKm } from '@hydromart/platform';

import { AddressRecord, AddressRepository } from '../ports/address.repository';
import { DepotCrmRepository } from '../ports/depot-crm.repository';
import { IdentityPort } from '../ports/identity.port';
import { OrderCrmPort, DepotCustomerOrderStats } from '../ports/order-crm.port';
import { DepotLedgerPort } from '../ports/depot-ledger.port';
import { ProfileRepository } from '../ports/profile.repository';
import { ChurnRiskPort } from '../ports/churn-risk.port';
import { DepotGeo, DepotProfilePort } from '../ports/depot-profile.port';
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
 * is served from customer-service; order counts and the gallon-deposit ledger are read
 * cross-service over `OrderCrmPort` / `DepotLedgerPort`, both of which fail soft.
 *
 * Anything still unwired is `null`, never a fabricated 0 — see the field comments. Left:
 * `isSubscriber` (depot subscriptions have no customer id to match on), `churnRisk`
 * (forecast-service has no port here) and address `inRadius` (needs depot serviceRadiusKm).
 */
@Injectable()
export class DepotCrmService {
  constructor(
    @Inject(CUSTOMER_TOKENS.DepotCrmRepository) private readonly crm: DepotCrmRepository,
    @Inject(CUSTOMER_TOKENS.AddressRepository) private readonly addresses: AddressRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
    @Inject(CUSTOMER_TOKENS.OrderCrmPort) private readonly orderCrm: OrderCrmPort,
    @Inject(CUSTOMER_TOKENS.DepotLedgerPort) private readonly depotLedger: DepotLedgerPort,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    private readonly config: CustomerConfigService,
    // Optional and LAST on purpose: every existing test double builds this service with
    // seven arguments, and without these two the three fields they feed simply stay null —
    // exactly what they were before. A required parameter here would have meant editing
    // dozens of call sites to say "and this one is still unwired".
    @Optional()
    @Inject(CUSTOMER_TOKENS.DepotProfilePort)
    private readonly depotProfile?: DepotProfilePort,
    @Optional()
    @Inject(CUSTOMER_TOKENS.ChurnRiskPort)
    private readonly churn?: ChurnRiskPort,
  ) {}

  /**
   * The depot's customers — §I: everyone, not just the ones somebody typed into Excel.
   *
   * The repository unions the profile's favourite depot with the reseller registry. The
   * third source cannot go there: "has ordered from this depot" lives in order-service's
   * database, and it arrives as `depotCustomerStats`. It used to be a LEFT-JOIN enrichment,
   * so a customer who registered themselves and ordered ten times was simply dropped.
   *
   * `depotCustomerStats` already excludes the anonymous counter-sale sentinel at the
   * source, so an unnamed walk-in cannot enter the directory as a person.
   */
  /**
   * Record a first-checkout depot as this customer's favourite — §I. Only when they have
   * none: see `claimFavoriteDepotIfUnset` for why moving an existing one would be wrong.
   */
  claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean> {
    return this.profiles.claimFavoriteDepotIfUnset(customerId, depotId);
  }

  async listDepotCustomers(depotId: string, q?: string): Promise<DepotCustomerListItem[]> {
    const [profileRows, stats, ledger, subscriberIds] = await Promise.all([
      this.crm.listDepotCustomers(depotId),
      this.orderCrm.depotCustomerStats(depotId),
      // J-2. `null` (not []) when depot-service is unreachable or unconfigured, so the two
      // columns can say "belum tersambung" instead of printing a zero nobody checked.
      this.depotLedger.gallonsByCustomer(depotId),
      // S2. One read for the whole directory, not one per row: the answer is a set.
      this.depotProfile ? this.depotProfile.subscriberIds(depotId) : Promise.resolve(null),
    ]);
    const subscribers = subscriberIds && new Set(subscriberIds);
    const ledgerBy = ledger && new Map(ledger.map((row) => [row.customerId, row]));
    const statsBy = new Map(stats.map((s) => [s.customerId, s]));
    const known = new Set(profileRows.map((r) => r.customerId));
    const rows = [
      ...profileRows,
      // Ordered here, but never recorded as belonging here. Name and phone come off the
      // order snapshot until the account lookup below replaces them.
      ...stats
        .filter((s) => !known.has(s.customerId))
        .map((s) => ({
          customerId: s.customerId,
          fullName: s.name ?? null,
          phone: s.phone ?? null,
          membershipTier: MembershipTier.BASIC,
        })),
    ];

    // The account name, not the primary address's recipient — a customer who never saved
    // an address has an account name but no address, and used to list as "Tanpa nama".
    const identities = await this.identity.getCustomerNames(rows.map((r) => r.customerId));
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
        // J-2: real now. `null` means the ledger could not be read at all — a customer who
        // simply owes nothing comes back as 0, and the two are not the same answer.
        gallonsOnLoan: ledgerBy ? (ledgerBy.get(r.customerId)?.gallonsOnLoan ?? 0) : null,
        depositHeldIdr: ledgerBy ? (ledgerBy.get(r.customerId)?.depositHeldIdr ?? 0) : null,
        // S2: matched on the linked account id. A subscription typed in as a free-text name
        // is one nobody linked, not one that does not exist — which is why the create route
        // now insists on a real customer. Null (not false) when depot-service went quiet.
        isSubscriber: subscribers ? subscribers.has(r.customerId) : null,
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

  /**
   * One customer's card at one depot.
   *
   * Every cross-service number here used to be a hardcoded `null`, so the screen said
   * "belum tersambung" forever even though the directory one click away was already
   * showing the same customer's real order count. It now asks the same two ports the
   * list does, plus the two per-customer reads that only this screen needs.
   *
   * ponytail: `depotCustomerStats` is a whole-depot aggregate filtered down to one row.
   * That is one extra HTTP call the list already makes for every customer at once — add a
   * per-customer variant upstream only if a depot's directory ever gets big enough to hurt.
   */
  async getDepotDetail(customerId: string, depotId: string): Promise<DepotCustomerDetail> {
    const [profile, addressRecords, identities, stats, ledgerRows, ledger, orders, subscriberIds, geo, churnRisk] =
      await Promise.all([
        this.profiles.findByCustomerId(customerId),
        this.addresses.listByCustomer(customerId),
        this.identity.getCustomerNames([customerId]),
        this.orderCrm.depotCustomerStats(depotId),
        // J-2: null (not []) when depot-service could not answer at all.
        this.depotLedger.gallonsByCustomer(depotId),
        this.depotLedger.customerLedger(depotId, customerId),
        this.orderCrm.customerOrders(depotId, customerId),
        this.depotProfile ? this.depotProfile.subscriberIds(depotId) : Promise.resolve(null),
        // S2. Where the depot is, so each saved address can be judged against its radius.
        this.depotProfile ? this.depotProfile.geo(depotId) : Promise.resolve(null),
        this.churn ? this.churn.bandFor(customerId) : Promise.resolve(null),
      ]);
    const primary = addressRecords.find((a) => a.isPrimary) ?? addressRecords[0] ?? null;
    const account = identities.get(customerId);
    const stat = stats.find((s) => s.customerId === customerId);
    const gallons = ledgerRows?.find((r) => r.customerId === customerId);

    return {
      profile: {
        id: customerId,
        // Same rule as the list: account name first, address recipient as the fallback.
        fullName: account?.fullName ?? primary?.recipientName ?? null,
        phone: account?.phone ?? primary?.phone ?? null,
        membershipTier: profile?.membershipTier ?? MembershipTier.BASIC,
        // Same null-vs-zero rule as the directory: a customer who has never ordered comes
        // back as 0, order-service being unreachable comes back as null. Different answers.
        orderCount: stats.length > 0 ? (stat?.orderCount ?? 0) : null,
        totalSpentIdr: stats.length > 0 ? Math.round(stat?.totalSpent ?? 0) : null,
        gallonsOnLoan: ledgerRows ? (gallons?.gallonsOnLoan ?? 0) : null,
        depositHeldIdr: ledgerRows ? (gallons?.depositHeldIdr ?? 0) : null,
        // Same rule as the directory — see there.
        isSubscriber: subscriberIds ? subscriberIds.includes(customerId) : null,
        // S2: scored by forecast-service, one customer at a time. Null covers both "the
        // service could not be read" and "they have never ordered" — neither of which is
        // LOW, the one answer a manager acts on by doing nothing.
        churnRisk,
      },
      addresses: addressRecords.map((a) => this.toAddress(a, geo)),
      depositLedger: ledger,
      recentOrders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalIdr: o.totalIdr,
        placedAt: o.placedAt,
      })),
    };
  }

  private toAddress(a: AddressRecord, geo: DepotGeo | null): DepotCrmAddress {
    // S2. Both null unless BOTH ends have coordinates: an address nobody pinned cannot be
    // in or out of a radius, and answering "0 km, in range" for it would send a courier to
    // a place the system does not actually know. Same haversine order-service routes
    // checkout with (@hydromart/platform), so the shop and the card cannot disagree.
    const measurable = geo !== null && a.latitude !== null && a.longitude !== null;
    const distanceKm = measurable
      ? Math.round(haversineKm(a.latitude as number, a.longitude as number, geo.lat, geo.lng) * 10) / 10
      : null;
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
      inRadius: distanceKm === null ? null : distanceKm <= (geo as DepotGeo).serviceRadiusKm,
      distanceKm,
    };
  }
}
