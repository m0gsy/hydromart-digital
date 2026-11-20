import type { ErasureSubject } from './erasure-executor.port';

/**
 * One service's copy of a person, read for a PDP export (item 13).
 *
 * The export used to read customer-service alone, so a subscription's or a delivery's
 * address and pin — the person's home, on a map — were erased on request but never shown
 * to the person who asked what is held about them.
 */
export interface PersonalDataSource {
  /** The key the section is filed under in the export. */
  readonly section: string;
  collect(subject: ErasureSubject): Promise<unknown>;
}

export const PERSONAL_DATA_SOURCES = Symbol('PersonalDataSources');
