/**
 * CA-4-49, step 3 — a readable link for a receipt this service does not own.
 *
 * A courier's expense receipt is uploaded through the courier app into delivery-service's
 * bucket, so payout-service holds the URL and none of the credentials. Since that bucket
 * became private the stored URL opens nothing, which means the reviewer approving money
 * sees a dead image where the proof should be.
 *
 * A port rather than a direct fetch, for the usual reason: a receipt list must not fail
 * because a peer service is down. The adapter answers null and the screen says "no receipt"
 * — never a broken frame, and never an error on the money screen.
 */
export interface PhotoLinkPort {
  /** A time-limited link for the stored URL, or null when one cannot be minted. */
  signedUrl(storedUrl: string): Promise<string | null>;
}
