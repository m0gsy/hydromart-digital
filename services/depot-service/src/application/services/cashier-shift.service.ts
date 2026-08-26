import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { CashierShift, expectedCash, variance } from '../../domain/cashier-shift';
import { CashDirection } from '../../domain/cashbook';
import {
  DepotNotFoundError,
  ShiftAlreadyClosedError,
  ShiftAlreadyOpenError,
  ShiftNotFoundError,
  ShiftNotYoursError,
} from '../../domain/errors';
import { CashierShiftRepository } from '../ports/cashier-shift.repository';
import { CashbookRepository } from '../ports/cashbook.repository';
import { DepotCashPort } from '../ports/depot-cash.port';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface OpenShiftInput {
  depotId: string;
  openingFloat: number;
}

export interface CloseShiftInput {
  countedCash: number;
  note?: string | null;
}

/**
 * Cashier shifts: the counter's chain of custody over cash. A sale is refused while nobody
 * has a shift open, so every rupiah in the drawer belongs to a named person from the float
 * they started with to the amount they counted at the end.
 */
@Injectable()
export class CashierShiftService {
  constructor(
    @Inject(DEPOT_TOKENS.CashierShiftRepository) private readonly shifts: CashierShiftRepository,
    @Inject(DEPOT_TOKENS.CashbookRepository) private readonly cashbook: CashbookRepository,
    @Inject(DEPOT_TOKENS.DepotCash) private readonly depotCash: DepotCashPort,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async open(
    input: OpenShiftInput,
    cashier: { id: string; name: string },
  ): Promise<CashierShift> {
    if (!(await this.depots.findById(input.depotId, false))) {
      throw new DepotNotFoundError();
    }
    if (await this.shifts.findOpen(input.depotId, cashier.id)) {
      throw new ShiftAlreadyOpenError();
    }
    return this.shifts.open({
      depotId: input.depotId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      openingFloat: input.openingFloat,
    });
  }

  /** The caller's own open shift at this depot, or null when they are not on the counter. */
  async current(depotId: string, cashierId: string): Promise<CashierShift | null> {
    return this.shifts.findOpen(depotId, cashierId);
  }

  /** Who is on the counter now, plus the last closed shifts for the day's reconciliation. */
  async list(depotId: string, closedLimit = 20): Promise<{ open: CashierShift[]; closed: CashierShift[] }> {
    const [open, closed] = await Promise.all([
      this.shifts.listOpen(depotId),
      this.shifts.listClosed(depotId, closedLimit),
    ]);
    return { open, closed };
  }

  /**
   * Counts the drawer and closes the shift.
   *
   * `expectedCash` is read from payment-service, never from the client: the cashier is the
   * one being measured, so they cannot also be the source of the number they are measured
   * against. That read fails CLOSED — if the takings cannot be established, the shift stays
   * open rather than recording a variance nobody can stand behind.
   *
   * The net cash is posted to the depot cashbook so the day's book shows the counter's
   * takings without anyone re-keying them.
   */
  async close(
    shiftId: string,
    input: CloseShiftInput,
    cashier: { id: string; canCloseAnyShift: boolean },
    user?: AuthenticatedUser,
  ): Promise<CashierShift> {
    const shift = await this.shifts.findById(shiftId);
    if (!shift) throw new ShiftNotFoundError();
    // AUTHZ-A4: whose shift it is was checked, which DEPOT it belongs to was not. The
    // manager who may close a drawer somebody walked away from holds that power for their
    // own depots — otherwise the takings of any depot's counter could be settled, and
    // posted to that depot's cashbook, from anywhere.
    assertDepotAccess(user, shift.depotId);
    if (shift.closedAt) throw new ShiftAlreadyClosedError();
    // A manager may close a shift somebody walked away from; a cashier may only close
    // their own, or they could quietly settle a drawer that is not theirs.
    if (shift.cashierId !== cashier.id && !cashier.canCloseAnyShift) {
      throw new ShiftNotYoursError();
    }

    const closedAt = new Date();
    // C2: ask for THIS shift's drawer. The old call named only the depot and the window,
    // so two cashiers open at once each closed against the other's takings as well as
    // their own — one short by exactly what the other took, and the counter cash posted
    // to the book twice.
    const taken = await this.depotCash.totalPaidCash(shift.depotId, shift.openedAt, closedAt, shift.id);
    const expected = expectedCash(shift.openingFloat, taken);
    const closed = await this.shifts.close(shiftId, {
      closedAt,
      countedCash: input.countedCash,
      expectedCash: expected,
      variance: variance(input.countedCash, expected),
      note: input.note?.trim() || null,
    });

    // Only the takings go to the book. The float was never revenue — it was already in the
    // drawer when the shift started, and posting it would inflate the day by that much.
    if (taken > 0) {
      await this.cashbook.create({
        depotId: shift.depotId,
        direction: CashDirection.IN,
        category: 'KONTER',
        label: `Tunai konter — shift ${shift.cashierName}`,
        amountIdr: taken,
        occurredAt: closedAt,
        sourceRef: `shift:${shift.id}`,
        actorId: cashier.id,
      });
    }
    return closed;
  }
}
