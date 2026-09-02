import { api } from './api';
import { endpoints } from './endpoints';
import { fetchAllPages } from './fetch-all-pages';
import type { DepotAdmin, Page } from './types';

/**
 * CA-2-26 — the depot directory, all of it.
 *
 * `endpoints.depots.manage({ limit: 100 })` was written on eighteen screens. On six of them
 * the register names it as a bug, and on two of those the truncated slice is not merely
 * displayed but COUNTED: `hq/franchise` prints the number of franchise depots and the
 * number of ownerless ones from it, and `hq/inventory` prints how many depots are short of
 * stock. Both numbers are the length of a slice presented as the length of the network, and
 * neither screen says so — which is the same defect as the catalogue one `fetchAllPages`
 * exists for, on a different list.
 *
 * 100 is not an arbitrary page size either: it is `@Max(100)` on the `limit` field of
 * depot-service's `ListDepotsQueryDto` (`services/depot-service/src/modules/dto/depot.dto.ts:39`),
 * so asking for more is a 400, not a longer answer. Paging is the only way past it, and
 * `fetchAllPages` already refuses rather than truncating when a list outgrows what a screen
 * can hold — so the ceiling stays declared instead of silently reappearing here.
 *
 * `getCached` because the depot directory is the most-read list in the console and changes
 * about as often as a depot opens; every caller here already used it.
 */
export function fetchAllDepots(q: { ownershipType?: string } = {}): Promise<DepotAdmin[]> {
  return fetchAllPages<DepotAdmin>(({ page, limit }) =>
    api.getCached<Page<DepotAdmin>>(endpoints.depots.manage({ ...q, page, limit }), true),
  );
}
