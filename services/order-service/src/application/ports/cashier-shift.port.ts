/**
 * Asks depot-service whether the staff member ringing up a counter sale has a shift open
 * at that depot.
 *
 * Fails CLOSED. A counter sale already cannot happen without depot-service (it prices and
 * reserves the stock), so refusing here costs nothing that was going to work anyway — and
 * the alternative is cash entering a drawer that no named person is answerable for.
 */
export interface CashierShiftPort {
  hasOpenShift(depotId: string, authorization: string): Promise<boolean>;
}
