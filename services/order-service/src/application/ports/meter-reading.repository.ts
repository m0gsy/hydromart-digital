import { MeterReading } from '../../domain/meter-reading';

/** Partial write: the morning call carries the opening, the evening one the closing. */
export interface UpsertMeterReadingData {
  depotId: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  actorId: string;
  openingM3?: number;
  closingM3?: number;
  sourceOpeningM3?: number;
  sourceClosingM3?: number;
  note?: string;
}

export interface MeterReadingRepository {
  /**
   * Creates the day's row or patches it. `openedBy`/`closedBy` are stamped the first
   * time their side is written, so a later correction does not rewrite who read the
   * dial. Returns null when a closing-only write arrives with no row to patch —
   * the service turns that into a domain error rather than inventing an opening.
   */
  upsertForDate(data: UpsertMeterReadingData): Promise<MeterReading | null>;
  findForDate(depotId: string, date: string): Promise<MeterReading | null>;
  listForRange(depotId: string, from: string, to: string): Promise<MeterReading[]>;
  /** Stamps `alertedAt` so the variance alert fires once per day, not once per save. */
  markAlerted(depotId: string, date: string): Promise<void>;
}
