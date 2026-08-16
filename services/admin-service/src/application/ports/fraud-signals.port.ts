/** One customer's refund activity in the scanned window. */
export interface RepeatedRefundSignal {
  customerId: string;
  refunds: number;
  amountIdr: number;
}

/**
 * Reads the raw facts a fraud scan is allowed to judge on.
 *
 * Deliberately ONE signal. Design 15b describes a fraud queue and never says what makes an
 * order suspicious, so the scan starts from the only thing this platform can already answer
 * without interpretation: settled refunds, which carry a timestamp and an owner and need
 * nothing guessed about intent.
 *
 * The second rule the plan floated — several accounts sharing one address — is not here on
 * purpose. Matching addresses means normalising free text, and a threshold picked without a
 * spec turns a typo into an accusation against a real customer. That needs a decision from
 * the business, not a heuristic from me.
 *
 * Returns null when payment-service cannot be read. A scan that cannot see the data must
 * report nothing rather than an empty, reassuring queue.
 */
export interface FraudSignalsPort {
  repeatedRefunds(from: Date, to: Date, minRefunds: number): Promise<RepeatedRefundSignal[] | null>;
}
