/** Attribute segment for the broadcast audience (FR-087). Empty = all reachable customers. */
export interface SegmentFilter {
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
