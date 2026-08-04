export const COURIER_COD_PORT = Symbol('CourierCodPort');

/** COD a depot accepted in a window, as delivery-service reports it. */
export interface DepositedCod {
  depositedIdr: number;
  expectedIdr: number;
  settlements: number;
}

/**
 * The courier half of a depot's daily takings.
 *
 * Counter cash posts itself into this service's own cashbook when a cashier shift closes.
 * Courier COD does not — it lives in delivery-service, accepted settlement by settlement.
 * Closing a day without it would count half the money and call it the total.
 *
 * Fails CLOSED at close time (see DailyCloseService): a day closed with COD silently
 * missing would record a total nobody can reproduce later.
 */
export interface CourierCodPort {
  depositedInWindow(depotId: string, from: Date, to: Date): Promise<DepositedCod>;
}
