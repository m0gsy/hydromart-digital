import { Inject, Injectable } from '@nestjs/common';

import { localDayKey } from '@hydromart/platform';

import {
  DepotNotFoundError,
  LabTestDatesError,
  QualityHoldAlreadyActiveError,
  QualityHoldNotActiveError,
  QualityHoldRetestRequiredError,
} from '../../domain/errors';
import {
  DueCompliance,
  endsHold,
  isRealDay,
  labTestsDue,
  LabTest,
  Permit,
  permitsDue,
  QualityHold,
  qualityHoldChanged,
} from '../../domain/quality-hold';
import { DepotRepository } from '../ports/depot.repository';
import { NewLabTest, NewPermit, QualityHoldRepository } from '../ports/quality-hold.repository';
import { DEPOT_TOKENS } from '../tokens';
import { EventRelayService } from './event-relay.service';

/**
 * HD-14: a depot's quality hold, and the lab tests and permits it rests on. Starting is quick
 * (a Kepala may), ending needs a PASS lab test of this depot taken on or after the day the hold
 * began and a head-office person to press End: a retest on its own never ends a hold. Each change
 * and its `depot.quality_hold_changed` event commit together; the relay sends it after.
 */
@Injectable()
export class QualityHoldService {
  constructor(
    @Inject(DEPOT_TOKENS.QualityHoldRepository) private readonly repo: QualityHoldRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly relay: EventRelayService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) throw new DepotNotFoundError();
  }

  /** Sends the change's event now; the sweep sends what this could not. Never rejects. */
  private flush(hold: QualityHold): void {
    void this.relay.flush(qualityHoldChanged(hold.id, hold.depotId, hold.status, hold.startedAt).eventId);
  }

  async start(
    depotId: string,
    input: { reasonCode: QualityHold['reasonCode']; note?: string | null },
    actorId: string,
    now = new Date(),
  ): Promise<QualityHold> {
    await this.requireDepot(depotId);
    const hold = await this.repo.start({
      depotId,
      reasonCode: input.reasonCode,
      note: input.note?.trim() || null,
      startedBy: actorId,
      at: now,
    });
    if (!hold) throw new QualityHoldAlreadyActiveError();
    this.flush(hold);
    return hold;
  }

  async end(depotId: string, retestId: string, actorId: string, now = new Date()): Promise<QualityHold> {
    await this.requireDepot(depotId);
    const active = await this.repo.findActive(depotId);
    if (!active) throw new QualityHoldNotActiveError();
    if (!endsHold(active, await this.repo.findLabTest(retestId))) throw new QualityHoldRetestRequiredError();
    const ended = await this.repo.end({ depotId, endedBy: actorId, endRetestId: retestId, at: now });
    if (!ended) throw new QualityHoldNotActiveError();
    this.flush(ended);
    return ended;
  }

  async history(depotId: string): Promise<QualityHold[]> {
    await this.requireDepot(depotId);
    return this.repo.history(depotId);
  }

  async addLabTest(input: Omit<NewLabTest, 'recordedBy'>, actorId: string): Promise<LabTest> {
    await this.requireDepot(input.depotId);
    if (!isRealDay(input.takenOn) || !isRealDay(input.resultOn) || input.resultOn < input.takenOn) {
      throw new LabTestDatesError();
    }
    return this.repo.addLabTest({ ...input, recordedBy: actorId });
  }

  async listLabTests(depotId: string): Promise<LabTest[]> {
    await this.requireDepot(depotId);
    return this.repo.listLabTests(depotId);
  }

  async addPermit(input: Omit<NewPermit, 'recordedBy'>, actorId: string): Promise<Permit> {
    await this.requireDepot(input.depotId);
    if (!isRealDay(input.validUntil)) throw new LabTestDatesError();
    return this.repo.addPermit({ ...input, recordedBy: actorId });
  }

  async listPermits(depotId: string): Promise<Permit[]> {
    await this.requireDepot(depotId);
    return this.repo.listPermits(depotId);
  }

  /** Permits and lab tests due or overdue at every active depot (the n8n sweep reads this via crm-service). */
  async due(now = new Date()): Promise<DueCompliance[]> {
    const today = localDayKey(now);
    const { depots, tests, permits } = await this.repo.complianceSource();
    return depots.flatMap((d) => [
      ...labTestsDue({ id: d.id, name: d.name, createdOn: localDayKey(d.createdAt) }, tests.filter((t) => t.depotId === d.id), today),
      ...permitsDue(d, permits.filter((p) => p.depotId === d.id), today),
    ]);
  }
}
