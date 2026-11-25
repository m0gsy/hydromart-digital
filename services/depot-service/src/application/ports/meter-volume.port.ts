import { MeterVolume } from '../../domain/maintenance';

/** One depot's WIB day range, inclusive, as 'YYYY-MM-DD'. */
export interface MeterRange {
  depotId: string;
  from: string;
  to: string;
}

/**
 * HD-15: the water through a depot's meter over a range, from order-service's daily readings.
 * One answer per range, in order; a range it could not read is null (never 0), so "no meter
 * figure" is not mistaken for "no water used". Unconfigured or unreachable is all nulls (unless `strict`).
 */
export interface MeterVolumePort {
  /**
   * `strict` THROWS (503) when any answer cannot be had, instead of answering nulls: the due sweep
   * must never read an unreadable meter as "nothing due". The web list stays soft.
   */
  volumes(ranges: readonly MeterRange[], strict?: boolean): Promise<Array<MeterVolume | null>>;
}
