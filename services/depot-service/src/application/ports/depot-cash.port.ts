/**
 * Asks payment-service how much PAID cash a depot took over a window — the number a
 * closing cashier is measured against.
 *
 * Fails CLOSED, unlike every other outbound call in this service. An unreachable
 * payment-service must stop the shift close, not let it complete against a guess: a made-up
 * expected total either accuses a cashier of a shortfall or quietly absolves a real one.
 */
export interface DepotCashPort {
  /**
   * C2: `cashierShiftId` names the DRAWER. Without it this was a depot plus a window, and
   * two shifts open at once each claimed the whole window — the same money against both.
   */
  totalPaidCash(depotId: string, from: Date, to: Date, cashierShiftId?: string): Promise<number>;
}
