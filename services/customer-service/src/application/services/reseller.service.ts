import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import {
  CreateResellerData,
  PricedField,
  PRICED_FIELDS,
  Reseller,
  ResellerPriceChange,
  ResellerRepository,
  UpdateResellerData,
} from '../ports/reseller.repository';
import { ResellerNotificationPort } from '../ports/reseller-notification.port';
import { ProfileRepository } from '../ports/profile.repository';
import { IdentityPort } from '../ports/identity.port';
import {
  NothingToScheduleError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../domain/errors';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Reseller registry. A reseller must be an existing customer; each customer can be a
 * reseller at most once (customerId is the PK). Deactivation is soft (active=false).
 *
 * Tenant isolation: HQ (HEAD_OFFICE/SUPER_ADMIN) may act on any depot. A depot-locked caller
 * (MANAGER) is forced to their OWN depot on list/register (depotScopeIds — same
 * helper every other staff list endpoint uses) and rejected with Forbidden on get/update of a
 * reseller homed at another depot (assertDepotAccess — the by-id vector DepotScopeGuard can't
 * see, per its own class doc).
 */
export type ResellerView = Reseller & {
  /** The account name behind `customerId`; null when auth-service has none or is down. */
  customerName: string | null;
};

/** K4.2: the outcome of one scheduled-change sweep. `ok` is the J7 flag. */
export interface ScheduledSweepResult {
  ok: boolean;
  due: number;
  applied: number;
}

/**
 * K4.2. The priced fields that actually changed, one entry each, as strings.
 *
 * A patch that sets `discountPct: 10` on a reseller already at 10 is not a change and must
 * not become a history row — an audit trail padded with non-events is one nobody reads,
 * and it would also fire a "your terms changed" message at somebody whose terms did not.
 */
function pricedDiff(
  current: Reseller,
  patch: UpdateResellerData,
): { field: PricedField; oldValue: string; newValue: string }[] {
  const out: { field: PricedField; oldValue: string; newValue: string }[] = [];
  for (const field of PRICED_FIELDS) {
    const next = patch[field];
    if (next === undefined || next === current[field]) continue;
    out.push({ field, oldValue: String(current[field]), newValue: String(next) });
  }
  return out;
}

/** Turns one recorded field back into the patch that applies it. */
function fieldPatch(field: PricedField, value: string): UpdateResellerData {
  return field === 'active' ? { active: value === 'true' } : { [field]: Number(value) };
}

/**
 * What the agen is told they now pay. The flat price wins when set, which is the same
 * precedence checkout applies — a message quoting the percent while the till charges the
 * flat rate would be worse than no message.
 */
function describeTerms(reseller: Reseller): string {
  if (!reseller.active) return 'harga agen dihentikan (kembali ke harga umum)';
  if (reseller.flatGallonPriceIdr > 0) {
    return `Rp ${reseller.flatGallonPriceIdr.toLocaleString('id-ID')} per galon`;
  }
  if (reseller.discountPct > 0) return `diskon ${reseller.discountPct}%`;
  return 'harga umum (tanpa diskon agen)';
}

@Injectable()
export class ResellerService {
  private static readonly HISTORY_LIMIT = 50;
  /** One tick's ceiling; a bigger backlog drains over the following ticks. */
  private static readonly SWEEP_BATCH = 500;
  private readonly logger = new Logger(ResellerService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.ResellerRepository) private readonly resellers: ResellerRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    @Inject(CUSTOMER_TOKENS.ResellerNotification)
    private readonly notifier: ResellerNotificationPort,
  ) {}

  /**
   * §G-3: the roster carried the customer id and nothing else, so the HR console rendered a
   * 36-character UUID as the entire "Customer" column. The name lives on the account, which
   * is auth-service's row, so it is asked for here rather than copied into this table.
   *
   * Fail-soft by construction (see IdentityPort): an unreachable auth-service costs the
   * names, never the roster.
   */
  async list(
    user: AuthenticatedUser,
    filter: { homeDepotId?: string; active?: boolean },
  ): Promise<ResellerView[]> {
    const homeDepotIds = depotScopeIds(user, filter.homeDepotId);
    const rows = await this.resellers.list({ homeDepotIds, active: filter.active });
    const names = await this.identity.getCustomerNames(rows.map((r) => r.customerId));
    return rows.map((r) => ({ ...r, customerName: names.get(r.customerId)?.fullName ?? null }));
  }

  /**
   * A6/A9: the same row, read service-to-service, WITHOUT the depot check.
   *
   * `get` below is the console read and rightly refuses a depot the caller has no business
   * seeing. Pricing is not that question. order-service asks it on behalf of a cashier, and
   * `resellerView` does not list KEPALA_DEPOT or STAFF_DEPOT — the only two roles that ever
   * stand at a till — so forwarding the cashier's token answered 403, the adapter swallowed
   * it as "not a reseller", and every agen buying at a counter was charged retail. Nothing
   * went red: the whole path was one `logger.warn`.
   *
   * The depot question does not disappear, it MOVES: `homeDepotId` rides along and
   * order-service refuses to price a reseller from another depot (A9). That is the right
   * place for it — order-service is the one that knows which depot is selling.
   *
   * Deliberately NOT fixed by adding KEPALA_DEPOT to `resellerView`: that widens RBAC to
   * solve a data-access problem and would also open the agen ROSTER to every depot.
   */
  async pricingFor(customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    return found;
  }

  async get(user: AuthenticatedUser, customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    assertDepotAccess(user, found.homeDepotId);
    return found;
  }

  async register(user: AuthenticatedUser, data: CreateResellerData): Promise<Reseller> {
    // Forced to the caller's own depot for depot-locked roles; HQ keeps the free selector.
    // A reseller lives at exactly ONE depot; the scope call is here to REJECT a depot the
    // caller has no business writing to, not to widen the write.
    depotScopeIds(user, data.homeDepotId);
    // The profile row is customer-service's lazily-created shell for a customer — it only
    // appears once that customer opens something that reads it. Demanding one up front made
    // a real, signed-up customer unenrollable purely because they had never viewed their
    // profile, so create the shell here instead of rejecting.
    if (!(await this.profiles.exists(data.customerId))) {
      await this.profiles.create(data.customerId);
    }
    if (await this.resellers.findById(data.customerId)) throw new ResellerExistsError();
    return this.resellers.create({ ...data, homeDepotId: data.homeDepotId });
  }

  /**
   * K4.2. The same edit as before, plus the three things it never had: a signature, an
   * optional date, and a message to the person whose income it is.
   *
   * `effectiveAt` in the future does NOT touch the profile. The change is written down as
   * a row nobody has applied yet, and the sweep applies it when its moment comes — so
   * "flat Rp5.000 mulai 1 September" is a thing staff can actually do instead of a thing
   * they have to remember to do. Everything else is unchanged and instant, because most
   * edits (a note, a photo, a target) are not somebody's price.
   */
  async update(
    user: AuthenticatedUser,
    customerId: string,
    patch: UpdateResellerData,
    effectiveAt?: Date,
  ): Promise<Reseller> {
    const current = await this.resellers.findById(customerId);
    if (!current) throw new ResellerNotFoundError();
    assertDepotAccess(user, current.homeDepotId);
    // Block moving the reseller into a depot the caller can't touch.
    if (patch.homeDepotId) assertDepotAccess(user, patch.homeDepotId);

    const now = new Date();
    const priced = pricedDiff(current, patch);
    const scheduled = effectiveAt !== undefined && effectiveAt.getTime() > now.getTime();

    if (scheduled) {
      if (priced.length === 0) throw new NothingToScheduleError();
      for (const change of priced) {
        await this.resellers.recordPriceChange({
          customerId,
          changedBy: user.sub,
          ...change,
          effectiveAt,
          appliedAt: null,
        });
      }
      // The profile is untouched on purpose: the agen keeps today's terms until the date
      // they were told about. Returning `current` says exactly that.
      return current;
    }

    const updated = await this.resellers.update(customerId, patch);
    for (const change of priced) {
      await this.resellers.recordPriceChange({
        customerId,
        changedBy: user.sub,
        ...change,
        effectiveAt: now,
        appliedAt: now,
      });
    }
    if (priced.length > 0) await this.announce(updated);
    return updated;
  }

  /** K4.2: this agen's recorded changes, newest first — applied history and pending alike. */
  async priceHistory(
    user: AuthenticatedUser,
    customerId: string,
  ): Promise<ResellerPriceChange[]> {
    const current = await this.resellers.findById(customerId);
    if (!current) throw new ResellerNotFoundError();
    assertDepotAccess(user, current.homeDepotId);
    return this.resellers.listPriceChanges(customerId, ResellerService.HISTORY_LIMIT);
  }

  /**
   * K4.2. Applies every scheduled change whose moment has passed. Driven by the scheduler,
   * not by a request — the whole point of a date is that nobody has to be present for it.
   *
   * Grouped per agen so someone whose discount AND flat price were both scheduled for the
   * same morning gets ONE message about their new terms rather than two contradicting
   * halves. `ok` is false only when there was work and none of it landed (J7).
   */
  async applyScheduled(now: Date = new Date()): Promise<ScheduledSweepResult> {
    const due = await this.resellers.findDuePriceChanges(now, ResellerService.SWEEP_BATCH);
    const byCustomer = new Map<string, ResellerPriceChange[]>();
    for (const row of due) {
      byCustomer.set(row.customerId, [...(byCustomer.get(row.customerId) ?? []), row]);
    }

    let applied = 0;
    for (const [customerId, changes] of byCustomer) {
      const patch: UpdateResellerData = {};
      for (const c of changes) Object.assign(patch, fieldPatch(c.field, c.newValue));
      try {
        const updated = await this.resellers.update(customerId, patch);
        // Stamped only after the profile actually moved — a failed update leaves the
        // change due, and the next tick tries it again rather than losing it.
        for (const c of changes) await this.resellers.markPriceChangeApplied(c.id, now);
        applied += changes.length;
        // Deliberately after the stamp and deliberately unchecked: a dropped notice is a
        // message lost, but re-applying a price change is a price applied twice.
        await this.announce(updated);
      } catch (error) {
        this.logger.error(
          `Scheduled reseller change for ${customerId} failed, staying due: ${(error as Error).message}`,
        );
      }
    }
    return { ok: due.length === 0 || applied > 0, due: due.length, applied };
  }

  /** Renders the new terms the way the agen reads them, then sends one notice. */
  private async announce(reseller: Reseller): Promise<boolean> {
    return this.notifier.priceChanged({
      customerId: reseller.customerId,
      terms: describeTerms(reseller),
      active: reseller.active,
    });
  }

  /** The caller's own reseller row (self endpoint), or null if they are not a reseller. */
  async findMy(customerId: string): Promise<Reseller | null> {
    return this.resellers.findById(customerId);
  }
}
