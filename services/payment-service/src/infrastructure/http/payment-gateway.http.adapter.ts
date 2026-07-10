import { Injectable, Logger } from '@nestjs/common';

import { PaymentConfigService } from '../../config/payment-config.service';
import {
  ChargeRequest,
  ChargeResult,
  PaymentGatewayPort,
  RefundResult,
} from '../../application/ports/payment-gateway.port';

interface GatewayChargeResponse {
  reference: string;
  instruction?: string;
}

interface GatewayRefundResponse {
  reference: string;
}

/**
 * Talks to the external payment provider over HTTP. When no gateway is
 * configured (dev), every call throws so online charges fail closed rather than
 * silently succeed. Swap the base URL/API key for the real provider in staging.
 */
@Injectable()
export class PaymentGatewayHttpAdapter implements PaymentGatewayPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(PaymentGatewayHttpAdapter.name);

  constructor(private readonly config: PaymentConfigService) {}

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const body = await this.post('/charges', {
      method: request.method,
      amount: request.amount,
      orderId: request.orderId,
      paymentId: request.paymentId,
    });
    const parsed = body as GatewayChargeResponse;
    return {
      reference: parsed.reference,
      instruction: parsed.instruction ?? 'Complete the payment using the reference provided.',
      raw: JSON.stringify(body),
    };
  }

  async refund(reference: string, amount: number): Promise<RefundResult> {
    const body = await this.post('/refunds', { reference, amount });
    const parsed = body as GatewayRefundResponse;
    return { reference: parsed.reference, raw: JSON.stringify(body) };
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const baseUrl = this.config.gatewayBaseUrl;
    if (!baseUrl) {
      throw new Error('Payment gateway is not configured (PAYMENT_GATEWAY_BASE_URL).');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PaymentGatewayHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.gatewayApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment gateway responded ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      this.logger.error(`Gateway POST ${path} failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
