import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, addLocalDays, assertDepotAccess, dayStartUtc } from '@hydromart/platform';

import { DepotConfigService } from '../../config/depot-config.service';

import { CashDirection } from '../../domain/cashbook';
import { DepotNotFoundError } from '../../domain/errors';
import { CashbookRepository } from '../ports/cashbook.repository';
import { CashierShiftRepository } from '../ports/cashier-shift.repository';
import { COURIER_COD_PORT, CourierCodPort } from '../ports/courier-cod.port';
import { DAILY_CLOSE_REPOSITORY, DailyCloseRecord, DailyCloseRepository } from '../ports/daily-close.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

/** A closed day, plus what has happened to it since. */
export interface DailyCloseView {
  close: DailyCloseRecord | null;
  /**
   * Cashbook entries recorded AFTER the close but dated inside the closed day — a courier
   * settling late, a correction typed the next morning. Reported rather than refused: the
   * money exists whether or not the book was shut, and a rejected entry would mean cash in
   * a drawer with no record at all.
   */
  lateEntries: number;
  lateAmountIdr: number;
}

/**
 * "Tutup buku": one depot declaring one day counted.
 *
 * The two halves of a depot's cash never met before this. Counter takings post themselves
 * into the cashbook when a cashier shift closes; courier COD lands in delivery-service as
 * each deposit is accepted. This is the place that adds them up, records who signed off,
 * and freezes the numbers as they stood.
 *
 * Snapshotted, not recomputed: the point of closing is to keep what was agreed, so a
 * later correction shows up as a difference instead of quietly rewriting history.
 */
@Injectable()
export class DailyCloseService {
  constructor(
    @Inject(DAILY_CLOSE_REPOSITORY) private readonly closes: DailyCloseRepository,
    @Inject(DEPOT_TOKENS.CashbookRepository) private readonly cashbook: CashbookRepository,
    @Inject(DEPOT_TOKENS.CashierShiftRepository) private readonly shifts: CashierShiftRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    @Inject(COURIER_COD_PORT) private readonly cod: CourierCodPort,
    private readonly config: DepotConfigService,
  ) {}

  /**
   * The day's window, in the business timezone (H-16).
   *
   * `${date}T00:00:00.000Z` is 07:00 WIB, so a UTC window put the first seven hours of a
   * depot's morning into the previous day's books and pulled the next morning's in. Here
   * that is worse than on a report: these totals are SNAPSHOTTED into `depot_daily_closes`
   * and never recomputed, so a wrong window freezes a wrong money total for good.
   */
  private window(businessDate: string): { from: Date; to: Date } {
    if (Number.isNaN(new Date(`${businessDate}T00:00:00.000Z`).getTime())) {
      throw new BadRequestException('Tanggal tidak valid (pakai YYYY-MM-DD).');
    }
    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(businessDate, tz);
    return { from, to: addLocalDays(from, 1, tz) };
  }

  async get(user: AuthenticatedUser, depotId: string, businessDate: string): Promise<DailyCloseView> {
    assertDepotAccess(user, depotId);
    const close = await this.closes.find(depotId, businessDate);
    if (!close) {
      return { close: null, lateEntries: 0, lateAmountIdr: 0 };
    }
    const { from, to } = this.window(businessDate);
    const entries = await this.cashbook.listForDepot(depotId, { from, to });
    const late = entries.filter((e) => e.createdAt.getTime() > close.closedAt.getTime());
    return {
      close,
      lateEntries: late.length,
      lateAmountIdr: late.reduce(
        (sum, e) => sum + (e.direction === CashDirection.IN ? e.amountIdr : -e.amountIdr),
        0,
      ),
    };
  }

  /**
   * Close the day.
   *
   * Refused while a cashier shift is still open: the counter is still taking money into a
   * day somebody is declaring finished, and whatever it takes after this would land outside
   * the total that was signed off.
   */
  async close(
    user: AuthenticatedUser,
    depotId: string,
    businessDate: string,
    note: string | null,
  ): Promise<DailyCloseRecord> {
    assertDepotAccess(user, depotId);
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const existing = await this.closes.find(depotId, businessDate);
    if (existing && !existing.reopenedAt) {
      throw new BadRequestException('Hari ini sudah ditutup.');
    }
    const open = await this.shifts.listOpen(depotId);
    if (open.length > 0) {
      throw new BadRequestException(
        `Masih ada ${open.length} shift kasir terbuka. Tutup shift dulu, baru buku harian.`,
      );
    }

    const { from, to } = this.window(businessDate);
    // Fails closed (see CourierCodPort): better no close than a total missing half its money.
    const cod = await this.cod.depositedInWindow(depotId, from, to);
    const entries = await this.cashbook.listForDepot(depotId, { from, to });
    const sum = (predicate: (e: (typeof entries)[number]) => boolean) =>
      entries.filter(predicate).reduce((total, e) => total + e.amountIdr, 0);

    return this.closes.close({
      depotId,
      businessDate,
      closedBy: user.sub,
      cashInIdr: sum((e) => e.direction === CashDirection.IN),
      cashOutIdr: sum((e) => e.direction === CashDirection.OUT),
      konterIdr: sum((e) => e.direction === CashDirection.IN && e.category === 'KONTER'),
      codDepositedIdr: cod.depositedIdr,
      codExpectedIdr: cod.expectedIdr,
      note: note?.trim() || null,
    });
  }

  /**
   * Reopen a closed day. HQ only (the route carries `dailyCloseReopen`), because a depot
   * that can reopen its own books can rewrite a total it already signed off.
   *
   * The row stays and is marked rather than deleted: who reopened it and when is exactly
   * the question anybody asks afterwards.
   */
  async reopen(depotId: string, businessDate: string, actorId: string): Promise<DailyCloseRecord> {
    const existing = await this.closes.find(depotId, businessDate);
    if (!existing) {
      throw new BadRequestException('Hari ini belum pernah ditutup.');
    }
    if (existing.reopenedAt) {
      return existing;
    }
    return this.closes.reopen(depotId, businessDate, actorId);
  }
}
