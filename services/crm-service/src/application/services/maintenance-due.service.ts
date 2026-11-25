import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import {
  depotDigest,
  depotKey,
  hqDigest,
  hqKey,
  hqTracked,
  ITEMS_PER_DIGEST,
  MAINTENANCE_DUE_DEPOT_ROLE,
  MAINTENANCE_DUE_HQ_ROLES,
  REMINDER_EVERY_DAYS,
  tagOf,
  toldBy,
} from '../../domain/maintenance-due';
import { NotificationEvent } from '../../domain/notification-event';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { DepotOverseersPort } from '../ports/depot-overseers.port';
import { DepotStaffPort } from '../ports/depot-staff.port';
import { DueMaintenance, MaintenanceDuePort } from '../ports/maintenance-due.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface MaintenanceDueResult {
  date: string;
  /** Depots with at least one item due. */
  depots: number;
  /** Items due or overdue. */
  items: number;
  /** Notifications filed in this call (what a retry already filed is not filed or counted again). */
  notified: number;
  /** Items no one needed telling about this run: everyone was told less than REMINDER_EVERY_DAYS ago. */
  remindLater: number;
  whatsapp: 'pending';
}

/** Notifications written at the same time: a handful, not one per recipient at once. */
const CONCURRENCY = 5;

interface Job {
  recipient: string;
  key: string;
  vars: { depot: string; items: string; depotId?: string };
}

/**
 * HD-15: n8n only says "now" (07.30 WIB). Which items are due, who is told and what it says are
 * hydromart's. Told per (item, recipient): the first day an item is found due for that person,
 * then again every REMINDER_EVERY_DAYS days while it stays due. Recipients get a DIGEST, not a
 * row per item: the depot's Kepala and the supervisors over it one row per depot listing its due
 * items; HQ Operasional (HEAD_OFFICE) one row per run with the due count per depot. Bell and push,
 * email through the same path as every staff kind; WhatsApp is reported `pending`, never faked.
 * The dedupe keys carry the memory of who was told what, so a person who was not reached (or a
 * newly appointed Kepala) is told on the next run, not three days later.
 */
@Injectable()
export class MaintenanceDueService {
  private readonly logger = new Logger(MaintenanceDueService.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.MaintenanceDue) private readonly due: MaintenanceDuePort,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.DepotStaff) private readonly staff: DepotStaffPort,
    @Inject(CRM_TOKENS.DepotOverseers) private readonly overseers: DepotOverseersPort,
  ) {}

  /**
   * THROWS 503 when the due items, the recipients or the earlier notices cannot be read, or a
   * recipient could not be filed; rows already filed stay, and the same retry finishes the rest.
   */
  async run(date: string): Promise<MaintenanceDueResult> {
    const unreadable = (what: string) => (e: Error) => {
      this.logger.warn(`maintenance due: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(`The ${what} could not be read; retry`);
    };
    const items = await this.due.dueItems().catch(unreadable('due items'));
    const told = toldBy(
      await this.notifications
        .recentDedupeKeys(
          NotificationEvent.MAINTENANCE_DUE,
          new Date(Date.now() - (REMINDER_EVERY_DAYS + 1) * 86_400_000),
        )
        .catch(unreadable('earlier notices')),
      date,
    );

    const jobs: Job[] = [];
    const reached = new Set<string>();
    let hq: string[] = [];
    if (items.length > 0) {
      hq = await this.hq().catch(unreadable('HQ recipients'));
      // HQ is told when an item it has not heard of (in the window) is due: one row per run.
      const tracked = hqTracked(items);
      for (const recipient of hq) {
        const known = told.get(`hq|${recipient}`);
        const fresh = tracked.filter((i) => !known?.has(tagOf(i)));
        if (fresh.length === 0) continue;
        jobs.push({ recipient, key: hqKey(date, recipient, items), vars: hqDigest(items) });
        fresh.forEach((i) => reached.add(i.id));
      }
    }
    const byDepot = new Map<string, DueMaintenance[]>();
    for (const i of items) byDepot.set(i.depotId, [...(byDepot.get(i.depotId) ?? []), i]);
    for (const [depotId, depotItems] of byDepot) {
      const recipients = await this.depotRecipients(depotId).catch(unreadable('recipients'));
      // An HQ account that also oversees the depot has its HQ digest already: no second row.
      for (const recipient of recipients.filter((id) => !hq.includes(id))) {
        const known = told.get(`${depotId}|${recipient}`);
        const pending = depotItems.filter((i) => !known?.has(tagOf(i)));
        for (let at = 0; at < pending.length; at += ITEMS_PER_DIGEST) {
          const group = pending.slice(at, at + ITEMS_PER_DIGEST);
          jobs.push({ recipient, key: depotKey(depotId, date, recipient, group), vars: depotDigest(group) });
          group.forEach((i) => reached.add(i.id));
        }
      }
    }

    let notified = 0;
    let failed = 0;
    for (let at = 0; at < jobs.length; at += CONCURRENCY) {
      await Promise.all(
        jobs.slice(at, at + CONCURRENCY).map(async (job) => {
          try {
            await this.notifications.notify(
              NotificationEvent.MAINTENANCE_DUE,
              '',
              job.vars,
              job.recipient,
              null,
              job.key,
            );
            notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`maintenance due for ${job.recipient} failed: ${(e as Error).message}`);
          }
        }),
      );
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    }
    return {
      date,
      depots: byDepot.size,
      items: items.length,
      notified,
      remindLater: items.filter((i) => !reached.has(i.id)).length,
      whatsapp: 'pending',
    };
  }

  /** The depot's Kepala and the people over the depot: one set, no one twice. HQ has its own digest. */
  private async depotRecipients(depotId: string): Promise<string[]> {
    const [staffIds, overseers] = await Promise.all([
      this.staff.staffIdsForDepot(depotId),
      this.overseers.overseersOfDepot(depotId),
    ]);
    const roles =
      staffIds.length > 0 ? await this.directory.rolesOf(staffIds) : new Map<string, string>();
    const kepala = staffIds.filter((id) => roles.get(id) === MAINTENANCE_DUE_DEPOT_ROLE);
    return [...new Set([...kepala, ...overseers])];
  }

  /** Active accounts holding an HQ Operasional role, re-checked against their current role. */
  private async hq(): Promise<string[]> {
    const ids = await this.directory.staffIdsByRoles(MAINTENANCE_DUE_HQ_ROLES);
    const roles = await this.directory.rolesOf(ids);
    return ids.filter((id) => MAINTENANCE_DUE_HQ_ROLES.includes(roles.get(id) ?? ''));
  }
}
