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
  /**
   * Named customers, when the audience is a list rather than a rule — one at-risk customer
   * being re-engaged from the churn screen, say. The DIRECTORY still supplies the phone
   * and the name, so this narrows an audience, it never invents a recipient out of an id.
   */
  customerIds?: string[];
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
  /**
   * The same audience, resolved as a SERVICE rather than as the caller.
   *
   * A depot manager may compose a blast to their own depot's customers without holding the
   * head-office right to page through the customer directory, so their token cannot be the
   * one that opens it. The depot scope is enforced before this is reached; this call only
   * fetches the attribute half.
   */
  resolveSegmentAsService(filter: SegmentFilter): Promise<DirectoryRecipient[]>;
}
