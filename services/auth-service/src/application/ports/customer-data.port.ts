/**
 * The customer's PII that lives outside auth-service. auth-service owns the account
 * (phone, email, name); customer-service owns the profile and the delivery addresses,
 * which carry a recipient name and phone of their own.
 *
 * Tahap 1 stops there. Orders, payments and loyalty rows are NOT exported or scrubbed:
 * they are FINANCIAL under item 12 and must survive ten years, and once the account is
 * anonymised they no longer point at a person. Claiming to export them would also mean
 * promising a completeness this fan-out cannot yet guarantee.
 */
export interface CustomerDataPort {
  /** Everything customer-service holds for this customer, as a plain JSON blob. */
  export(customerId: string): Promise<Record<string, unknown>>;
  /** Clear the profile and address PII. Must be idempotent — a retry is not an error. */
  anonymise(customerId: string): Promise<void>;
  /**
   * CA-3-48: push a MARKETING consent decision to the switch that actually stops mail.
   *
   * The ledger this service owns is the LEGAL record of the decision, and nothing consults
   * it before sending. The thing that does is `categories.marketing` in customer-service —
   * crm-service reads it before every promotional send and the audience query joins on it.
   * So a customer who withdrew consent on the panel headed "Persetujuan" kept receiving
   * promotions, while an identical-looking switch two panels up worked.
   *
   * Pushed at decision time rather than read at send time so that the audience query, which
   * has no failure mode at all, honours it too.
   */
  setMarketingAllowed(customerId: string, allowed: boolean): Promise<void>;
}
