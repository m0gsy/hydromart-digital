import { ActivityConditions } from './activity-segment.port';

/**
 * Segment for the broadcast audience (FR-087). Empty = all reachable customers.
 *
 * Two halves with two owners: `tier`/`city` are customer attributes the directory below
 * resolves, the rest are activity facts only order-service knows. Both are expressed here
 * because a caller thinks in one audience, not in two services.
 */
export interface SegmentFilter extends ActivityConditions {
  tier?: string;
  city?: string;
}

/** A broadcast recipient resolved from the customer directory. */
export interface DirectoryRecipient {
  customerId: string;
  name: string;
  phone: string;
}

/**
 * Resolves a broadcast audience from customer-service by attribute segment (FR-087).
 * Implementations THROW when the directory is unreachable or unconfigured — a campaign must
 * never be silently built from an empty/partial audience.
 */
export interface CustomerDirectoryPort {
  resolveSegment(filter: SegmentFilter, authorization: string): Promise<DirectoryRecipient[]>;
}
