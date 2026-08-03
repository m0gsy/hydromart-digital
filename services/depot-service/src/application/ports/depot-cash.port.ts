/**
 * Asks payment-service how much PAID cash a depot took over a window — the number a
 * closing cashier is measured against.
 *
 * Fails CLOSED, unlike every other outbound call in this service. An unreachable
 * payment-service must stop the shift close, not let it complete against a guess: a made-up
 * expected total either accuses a cashier of a shortfall or quietly absolves a real one.
 */
export interface DepotCashPort {
  totalPaidCash(depotId: string, from: Date, to: Date): Promise<number>;
}
