export const SALES_PORT = Symbol('SALES_PORT');

/** Cross-service sales figure feeding SALES_TOTAL bonus rules. */
export interface SalesPort {
  /**
   * Total fulfilled sales (IDR) for a depot in [from, to], or null when the aggregate is
   * unavailable (order-service unconfigured or the call failed). null NEVER pays a bonus.
   */
  depotSales(depotId: string, from: Date, to: Date): Promise<number | null>;

  /**
   * Gallons a depot sold per LOCAL day, keyed 'YYYY-MM-DD', for the daily sales bonus.
   *
   * The bounds are day-keys, not Dates, on purpose: `Attendance.workDate` is a local date
   * stored as UTC-midnight, and order-service buckets by the same PRICING_TZ. Handing a raw
   * Date across the wire re-opens the question of whose midnight it is and shifts a day.
   *
   * null when the aggregate is unavailable — never pays a bonus, same rule as depotSales.
   * Days with no sales are simply absent from the map.
   */
  depotDailyGallons(
    depotId: string,
    fromDay: string,
    toDay: string,
  ): Promise<Map<string, number> | null>;
}
