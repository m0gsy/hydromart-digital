import { Inject, Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { CustomerContactPort } from '../ports/customer-contact.port';
import { CustomerNotificationPort } from '../ports/customer-notification.port';
import { DepotRecord, DepotRepository } from '../ports/depot.repository';
import { GallonReminderRepository } from '../ports/gallon-reminder.repository';
import { DEPOT_TOKENS } from '../tokens';
import { GallonNetworkService } from './gallon-network.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One reminder round. The counters follow the other sweeps: `ok` is false only when the round
 * failed at something and accomplished nothing, so the scheduler's heartbeat can tell a dead
 * flow from a quiet one.
 */
export interface GallonReminderSweepResult {
  /** Overdue customers this round actually tried to reach. */
  attempted: number;
  /** Reminders crm accepted. */
  sent: number;
  /** Overdue customers left alone: reminded recently, or no number on file. */
  skipped: number;
  /** Customers (or whole depots) that could not be processed. */
  failed: number;
  /** True when the per-round cap stopped the walk early; the rest are picked up tomorrow. */
  capped: boolean;
  ok: boolean;
}

/**
 * Asks customers who are holding a depot's gallons past its limit to bring them back.
 *
 * Runs from the scheduler once a morning. A customer is asked at most once per
 * `gallonReminderEveryDays` (a per-depot setting), and "asked" is recorded only when crm
 * accepted the message — see `CustomerNotificationPort`. This is a service message about
 * something the customer holds on deposit, so it is NOT gated by the marketing opt-out.
 *
 * Not transactional and not locked beyond the scheduler's own per-job lock: a double run
 * finds every customer already reminded and sends nothing, which is the property that matters.
 */
@Injectable()
export class GallonReminderService {
  private static readonly DEPOT_PAGE = 100;
  /** Most customers one round will try to reach — a backlog is worked down over days, not in one burst. */
  private static readonly MAX_PER_ROUND = 500;
  private readonly logger = new Logger(GallonReminderService.name);

  constructor(
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly network: GallonNetworkService,
    @Inject(DEPOT_TOKENS.GallonReminderRepository)
    private readonly reminders: GallonReminderRepository,
    @Inject(DEPOT_TOKENS.CustomerContact) private readonly contacts: CustomerContactPort,
    @Inject(DEPOT_TOKENS.CustomerNotification)
    private readonly notifications: CustomerNotificationPort,
    private readonly config: DepotConfigService,
  ) {}

  async sweep(now = new Date()): Promise<GallonReminderSweepResult> {
    const result: GallonReminderSweepResult = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      capped: false,
      ok: true,
    };

    for (const depot of await this.activeDepots()) {
      if (result.attempted >= GallonReminderService.MAX_PER_ROUND) {
        result.capped = true;
        break;
      }
      try {
        await this.remindDepot(depot, now, result);
      } catch (error) {
        // One depot's failure is its own; the round continues.
        this.logger.warn(`Gallon reminders for depot ${depot.id} failed: ${(error as Error).message}`);
        result.failed += 1;
      }
    }

    result.ok = result.failed === 0 || result.sent > 0;
    return result;
  }

  private async remindDepot(
    depot: DepotRecord,
    now: Date,
    result: GallonReminderSweepResult,
  ): Promise<void> {
    const overdue = (await this.network.perCustomer(depot.id)).filter((r) => r.overdueGallons > 0);
    if (overdue.length === 0) return;

    const lastAsked = await this.reminders.lastRemindedAt(
      depot.id,
      overdue.map((r) => r.customerId),
    );
    const every = this.config.gallonReminderEveryDays(depot.id) * DAY_MS;

    for (const row of overdue) {
      if (result.attempted >= GallonReminderService.MAX_PER_ROUND) {
        result.capped = true;
        return;
      }
      const asked = lastAsked.get(row.customerId);
      if (asked && now.getTime() - asked.getTime() < every) {
        result.skipped += 1;
        continue;
      }
      result.attempted += 1;
      try {
        const contact = await this.contacts.resolve(row.customerId);
        if (!contact) {
          result.skipped += 1;
          continue;
        }
        const sent = await this.notifications.send(
          'GALLON_RETURN_REMINDER',
          contact.phone,
          row.customerId,
          {
            name: contact.name,
            depot: depot.name,
            gallons: String(row.overdueGallons),
            since: this.day(row.oldestIssuedAt),
          },
        );
        if (!sent) {
          result.failed += 1;
          continue;
        }
        await this.reminders.markReminded(depot.id, row.customerId, now);
        result.sent += 1;
      } catch (error) {
        this.logger.warn(`Gallon reminder for ${row.customerId} failed: ${(error as Error).message}`);
        result.failed += 1;
      }
    }
  }

  /** Every active depot, paged — a network of depots is not one query's worth of rows forever. */
  private async activeDepots(): Promise<DepotRecord[]> {
    const all: DepotRecord[] = [];
    for (let page = 1; ; page += 1) {
      const { items } = await this.depots.search({
        page,
        limit: GallonReminderService.DEPOT_PAGE,
        activeOnly: true,
      });
      all.push(...items);
      if (items.length < GallonReminderService.DEPOT_PAGE) return all;
    }
  }

  /** "12 Agu 2026" in the business zone — the day the depot recorded, not the day on a device. */
  private day(iso: string | null): string {
    if (!iso) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: this.config.businessTimeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  }
}
