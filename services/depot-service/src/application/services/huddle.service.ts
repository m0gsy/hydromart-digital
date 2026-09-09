import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import { HuddleActionItem, HuddleAgendaItem, HuddleNote } from '../../domain/huddle';
import { DepotNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { HuddleRepository } from '../ports/huddle.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordHuddleInput {
  depotId: string;
  weekStart: string;
  attendance?: string | null;
  agenda: HuddleAgendaItem[];
  actionItems: HuddleActionItem[];
}

/**
 * Weekly depot huddle notes (design depotTeam). One note per depot per ISO week; recording
 * the same week again overwrites the agenda/action items (upsert on [depotId, weekStart]).
 */
@Injectable()
export class HuddleService {
  constructor(
    @Inject(DEPOT_TOKENS.HuddleRepository) private readonly huddles: HuddleRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  /**
   * CA-2-53: this is an upsert on [depotId, weekStart], so a second manager writing the
   * same week used to replace the first one's notes entirely. A caller editing an
   * existing note must say which version it read; a brand-new week has nothing to lose.
   */
  async record(
    input: RecordHuddleInput,
    recordedBy: string,
    seenUpdatedAt?: string,
  ): Promise<HuddleNote> {
    await this.requireDepot(input.depotId);
    const existing = await this.huddles.findForWeek(input.depotId, input.weekStart);
    assertFresh(existing?.updatedAt ?? null, seenUpdatedAt);
    return this.huddles.upsert({
      depotId: input.depotId,
      weekStart: input.weekStart,
      attendance: input.attendance ?? null,
      agenda: input.agenda,
      actionItems: input.actionItems,
      recordedBy,
    });
  }

  async list(depotId: string): Promise<HuddleNote[]> {
    await this.requireDepot(depotId);
    return this.huddles.listForDepot(depotId);
  }

  async getForWeek(depotId: string, weekStart: string): Promise<HuddleNote | null> {
    await this.requireDepot(depotId);
    return this.huddles.findForWeek(depotId, weekStart);
  }
}
