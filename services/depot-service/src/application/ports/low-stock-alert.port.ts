export interface LowStockAlert {
  depotId: string;
  depotName: string;
  label: string;
  quantity: number;
  minimum: number;
}

/**
 * Emits an operational alert when a stock line crosses below its minimum (FR-074).
 * Best-effort side-effect of a stock movement — implementations never throw; a failed
 * or disabled alert must not roll back the movement that triggered it.
 */
export interface LowStockAlertPort {
  emit(alert: LowStockAlert, authorization: string): Promise<void>;
}
