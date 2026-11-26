import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { COMPLIANCE_KINDS, complianceDigest } from '../../domain/compliance-due';
import {
  depotKey,
  hqDigest,
  hqKey,
  hqTracked,
  ITEMS_PER_DIGEST,
  REMINDER_EVERY_DAYS,
  tagOf,
  toldBy,
} from '../../domain/maintenance-due';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { ComplianceDuePort, DueCompliance } from '../ports/compliance-due.port';
import { DepotOverseersPort } from '../ports/depot-overseers.port';
import { DepotStaffPort } from '../ports/depot-staff.port';
import { CRM_TOKENS } from '../tokens';
import { DepotAudienceService } from './depot-audience.service';
import { NotificationService } from './notification.service';

export interface ComplianceDueResult {
  date: string;
  /** Depots with at least one permit or lab test due. */
  depots: number;
  /** Items due or overdue (both kinds). */
  items: number;
  /** Notifications filed in this call (what a retry already filed is not filed or counted again). */
  notified: number;
  /** Items no one needed telling about this run: everyone was told less than REMINDER_EVERY_DAYS ago. */
  remindLater: number;
  whatsapp: 'pending';
}

const CONCURRENCY = 5;

interface Job {
  event: (typeof COMPLIANCE_KINDS)[number]['event'];
  recipient: string;
  key: string;
  vars: { depot: string; items: string; depotId?: string };
}

/**
 * HD-14: the permit and lab-test twin of MaintenanceDueService, same rules: n8n only says "now";
 * depot-service says what is due; each (item, recipient) is told on first sight and then every
 * REMINDER_EVERY_DAYS days while it stays due; depot Kepala + supervisors get one digest per depot,
 * HQ Operasional one count per run. Permits and lab tests are separate notification kinds with their
 * own dedupe-key families. These reminders are NEVER held back by a quality hold: they are how one ends.
 */
@Injectable()
export class ComplianceDueService {
  private readonly logger = new Logger(ComplianceDueService.name);
  private readonly audience: DepotAudienceService;

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.ComplianceDue) private readonly due: ComplianceDuePort,
    @Inject(CRM_TOKENS.ApproverDirectory) directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.DepotStaff) staff: DepotStaffPort,
    @Inject(CRM_TOKENS.DepotOverseers) overseers: DepotOverseersPort,
  ) {
    this.audience = new DepotAudienceService(directory, staff, overseers);
  }

  /** THROWS 503 when the due items, recipients or earlier notices cannot be read, or a recipient could not be filed. */
  async run(date: string): Promise<ComplianceDueResult> {
    const unreadable = (what: string) => (e: Error) => {
      this.logger.warn(`compliance due: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(`The ${what} could not be read; retry`);
    };
    const all = await this.due.dueItems().catch(unreadable('due items'));
    const since = new Date(Date.now() - (REMINDER_EVERY_DAYS + 1) * 86_400_000);
    const jobs: Job[] = [];
    const reached = new Set<string>();
    const hq = all.length > 0 ? await this.audience.hq().catch(unreadable('HQ recipients')) : [];
    const depotIds = new Set(all.map((i) => i.depotId));

    for (const { kind, event, prefix } of COMPLIANCE_KINDS) {
      const items = all.filter((i) => i.kind === kind);
      if (items.length === 0) continue;
      const told = toldBy(
        await this.notifications.recentDedupeKeys(event, since).catch(unreadable('earlier notices')),
        date,
        prefix,
      );
      const tracked = hqTracked(items);
      for (const recipient of hq) {
        const known = told.get(`hq|${recipient}`);
        const fresh = tracked.filter((i) => !known?.has(tagOf(i)));
        if (fresh.length === 0) continue;
        jobs.push({ event, recipient, key: hqKey(date, recipient, items, prefix), vars: hqDigest(items) });
        fresh.forEach((i) => reached.add(i.id));
      }
      const byDepot = new Map<string, DueCompliance[]>();
      for (const i of items) byDepot.set(i.depotId, [...(byDepot.get(i.depotId) ?? []), i]);
      for (const [depotId, depotItems] of byDepot) {
        const recipients = await this.audience.depotRecipients(depotId).catch(unreadable('recipients'));
        for (const recipient of recipients.filter((id) => !hq.includes(id))) {
          const known = told.get(`${depotId}|${recipient}`);
          const pending = depotItems.filter((i) => !known?.has(tagOf(i)));
          for (let at = 0; at < pending.length; at += ITEMS_PER_DIGEST) {
            const group = pending.slice(at, at + ITEMS_PER_DIGEST);
            jobs.push({ event, recipient, key: depotKey(depotId, date, recipient, group, prefix), vars: complianceDigest(group) });
            group.forEach((i) => reached.add(i.id));
          }
        }
      }
    }

    let notified = 0;
    let failed = 0;
    for (let at = 0; at < jobs.length; at += CONCURRENCY) {
      await Promise.all(
        jobs.slice(at, at + CONCURRENCY).map(async (job) => {
          try {
            await this.notifications.notify(job.event, '', job.vars, job.recipient, null, job.key);
            notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`compliance due for ${job.recipient} failed: ${(e as Error).message}`);
          }
        }),
      );
    }
    if (failed > 0) throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    return {
      date,
      depots: depotIds.size,
      items: all.length,
      notified,
      remindLater: all.filter((i) => !reached.has(i.id)).length,
      whatsapp: 'pending',
    };
  }
}
