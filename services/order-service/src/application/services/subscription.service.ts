import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { FeatureFlagReader } from '@hydromart/platform';

import {
  DepotUnavailableError,
  ProductUnavailableError,
  SubscriptionsDisabledError,
  SubscriptionAddressNotRoutableError,
  SubscriptionCustomerAddressMissingError,
  SubscriptionNotActionableError,
  SubscriptionNotFoundError,
} from '../../domain/errors';
import { nextDeliveryOnOrAfter } from '../../domain/subscription';
import { DepotChange, RerouteCounts, rerouteCounts, withDepotChange, selectNearestDepot } from '../../domain/geo';
import { OrderConfigService } from '../../config/order-config.service';
import { DeliveryAddressSnapshot } from '../ports/order.repository';
import { DepotLocation } from '../ports/depot-directory.port';
import { NotificationPort } from '../ports/notification.port';
import { CustomerDirectoryPort } from '../ports/customer-directory.port';
import { ProductCatalogPort } from '../ports/product-catalog.port';
import {
  CreateSubscriptionData,
  SubscriptionFrequency,
  SubscriptionNetworkSummary,
  SubscriptionRecord,
  SubscriptionRepository,
} from '../ports/subscription.repository';
import { ORDER_TOKENS } from '../tokens';
import { OrderService } from './order.service';

export interface CreateSubscriptionInput {
  productId: string;
  quantity: number;
  frequency: SubscriptionFrequency;
  firstDeliveryAt: Date;
  address: DeliveryAddressSnapshot;
  /** P3-5: the saved address it was picked from; the plan then follows that address. */
  addressId?: string;
}

/**
 * D2: consecutive failed cycles before the sweep stops asking and pauses the plan.
 *
 * Three, not one: a single failure is usually a blip — crm down, a depot unreachable for a
 * minute — and pausing a customer's water over one of those is worse than retrying. Three
 * consecutive ticks is a condition, not a blip.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * D2: the same `instanceof Error` dance was about to appear in three places along one
 * failure path. One helper, one branch — three copies would be three branches nobody would
 * ever exercise separately, and a rejection that is not an Error is the same fact wherever
 * it surfaces.
 */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

/**
 * What the customer reads after "…kami jeda dulu karena {{reason}}." The raw message stays in
 * the failure record and the log; it was an English sentence (and, for a pulled product, a
 * UUID) inside an Indonesian one.
 */
export const pauseReason = (err: unknown): string => {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ORDER_OUT_OF_SERVICE_AREA') return 'alamatnya sekarang di luar area layanan depot kami';
  if (code === 'ORDER_PRODUCT_UNAVAILABLE') return 'produknya sedang tidak dijual';
  if (code === 'ORDER_PIN_REQUIRED' || code === 'SUBSCRIPTION_ADDRESS_NOT_ROUTABLE') {
    return 'alamatnya belum punya pin lokasi';
  }
  return `pengirimannya gagal ${MAX_CONSECUTIVE_FAILURES} kali berturut-turut`;
};

/** Deliveries a single subscription generates per 30-day month, by cadence. */
const MONTHLY_DELIVERY_RATE: Record<SubscriptionFrequency, number> = {
  WEEKLY: 30 / 7,
  BIWEEKLY: 30 / 14,
  MONTHLY: 1,
};

/** Network aggregate (18c). estMonthlyDeliveries is an ESTIMATE — a rupiah MRR
 * can't be derived here (subscriptions snapshot no price), so we report the
 * expected monthly delivery volume instead. */
/**
 * J7 — what one fulfilment sweep did, including what it could not do.
 *
 * This used to be `{ placed }` alone, and that single number is why a dead flow was
 * invisible: the loop below catches per subscription, so a round in which every plan
 * threw returns `{ placed: 0 }` — the same body, byte for byte, as a round with nothing
 * due. `scripts/scheduler/sweep.sh` saw HTTP 200 either way and refreshed the heartbeat
 * the container healthcheck reads, so the scheduler reported healthy while the sweep
 * accomplished nothing, for as long as that lasted.
 *
 * `ok` is the verdict, decided here where the counters mean something rather than by a
 * shell script guessing at field names. False only for a round that failed at something
 * and got nothing done. A sweep that placed forty orders and lost one is working — call
 * that unhealthy and the scheduler pins to red forever, which hides an outage exactly as
 * well as always-green does.
 */
