import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { CatalogProduct, ProductCatalogPort } from '../../application/ports/product-catalog.port';

interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
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

  private toProduct(body: ProductResponse): CatalogProduct {
    return {
      id: body.id,
      name: body.name,
      sku: body.sku,
      unit: body.unit,
      // ?? on both: a product-service still on the pre-volume schema omits these
      // fields entirely, and an undefined volumeMl must read as "unmeasured", not NaN.
      volumeMl: body.volumeMl ?? null,
      isGallon: body.isGallon ?? false,
      basePrice: body.basePrice,
      active: body.active,
    };
  }

  /** One call for a whole cart (audit S-7). Same fail-closed behaviour as getProduct. */
  async getProducts(productIds: string[]): Promise<Map<string, CatalogProduct>> {
    if (productIds.length === 0) return new Map();
    const url = `${this.config.productServiceUrl}/api/v1/products/batch?ids=${productIds.join(',')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ProductCatalogHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`product-service responded ${res.status}`);
      }
      const body = (await res.json()) as ProductResponse[];
      return new Map(body.map((row) => [row.id, this.toProduct(row)]));
    } catch (error) {
      this.logger.error(`Failed to resolve ${productIds.length} product(s): ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

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
      return this.toProduct((await res.json()) as ProductResponse);
    } catch (error) {
      this.logger.error(`Failed to resolve product ${productId}: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
