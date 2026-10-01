import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import {
  AuthenticatedUser,
  addLocalDays,
  assertDepotAccess,
  dayStartUtc,
  localDayKey,
  startOfLocalDay,
} from '@hydromart/platform';

import { DepotConfigService } from '../../config/depot-config.service';

import { DepotNotFoundError } from '../../domain/errors';
import { DAILY_CLOSE_REPOSITORY, DailyCloseRepository } from '../ports/daily-close.repository';
import {
  MONTHLY_CLOSE_REPOSITORY,
  MonthlyCloseRecord,
  MonthlyCloseRepository,
} from '../ports/monthly-close.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

/** How many missing dates to name before the message just counts the rest. */
const MISSING_DAYS_SHOWN = 5;

export interface MonthlyCloseView {
  close: MonthlyCloseRecord | null;
  /**
   * Business days in the month (up to today, for the month in progress) that are not yet
   * individually closed — what stands between this month and sealing it. Empty once the
   * month is sealed, by construction: closing refuses while this list is non-empty.
   */
  missingDays: string[];
}

/**
 * "Tutup bulan": a depot sealing a month once every one of its days is already closed.
 *
 * Deliberately does not recompute anything from order-service or delivery-service — it
 * only sums what depot-service's own daily closes already agreed on. A month is sealable
 * exactly when its days are, which keeps the precondition legible: close every day, then
 * close the month, the same action twice at two sizes.
 */
@Injectable()
export class MonthlyCloseService {
  constructor(
    @Inject(MONTHLY_CLOSE_REPOSITORY) private readonly closes: MonthlyCloseRepository,
    @Inject(DAILY_CLOSE_REPOSITORY) private readonly dailyCloses: DailyCloseRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  /**
   * Business days this month, from the 1st up to and including today — or the whole month,
   * once it has ended. A month entirely in the future has none, which `close()` treats as
   * "nothing to seal yet" rather than an empty success.
   */
  private expectedDays(businessMonth: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(businessMonth)) {
      throw new BadRequestException('Bulan tidak valid (pakai YYYY-MM).');
    }
    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(`${businessMonth}-01`, tz);
    const [y, m] = businessMonth.split('-').map(Number);
    const monthEnd = dayStartUtc(
      `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`,
      tz,
    );
    const tomorrow = addLocalDays(startOfLocalDay(new Date(), tz), 1, tz);
    const to = monthEnd.getTime() < tomorrow.getTime() ? monthEnd : tomorrow;

    const days: string[] = [];
    for (let cursor = from; cursor.getTime() < to.getTime(); cursor = addLocalDays(cursor, 1, tz)) {
      days.push(localDayKey(cursor, tz));
    }
    return days;
  }

  private async missingDays(depotId: string, businessMonth: string): Promise<string[]> {
    const expected = this.expectedDays(businessMonth);
    if (expected.length === 0) return [];
    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(`${businessMonth}-01`, tz);
    const to = addLocalDays(from, expected.length, tz);
    const rows = await this.dailyCloses.listForDepotRange(depotId, from, to);
    const closed = new Set(rows.filter((r) => !r.reopenedAt).map((r) => r.businessDate));
    return expected.filter((d) => !closed.has(d));
  }

  async get(
    user: AuthenticatedUser,
    depotId: string,
    businessMonth: string,
  ): Promise<MonthlyCloseView> {
    assertDepotAccess(user, depotId);
    const [close, missingDays] = await Promise.all([
      this.closes.find(depotId, businessMonth),
      this.missingDays(depotId, businessMonth),
    ]);
    return { close, missingDays };
  }

  /**
   * Seal the month. Refused while any of its days (up to today) is not closed — the same
   * refusal shape as daily close refusing an open cashier shift: rather than name a
   * precondition this cannot verify itself, it is built to be impossible to reach.
   */
  async close(
    user: AuthenticatedUser,
    depotId: string,
    businessMonth: string,
    note: string | null,
  ): Promise<MonthlyCloseRecord> {
    assertDepotAccess(user, depotId);
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const existing = await this.closes.find(depotId, businessMonth);
    if (existing && !existing.reopenedAt) {
      throw new BadRequestException('Bulan ini sudah ditutup.');
    }

    const expected = this.expectedDays(businessMonth);
    if (expected.length === 0) {
      throw new BadRequestException('Belum ada hari pada bulan ini yang bisa ditutup.');
    }
    const missing = await this.missingDays(depotId, businessMonth);
    if (missing.length > 0) {
      const shown = missing.slice(0, MISSING_DAYS_SHOWN).join(', ');
      const rest =
        missing.length > MISSING_DAYS_SHOWN
          ? ` dan ${missing.length - MISSING_DAYS_SHOWN} lainnya`
          : '';
      throw new BadRequestException(
        `${missing.length} hari belum ditutup: ${shown}${rest}. Tutup buku harian dulu untuk setiap hari.`,
      );
    }

    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(`${businessMonth}-01`, tz);
    const to = addLocalDays(from, expected.length, tz);
    const rows = await this.dailyCloses.listForDepotRange(depotId, from, to);
    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((s, r) => s + pick(r), 0);

    return this.closes.close({
      depotId,
      businessMonth,
      closedBy: user.sub,
      cashInIdr: sum((r) => r.cashInIdr),
      cashOutIdr: sum((r) => r.cashOutIdr),
      konterIdr: sum((r) => r.konterIdr),
      codDepositedIdr: sum((r) => r.codDepositedIdr),
      codExpectedIdr: sum((r) => r.codExpectedIdr),
      daysClosed: rows.length,
      note: note?.trim() || null,
    });
  }

  /**
   * Reopen a sealed month. HQ only (the route carries `dailyCloseReopen`, the same
   * capability daily reopen uses) — a depot that could reopen its own month could rewrite a
   * total it already signed off, exactly like the daily case this mirrors.
   */
  async reopen(
    depotId: string,
    businessMonth: string,
    actorId: string,
  ): Promise<MonthlyCloseRecord> {
    const existing = await this.closes.find(depotId, businessMonth);
    if (!existing) {
      throw new BadRequestException('Bulan ini belum pernah ditutup.');
    }
    if (existing.reopenedAt) {
      return existing;
    }
    return this.closes.reopen(depotId, businessMonth, actorId);
  }
}
