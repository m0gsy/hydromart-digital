import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { localMonthKey } from '@hydromart/platform';

import { CrmConfigService } from '../../config/crm-config.service';
import { WA_CATEGORIES, WaCategory, estimatedCostIdr } from '../../domain/wa-cost';
import { WA_NUMBER_1 } from '../../domain/wa-replies';
import { WA_TEMPLATE_SPECS, WA_UTILITY_EVENTS } from '../../domain/wa-templates';
import {
  WaCapRepository,
  WaConsentRepository,
  WaMessageRecord,
  WaMessageRepository,
  WaTemplateRecord,
  WaTemplateRepository,
} from '../ports/wa.repository';
import { CRM_TOKENS } from '../tokens';

export const WA_TEMPLATE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED'] as const;

export interface WaOverview {
  /** OFF = WA_ENABLED blank; INCOMPLETE = on but keys missing (names only); PAUSED = every cap row paused. */
  state: 'OFF' | 'INCOMPLETE' | 'PAUSED' | 'ON';
  missing: string[];
  month: string;
  categories: Array<{
    category: WaCategory;
    monthlyMessages: number | null;
    rateIdr: number | null;
    monthlyCostIdr: number | null;
    paused: boolean;
    messages: number;
    /** null = "Tarif belum diisi". */
    costIdr: number | null;
  }>;
  templates: WaTemplateRecord[];
  problems: Array<Pick<WaMessageRecord, 'id' | 'status' | 'skipReason' | 'templateName' | 'createdAt'>>;
}

/** HD-12: what HQ sees and sets on /hq/whatsapp, and the three retention purges admin-service drives. */
@Injectable()
export class WhatsappAdminService {
  constructor(
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.WaCapRepository) private readonly caps: WaCapRepository,
    @Inject(CRM_TOKENS.WaTemplateRepository) private readonly templates: WaTemplateRepository,
    @Inject(CRM_TOKENS.WaMessageRepository) private readonly messages: WaMessageRepository,
    @Inject(CRM_TOKENS.WaConsentRepository) private readonly consent: WaConsentRepository,
  ) {}

  async overview(): Promise<WaOverview> {
    const wa = this.config.whatsapp;
    const month = localMonthKey(new Date());
    // The ten templates appear as DRAFT the first time HQ looks, so there is something to mark.
    for (const event of WA_UTILITY_EVENTS) {
      const spec = WA_TEMPLATE_SPECS[event];
      await this.templates.ensure({
        name: spec.name,
        language: spec.language,
        event,
        category: spec.category,
        bodyParams: spec.params.length,
      });
    }
    const caps = await this.caps.listCaps(WA_NUMBER_1);
    const counters = await this.caps.listCounters(month);
    const categories = WA_CATEGORIES.map((category) => {
      const cap = caps.find((c) => c.category === category) ?? null;
      const used = counters.find((c) => c.waNumber === WA_NUMBER_1 && c.category === category);
      return {
        category,
        monthlyMessages: cap?.monthlyMessages ?? null,
        rateIdr: cap?.rateIdr ?? null,
        monthlyCostIdr: cap?.monthlyCostIdr ?? null,
        paused: cap?.paused ?? false,
        messages: used?.messages ?? 0,
        costIdr: cap && category !== 'SERVICE' ? estimatedCostIdr(used?.messages ?? 0, cap.rateIdr) : null,
      };
    });
    const state = !wa.enabled
      ? 'OFF'
      : !wa.ready
        ? 'INCOMPLETE'
        : caps.length > 0 && caps.every((c) => c.paused)
          ? 'PAUSED'
          : 'ON';
    const problems = (await this.messages.listProblems(50)).map((m) => ({
      id: m.id,
      status: m.status,
      skipReason: m.skipReason,
      templateName: m.templateName,
      createdAt: m.createdAt,
    }));
    return { state, missing: wa.missing, month, categories, templates: await this.templates.list(), problems };
  }

  async setCap(
    category: string,
    limits: { monthlyMessages: number; rateIdr: number | null; monthlyCostIdr: number | null },
    by: string,
  ): Promise<void> {
    if (!(WA_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException('Unknown category');
    await this.caps.upsertCap(WA_NUMBER_1, category, limits, by);
  }

  /** The kill switch: instant, no deploy. */
  setPaused(paused: boolean, by: string): Promise<number> {
    return this.caps.setPausedAll(WA_NUMBER_1, paused, by);
  }

  async setTemplateStatus(name: string, language: string, status: string, reason: string | null): Promise<boolean> {
    if (!(WA_TEMPLATE_STATUSES as readonly string[]).includes(status)) throw new BadRequestException('Unknown status');
    return this.templates.setStatus(name, language, status, reason);
  }

  async purgeMessages(cutoff: Date): Promise<{ deleted: number }> {
    return { deleted: await this.messages.purgeMessagesBefore(cutoff) };
  }

  async purgeInbound(cutoff: Date): Promise<{ deleted: number }> {
    return { deleted: await this.messages.purgeInboundBefore(cutoff) };
  }

  /** Grants older than the cutoff; a number whose newest row is a STOP is never purged (do-not-contact). */
  async purgeConsents(cutoff: Date): Promise<{ deleted: number }> {
    return { deleted: await this.consent.purgeBefore(cutoff) };
  }
}