export interface SubscriptionSweepResult {
  placed: number;
  failed: number;
  ok: boolean;
}

export interface SubscriptionNetworkSummaryView extends SubscriptionNetworkSummary {
  estMonthlyDeliveries: number;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(ORDER_TOKENS.SubscriptionRepository)
    private readonly subs: SubscriptionRepository,
    @Inject(ORDER_TOKENS.ProductCatalog)
    private readonly catalog: ProductCatalogPort,
    private readonly orders: OrderService,
    private readonly config: OrderConfigService,
    // D2: a plan the sweep gives up on has to TELL the customer. A standing order that
    // stops arriving with no message is the bug this closes.
    @Inject(ORDER_TOKENS.Notification)
    private readonly notification: NotificationPort,
    // D10: a depot-created subscription delivers to the CUSTOMER's own primary address,
    // read here rather than typed by whoever filled the form.
    @Inject(ORDER_TOKENS.CustomerDirectory)
    private readonly customers: CustomerDirectoryPort,
    // `subscriptions.galon`: fail-open (the reader answers enabled when admin-service is
    // unreachable). Optional so an unwired deployment keeps accepting subscriptions.
    @Optional()
    @Inject(ORDER_TOKENS.FeatureFlags)
    private readonly flags?: FeatureFlagReader,
  ) {}

  /**
   * The subscription discount in force at `depotId` (null = global default), as a
   * fraction. The shop quotes this so its "hemat N%" line matches what the sweep
   * actually charges at that depot instead of a copy-pasted 5%.
   */
  discountRate(depotId: string | null): number {
    return this.config.subscriptionDiscountRate(depotId);
  }

  async create(customerId: string, input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    return (await this.createRouted(customerId, input)).record;
  }

  /** The plan, and the depot its pin routes to — who delivers, prices and is credited for it. */
  private async createRouted(
    customerId: string,
    input: CreateSubscriptionInput,
  ): Promise<{ record: SubscriptionRecord; servingDepotId: string }> {
    // Only NEW plans are refused: plans already running keep their schedule, so switching the
    // flag off never silently stops water a customer is already expecting.
    if (this.flags && !(await this.flags.isEnabled('subscriptions.galon'))) {
      throw new SubscriptionsDisabledError();
    }
    // D3: refuse a plan nobody could ever fulfil, while somebody is still on the screen to
    // fix it. The sweep resolves a depot from this snapshot and has nothing to fall back on
    // — no customer to ask, no depot picker, no session — so an address with no map pin, or
    // one no depot serves, becomes a subscription that fails every run and is then paused.
    const serving = await this.assertDeliverable(input.address);
    const product = await this.catalog.getProduct(input.productId);
    if (!product || !product.active) {
      throw new ProductUnavailableError(input.productId);
    }
    const data: CreateSubscriptionData = {
      customerId,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      quantity: input.quantity,
      frequency: input.frequency,
      nextDeliveryAt: input.firstDeliveryAt,
      ...input.address,
      addressId: input.addressId ?? null,
    };
    return { record: await this.subs.create(data), servingDepotId: serving.id };
  }

  /**
   * D10: a subscription depot staff set up FOR a customer, on the same engine.
   *
   * The depot console used to keep its own table of "plans" that produced nothing — no
   * sweep, nothing writing a next run, and a screen showing a date that froze where the
   * operator typed it and drifted further into the past every day. This connects that table
   * to the engine D1, D2, D4, D6, D8 and D9 repaired, rather than growing a second engine
   * that would inherit none of it.
   *
   * The address is the customer's OWN primary one, read here rather than taken from the
   * caller: a depot operator typing an address on somebody else's behalf is how the
   * unroutable plans D3 refuses got created in the first place. No address, no
   * subscription — and the error says which, so the operator can act on it.
   */
  async createForCustomer(
    customerId: string,
    input: Omit<CreateSubscriptionInput, 'address'>,
  ): Promise<SubscriptionRecord & { servingDepotId: string }> {
    const primary = await this.customers.primaryAddress(customerId);
    if (!primary) throw new SubscriptionCustomerAddressMissingError();
    // The id names the saved address the plan follows; it must never reach the snapshot,
    // where it would be read as the subscription's own id.
    const { id: addressId, ...address } = primary;
    // Owner decision 2026-11-21: made even when another depot serves the address — the sweep
    // routes by the pin, so THAT depot delivers, prices and is credited for it, and the
    // depot console records it there (servingDepotId), not under whoever typed it in.
    const { record, servingDepotId } = await this.createRouted(customerId, {
      ...input,
      address,
      addressId,
    });
    return { ...record, servingDepotId };
  }

  async list(customerId: string): Promise<SubscriptionRecord[]> {
    return this.subs.listByCustomer(customerId);
  }

  /** A PDP export: every plan, with the address and pin each one delivers to. */
  exportPerson(customerId: string): Promise<{ items: SubscriptionRecord[]; truncated: boolean }> {
    return this.subs.listAllForExport(customerId);
  }

  /** HQ network summary (18c): active counts, per-plan breakdown + delivery estimate. */
  async networkSummary(): Promise<SubscriptionNetworkSummaryView> {
    const summary = await this.subs.networkSummary();
    const estMonthlyDeliveries = Math.round(
      summary.plans.reduce((n, p) => n + p.subscribers * MONTHLY_DELIVERY_RATE[p.frequency], 0),
    );
    return { ...summary, estMonthlyDeliveries };
  }

  /**
   * P3-3: which active plans would change depot if `change` were saved. The sweep routes every
   * plan by its pin on every run, so suspending or moving a depot silently re-routes them;
   * this is the number to read first.
   */
  async reroutePreview(change: DepotChange): Promise<RerouteCounts> {
    const [depots, pins] = await Promise.all([
      this.orders.activeDepots(),
      this.subs.listActivePins(),
    ]);
    // An empty network is a real answer for a reopening (every pin is unserved before it);
    // for anything else there is nothing to preview against.
    if (depots === null || (depots.length === 0 && change.active !== true)) {
      throw new DepotUnavailableError();
    }
    return rerouteCounts(pins, depots, withDepotChange(depots, change));
  }

  /**
   * Where each plan named delivers from now: the depot its pin is in, by the very rule the sweep
   * places its next order by. depot-service files the console row of a depot-made plan under
   * this answer (owner decision 2026-11-21: a plan is listed under the depot that delivers it).
   * A plan with no pin, or one no active depot serves, answers null; unknown ids are left out.
   */
  async servingDepots(ids: readonly string[]): Promise<{ id: string; depotId: string | null }[]> {
    const depots = await this.orders.activeDepots();
    // Without the network there is no answer at all, which is not "served by nobody".
    if (depots === null) throw new DepotUnavailableError();
    const pins = await this.subs.routingPins(ids);
    return pins.map((p) => ({
      id: p.id,
      depotId:
        p.latitude == null || p.longitude == null
          ? null
          : (selectNearestDepot(p.latitude, p.longitude, depots)?.id ?? null),
    }));
  }

  /**
   * P3-5: a plan made from a saved address follows it. When the customer edits that address
   * (a better pin, a new patokan), the next delivery goes to the edit — but only while it is
   * still the same depot's: a plan never changes depot behind anyone's back (the reroute
   * preview is how a depot change is said out loud). Anything unreadable keeps the snapshot,
   * and so does an address that lost its pin or moved to another depot's area.
   */
  private async followSavedAddress(
    sub: SubscriptionRecord,
    snapshot: DeliveryAddressSnapshot,
    fresh: DeliveryAddressSnapshot | null,
    depots: DepotLocation[] | null,
  ): Promise<DeliveryAddressSnapshot> {
    if (!sub.addressId || !depots?.length || !fresh) return snapshot;
    if (fresh.latitude == null || fresh.longitude == null || sameSnapshot(fresh, snapshot)) {
      return snapshot;
    }
    const after = selectNearestDepot(fresh.latitude, fresh.longitude, depots)?.id ?? null;
    if (after === null) return snapshot;
    // Never to another depot, nor out of an area no depot serves any more (that is the
    // reroute preview's to say). Only a plan with no pin of its own — written before pins
    // were required — has no depot to leave, and may take the pinned edit.
    if (snapshot.latitude != null && snapshot.longitude != null) {
      const before = selectNearestDepot(snapshot.latitude, snapshot.longitude, depots)?.id;
      if (before !== after) return snapshot;
    }
    try {
      // Only if the plan is still the one read: a move the customer made during this run
      // must not be written over, and an automatic follow is not a reason to reset failures.
      return (await this.subs.followAddress(sub.id, sub.addressId, sub.updatedAt, fresh))
        ? fresh
        : snapshot;
    } catch (err) {
      this.logger.warn(`Subscription ${sub.id} kept its address: ${messageOf(err)}`);
      return snapshot;
    }
  }

  private async owned(customerId: string, id: string): Promise<SubscriptionRecord> {
    const sub = await this.subs.findById(id);
    if (!sub || sub.customerId !== customerId) throw new SubscriptionNotFoundError();
    return sub;
  }

  async pause(customerId: string, id: string): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.setStatus(id, 'PAUSED');
  }

  /**
   * D4: resuming moves the schedule forward, it does not just flip the status back.
   *
   * Pausing never touched `nextDeliveryAt`, so a plan slept holding a due date in the past
   * and the first sweep after resuming placed a delivery immediately — the customer paused
   * their water and got a gallon on the doorstep the moment they came back.
   *
   * The new date steps the plan's OWN cadence from its old due date, so a Tuesday plan
   * stays on Tuesdays. Resuming a plan that is not actually overdue leaves its date alone.
   */
  async resume(customerId: string, id: string, now: Date): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.resume(id, nextDeliveryOnOrAfter(sub.nextDeliveryAt, sub.frequency, now));
  }

  /**
   * DEP-23: the depot console pauses the ENGINE subscription, not just its own row. Internal
   * only (InternalAuthGuard on the route): the caller holds the engine id and acts for an
   * operator, so there is no customer to compare it against. Same state change as `pause`.
   */
  async pauseById(id: string): Promise<SubscriptionRecord> {
    const sub = await this.subs.findById(id);
    if (!sub) throw new SubscriptionNotFoundError();
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.setStatus(id, 'PAUSED');
  }

  /** DEP-23: the internal twin of `resume`; moves the schedule forward exactly the same way. */
  async resumeById(id: string, now: Date): Promise<SubscriptionRecord> {
    const sub = await this.subs.findById(id);
    if (!sub) throw new SubscriptionNotFoundError();
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.resume(id, nextDeliveryOnOrAfter(sub.nextDeliveryAt, sub.frequency, now));
  }

  async cancel(customerId: string, id: string): Promise<SubscriptionRecord> {
    await this.owned(customerId, id);
    return this.subs.setStatus(id, 'CANCELLED');
  }

  /**
   * K1.9 — a plan was locked to whichever address happened to be primary when it was made.
   *
   * There was no picker at signup, no way to change it afterwards, and switching your
   * primary address did not move it. Somebody who moved house had exactly one option: cancel
   * the plan and start a new one, losing its schedule.
   *
   * Moving it is a WRITE the customer makes. The plan holds its own snapshot on purpose —
   * the sweep prices against the depot that snapshot routes to (D7), so an address edit
   * that silently re-routed a standing order would also silently change what it costs.
   * P3-5: an edit to the saved address it follows does reach it, but only one the same
   * depot still serves (see followSavedAddress) — never a different depot or price.
   *
   * A cancelled plan is not moved: nothing will ever be delivered against it, and letting
   * the address change would put a dead row in the customer's list looking alive.
   */
  async changeAddress(
    customerId: string,
    id: string,
    address: DeliveryAddressSnapshot,
    /** P3-5: the saved address picked; absent = a typed one, which the plan stops following. */
    addressId?: string,
  ): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    // The same check as create: a plan moved to an address nobody serves failed every run.
    await this.assertDeliverable(address);
    const moved = await this.subs.setDeliveryAddress(id, address, addressId ?? null);
    // Cancelled (or erased) while the depot was being checked: nothing was written.
    if (!moved) throw new SubscriptionNotActionableError();
    return moved;
  }

  /**
   * The address must be one the sweep can route: a pin, and a depot that serves it — asked
   * through OrderService.resolveDepot, the very rule the sweep places the order by. A
   * directory outage refuses too (fail-closed, like checkout); the customer can try again.
   */
  private async assertDeliverable(address: DeliveryAddressSnapshot): Promise<DepotLocation> {
    if (address.latitude == null || address.longitude == null) {
      throw new SubscriptionAddressNotRoutableError();
    }
    return this.orders.resolveDepot(address);
  }

  /**
   * Fulfilment sweep (spec 7b): place an order for every ACTIVE subscription whose
   * next delivery is due, then advance its schedule. Admin/internal-triggered, mirroring
   * expireAbandoned — this repo has no cron daemon, so an ops scheduler calls this.
   * Each subscription is isolated: a placement failure logs and skips (never blocks
   * the rest), and the schedule only advances when the order was actually placed.
   */
  /**
   * UU PDP item 13: cancel and scrub this person's standing instructions.
   *
   * Called by auth-service's erasure registry. This is the fix for the console audit's
   * second Kritis as much as for the retention gap behind it: the sweep below reads ACTIVE
   * plans and places orders from their address snapshot, so a plan that outlived its
   * owner's deletion kept sending water — and `docs/AUDIT_L3.md` §4.2 counted 21 of them.
   */
  async erasePerson(customerId: string): Promise<{ erased: number }> {
    const erased = await this.subs.erasePerson(customerId);
    this.logger.log(
      `PDP erasure: cancelled and scrubbed ${erased} subscription(s) for ${customerId}`,
    );
    return { erased };
  }

  async processDue(now: Date): Promise<SubscriptionSweepResult> {
    const due = await this.subs.findDue(now);
    let placed = 0;
    let failed = 0;
    // P3-5: one depot read for the whole run, and only when some plan follows an address.
    // The directory answers null on an outage rather than throwing; null keeps every snapshot.
    const followers = due.filter((s) => s.addressId);
    const depots = followers.length ? await this.orders.activeDepots() : null;
    // The saved addresses, read side by side rather than one timeout after another; the
    // adapter answers null for anything it could not read.
    const saved = new Map(
      await Promise.all(
        (depots?.length ? followers : []).map(
          async (s) => [s.id, await this.customers.addressById(s.customerId, s.addressId!)] as const,
        ),
      ),
    );
    for (const sub of due) {
      const snapshot: DeliveryAddressSnapshot = {
        recipientName: sub.recipientName,
        phone: sub.phone,
        addressLine: sub.addressLine,
        city: sub.city,
        province: sub.province,
        postalCode: sub.postalCode,
        latitude: sub.latitude,
        longitude: sub.longitude,
        notes: sub.notes,
      };
      const address = await this.followSavedAddress(sub, snapshot, saved.get(sub.id) ?? null, depots);
      try {
        await this.orders.placeScheduled(
          sub.customerId,
          [{ productId: sub.productId, quantity: sub.quantity }],
          address,
          // H-3: one key per due delivery, so two sweeps running over the same window
          // place one order between them instead of one each. The due date is part of it
          // — the next delivery is a different order, not a replay of this one.
          `sub:${sub.id}:${sub.nextDeliveryAt.toISOString()}`,
          // D6: the same fact, recorded as data instead of only as a naming convention.
          sub.id,
        );
        // D2: the schedule steps from the date this cycle was DUE, never from `now`.
        //
        // Advancing from `now` moved the delivery day permanently every time a cycle ran
        // late: a plan due Tuesday that the sweep only reached on Friday became a Friday
        // plan, at whatever hour the sweep happened to run, and never came back.
        // `nextDeliveryOnOrAfter` also skips whole cadences that were missed, so a plan
        // rescued after a long outage owes one delivery, not the backlog.
        //
        // Counted only when this sweep is the one that moved the schedule on.
        const next = nextDeliveryOnOrAfter(sub.nextDeliveryAt, sub.frequency, now);
        if (await this.subs.advance(sub.id, sub.nextDeliveryAt, next)) {
          placed += 1;
        }
      } catch (err) {
        failed += 1;
        await this.recordCycleFailure(sub, err, now);
      }
    }
    return { placed, failed, ok: failed === 0 || placed > 0 };
  }

  /**
   * D2: a cycle that failed is counted, explained, and eventually stopped.
   *
   * Before this the sweep wrote one warning and moved on — so a plan whose product had been
   * pulled from the catalogue was retried on every tick, for as long as the plan existed,
   * and the customer was never told their standing order had stopped arriving. The only
   * trace was a line in a container log nobody reads.
   *
   * Pausing rather than cancelling: the plan is the customer's, and the cause may be
   * temporary. PAUSED is the state they can resume from once it is fixed — and D4 already
   * makes resuming move the schedule forward instead of delivering on the spot.
   *
   * Every step is fail-open. This runs inside the sweep's own catch, and a failure to
   * RECORD a failure must not take the rest of the batch down with it.
   */
  private async recordCycleFailure(
    sub: SubscriptionRecord,
    err: unknown,
    now: Date,
  ): Promise<void> {
    const reason = messageOf(err);
    this.logger.warn(`Subscription ${sub.id} delivery skipped: ${reason}`);
    let failures: number;
    try {
      failures = await this.subs.recordFailure(sub.id, reason, now);
    } catch (recordErr) {
      this.logger.warn(`Subscription ${sub.id} failure not recorded: ${messageOf(recordErr)}`);
      return;
    }
    if (failures < MAX_CONSECUTIVE_FAILURES) return;

    try {
      await this.subs.setStatus(sub.id, 'PAUSED');
    } catch (pauseErr) {
      this.logger.warn(
        `Subscription ${sub.id} not paused after ${failures} failures: ${messageOf(pauseErr)}`,
      );
      return;
    }
    // Telling the customer is the whole point — a standing order that stops arriving with
    // no message is the bug. Fail-open: the pause already happened and is the durable part.
    await this.notification
      .notify(
        'SUBSCRIPTION_PAUSED',
        sub.phone,
        { name: sub.recipientName, product: sub.productName, reason: pauseReason(err) },
        sub.customerId,
        // No caller token: this runs from the scheduler. D2 meant this row to open the screen
        // that can resume it, but passed '/subscriptions' HERE, in the token's place, where it
        // was dropped. The destination is crm's to give (flow 6a: SUBSCRIPTION_PAUSED opens
        // /subscriptions).
        '',
      )
      .catch(() => false);
  }
}

const SNAPSHOT_KEYS = [
  'recipientName',
  'phone',
  'addressLine',
  'city',
  'province',
  'postalCode',
  'latitude',
  'longitude',
  'notes',
] as const;

/** Every field the courier and the routing read; equal snapshots need no write. */
function sameSnapshot(a: DeliveryAddressSnapshot, b: DeliveryAddressSnapshot): boolean {
  return SNAPSHOT_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
