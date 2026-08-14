export type ChurnBand = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * One customer's churn band, scored by forecast-service.
 *
 * Read one customer at a time rather than filtered out of the at-risk list: that list is
 * the top-N most at-risk, so anyone outside it would come back LOW when the truth is "not
 * in the sample" — and LOW is the answer a manager acts on by doing nothing.
 *
 * `null` means either "forecast-service could not be read" or "this customer has never
 * ordered". Both are honestly rendered as "—"; neither is LOW.
 */
export interface ChurnRiskPort {
  bandFor(customerId: string): Promise<ChurnBand | null>;
}
