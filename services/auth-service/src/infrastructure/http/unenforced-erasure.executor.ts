import { ErasureExecutor } from '../../application/ports/erasure-executor.port';

/**
 * A dataset the registry KNOWS holds this person and cannot erase yet, with the reason.
 *
 * It exists so the gap is a row in the coverage report rather than an omission from it.
 * `configured: false` puts it on the UNENFORCED path in `DataSubjectService`, and
 * `unenforcedReason` replaces the generic "owner not configured" with what is actually
 * blocking it and what would unblock it.
 */
export class UnenforcedErasure implements ErasureExecutor {
  readonly configured = false;

  constructor(
    readonly dataset: string,
    readonly unenforcedReason: string,
  ) {}

  erase(): Promise<number | null> {
    return Promise.resolve(null);
  }
}
