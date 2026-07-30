import { Holiday } from '../../../prisma/generated/client';

export const HOLIDAY_REPOSITORY = Symbol('HOLIDAY_REPOSITORY');

export interface HolidayRepository {
  create(data: { date: Date; name: string; depotId: string | null }): Promise<Holiday>;
  list(filter: { depotIds?: readonly string[]; from?: Date; to?: Date }): Promise<Holiday[]>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Holiday | null>;
  /** ISO YYYY-MM-DD dates in [from,to] that are national (depotId null) OR the given depot. */
  /** `null` = the caller has no depot (staff above one), so only national holidays apply. */
  listDates(depotId: string | null, from: Date, to: Date): Promise<string[]>;
}
