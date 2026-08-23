import { PaymentMethod } from '../../domain/payment';

export interface ChargeRequest {
  method: PaymentMethod;
  amount: number;
  orderId: string;
  paymentId: string;
}

export interface ChargeResult {
  /** Provider charge id / VA number / QRIS payload. */
  reference: string;
  /** Human-readable instruction shown to the customer. */
  instruction: string;
  /** Raw provider payload (JSON string) for audit/reconciliation. */
  raw: string;
}

export interface RefundResult {
  reference: string;
  raw: string;
}

/**
 * Talks to the external payment provider for online methods. CASH/TRANSFER are
 * settled out-of-band and never reach the gateway.
 */
export interface PaymentGatewayPort {
  /**
   * O5: whether this deployment can charge at all. The adapter knows — it is the thing
   * holding the URL — and the service must not read the environment behind its own port to
   * find out. Production answers false today: `PAYMENT_GATEWAY_BASE_URL` is empty, which is
   * why e-wallet and virtual account are buttons that cannot succeed.
   */
  isConfigured(): boolean;
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  refund(reference: string, amount: number): Promise<RefundResult>;
}
