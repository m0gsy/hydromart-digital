export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /**
   * Send this back as `?cursor=` to read the next page without an OFFSET (audit Q-16).
   * Null means this was the last page. Page numbers keep working exactly as before — a
   * client that ignores this field sees no change.
   */
  nextCursor?: string | null;
}

export function buildPage<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
  nextCursor: string | null = null,
): Page<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    nextCursor,
  };
}
