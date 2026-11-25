import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import { VisitTemplateNotFoundError } from '../../domain/errors';
import {
  VisitTemplate,
  VisitTemplateItemInput,
  VisitTemplateItemView,
} from '../../domain/visit-template';
import { SopLookupPort } from '../ports/sop-lookup.port';
import { VisitTemplateRepository } from '../ports/visit-template.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface WriteVisitTemplateInput {
  name: string;
  items: VisitTemplateItemInput[];
}

/** A template as a conductor reads it; `sopLookup` says whether the SOP column can be trusted. */
export interface VisitTemplateView extends Omit<VisitTemplate, 'items'> {
  items: VisitTemplateItemView[];
  sopLookup: 'ok' | 'unavailable' | 'skipped';
}

/**
 * HD-15B: checklist templates head office writes for supervisor visits. A visit copies the item
 * text when it starts (PR-4), so editing, replacing or retiring a template never rewrites history.
 */
@Injectable()
export class VisitTemplateService {
  constructor(
    @Inject(DEPOT_TOKENS.VisitTemplateRepository)
    private readonly templates: VisitTemplateRepository,
    @Inject(DEPOT_TOKENS.SopLookup) private readonly sops: SopLookupPort,
  ) {}

  /** Conductors see active templates only; HQ (`all`) also sees the retired ones. */
  list(all: boolean): Promise<VisitTemplate[]> {
    return this.templates.list(!all);
  }

  create(input: WriteVisitTemplateInput, createdBy: string): Promise<VisitTemplate> {
    return this.templates.create({ name: input.name, items: input.items, createdBy });
  }

  async replace(
    id: string,
    input: WriteVisitTemplateInput & { active: boolean },
    seenUpdatedAt?: string,
  ): Promise<VisitTemplate> {
    // CA-2-53: head office edits the whole checklist, so a second editor must not erase the first.
    const existing = await this.templates.findById(id);
    if (!existing) throw new VisitTemplateNotFoundError();
    assertFresh(existing.updatedAt, seenUpdatedAt);
    // The check above answers 404 / missing token; the repository repeats the match atomically
    // inside its transaction, which is what actually closes the race between two editors.
    const saved = await this.templates.replace(id, input, seenUpdatedAt as string);
    if (!saved) throw new VisitTemplateNotFoundError();
    return saved;
  }

  /**
   * One ACTIVE template for a conductor. With `depotId`, each item that names a SOP also carries
   * the version in force at that depot today. hr-service being down never hides the checklist:
   * the items come back without a SOP and `sopLookup` says "unavailable".
   */
  async getForConductor(id: string, depotId?: string): Promise<VisitTemplateView> {
    const template = await this.templates.findById(id);
    if (!template || !template.active) throw new VisitTemplateNotFoundError();

    const sopIds = [
      ...new Set(template.items.map((i) => i.sopId).filter((s): s is string => s !== null)),
    ];
    let sopLookup: VisitTemplateView['sopLookup'] = 'skipped';
    let inForce = new Map<string, NonNullable<VisitTemplateItemView['sopInForce']>>();
    if (depotId && sopIds.length > 0) {
      const found = await this.sops.inForce(depotId, sopIds);
      sopLookup = found === null ? 'unavailable' : 'ok';
      inForce = new Map((found ?? []).map((f) => [f.sopId, f]));
    }
    return {
      ...template,
      sopLookup,
      items: template.items.map((i) => ({
        ...i,
        sopInForce: (i.sopId && inForce.get(i.sopId)) || null,
      })),
    };
  }
}
