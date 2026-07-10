import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { CatalogProduct, ProductCatalogPort } from '../../application/ports/product-catalog.port';

interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  unit: string;
  basePrice: number;
  active: boolean;
}

/**
 * Reads product data from the product-service over HTTP. The public GET
 * endpoint only returns active products (404 otherwise), so a 404 maps to
 * `null`. Network/5xx failures throw so checkout can fail closed rather than
 * price an order incorrectly.
 */
@Injectable()
export class ProductCatalogHttpAdapter implements ProductCatalogPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ProductCatalogHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    const url = `${this.config.productServiceUrl}/api/v1/products/${productId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ProductCatalogHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`product-service responded ${res.status}`);
      }
      const body = (await res.json()) as ProductResponse;
      return {
        id: body.id,
        name: body.name,
        sku: body.sku,
        unit: body.unit,
        basePrice: body.basePrice,
        active: body.active,
      };
    } catch (error) {
      this.logger.error(`Failed to resolve product ${productId}: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
