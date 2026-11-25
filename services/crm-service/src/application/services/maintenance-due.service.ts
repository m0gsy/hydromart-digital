import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import {
  dueKey,
  dueReason,
  MAINTENANCE_DUE_DEPOT_ROLE,
  MAINTENANCE_DUE_HQ_ROLES,
  recentlyTold,
  REMINDER_EVERY_DAYS,
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
  /** Notifications filed in this call (a retry files none twice). */
  notified: number;
  /** Items left out because they were told about less than REMINDER_EVERY_DAYS ago. */
  remindLater: number;
  whatsapp: 'pending';
}

/**
 * HD-15: n8n only says "now" (07.30 WIB). Which items are due, who is told and what it says are
 * hydromart's. Per due item, once, and then a reminder every REMINDER_EVERY_DAYS days while it
 * stays due; each recipient gets their own row (bell and push, email through the same path as
 * every staff kind). Recipients: the depot's Kepala, the supervisors over the depot (its assistant
 * supervisor and everyone above), and HQ Operasional (HEAD_OFFICE, all depots). WhatsApp is
 * reported `pending` until Meta is ready and never faked.
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
    const told = recentlyTold(
      await this.notifications
        .recentDedupeKeys(
          NotificationEvent.MAINTENANCE_DUE,
          new Date(Date.now() - (REMINDER_EVERY_DAYS + 1) * 86_400_000),
        )
        .catch(unreadable('earlier notices')),
      date,
    );
    const toTell = items.filter((i) => !told.has(`${i.id}:${i.cycleStart}`));
    const hq = toTell.length > 0 ? await this.hq().catch(unreadable('HQ recipients')) : [];
    const byDepot = new Map<string, DueMaintenance[]>();
    for (const i of toTell) byDepot.set(i.depotId, [...(byDepot.get(i.depotId) ?? []), i]);

    let notified = 0;
    let failed = 0;
    for (const [depotId, depotItems] of byDepot) {
      const recipients = await this.depotRecipients(depotId, hq).catch(unreadable('recipients'));
      for (const item of depotItems) {
        for (const id of recipients) {
          try {
            await this.notifications.notify(
              NotificationEvent.MAINTENANCE_DUE,
              '',
              { depot: item.depotName, item: item.name, reason: dueReason(item) },
              id,
              null,
              dueKey(item, date, id),
            );
            notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`maintenance due ${item.id} for ${id} failed: ${(e as Error).message}`);
          }
        }
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    }
    return {
      date,
      depots: new Set(items.map((i) => i.depotId)).size,
      items: items.length,
      notified,
      remindLater: items.length - toTell.length,
      whatsapp: 'pending',
    };
  }

  /** The depot's Kepala, the people over the depot, and HQ: one set, no one twice. */
  private async depotRecipients(depotId: string, hq: readonly string[]): Promise<string[]> {
    const [staffIds, overseers] = await Promise.all([
      this.staff.staffIdsForDepot(depotId),
      this.overseers.overseersOfDepot(depotId),
    ]);
    const roles =
      staffIds.length > 0 ? await this.directory.rolesOf(staffIds) : new Map<string, string>();
    const kepala = staffIds.filter((id) => roles.get(id) === MAINTENANCE_DUE_DEPOT_ROLE);
    return [...new Set([...kepala, ...overseers, ...hq])];
  }

  /** Active accounts holding an HQ Operasional role, re-checked against their current role. */
  private async hq(): Promise<string[]> {
    const ids = await this.directory.staffIdsByRoles(MAINTENANCE_DUE_HQ_ROLES);
    const roles = await this.directory.rolesOf(ids);
    return ids.filter((id) => MAINTENANCE_DUE_HQ_ROLES.includes(roles.get(id) ?? ''));
  }
}
