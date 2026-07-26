export const SALES_PORT = Symbol('SALES_PORT');

/** Cross-service sales figure feeding SALES_TOTAL bonus rules. */
export interface SalesPort {
  /**
   * Total fulfilled sales (IDR) for a depot in [from, to], or null when the aggregate is
   * unavailable (order-service unconfigured or the call failed). null NEVER pays a bonus.
   */
  depotSales(depotId: string, from: Date, to: Date): Promise<number | null>;
}
