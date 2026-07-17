/** Mean customer rating over a courier's delivered orders (design 4c). */
export interface RatingSummary {
  /** Mean of the reviews found, 1..5; null when none of the orders were reviewed. */
  average: number | null;
  count: number;
}

/**
 * Reads the mean order rating from order-service (which owns OrderReview). Used only
 * for the weekly performance card, so it fails OPEN — a null average renders as "—".
 */
export interface RatingPort {
  avgRating(orderIds: string[]): Promise<RatingSummary>;
}
