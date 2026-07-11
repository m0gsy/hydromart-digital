import { IngestCommand } from './recommendation.repository';

/**
 * Pulls completed orders from order-service, page by page, for the rebuild backfill.
 * `cursor` is opaque to the caller (round-tripped from the previous page's `nextCursor`);
 * `null` means "start from the beginning" and `nextCursor: null` means "no more pages".
 */
export interface OrderFeedPort {
  fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }>;
}
