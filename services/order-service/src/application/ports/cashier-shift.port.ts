/**
 * Asks depot-service whether the staff member ringing up a counter sale has a shift open
 * at that depot.
 *
 * Fails CLOSED. A counter sale already cannot happen without depot-service (it prices and
 * reserves the stock), so refusing here costs nothing that was going to work anyway — and
 * the alternative is cash entering a drawer that no named person is answerable for.
 */
/** The caller's own open shift at a depot. `openedAt` is what C5 needs. */
export interface OpenShift {
  id: string;
  openedAt: Date;
}

export interface CashierShiftPort {
  hasOpenShift(depotId: string, authorization: string): Promise<boolean>;
  /**
   * C5: the caller's open shift, with the time it opened.
   *
   * The endpoint behind `hasOpenShift` has always returned this — the adapter read `body.id`
   * to answer yes/no and dropped the rest. Voiding needs `openedAt` to tell a sale that
   * belongs to the drawer still open from one that belongs to a drawer already counted.
   */
  openShift(depotId: string, authorization: string): Promise<OpenShift | null>;
}
