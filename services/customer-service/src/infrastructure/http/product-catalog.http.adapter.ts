import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { ProductCatalogPort } from '../../application/ports/product-catalog.port';

/**
 * Existence check against product-service's public product endpoint. Fails OPEN: only a
 * definitive 404 reports "unknown"; an outage, timeout or missing config reports "exists"
 * so favouriting keeps working while the catalog is down (see ProductCatalogPort).
 */
@Injectable()
export class ProductCatalogHttpAdapter implements ProductCatalogPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(ProductCatalogHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async exists(productId: string): Promise<boolean> {
    const base = this.config.productServiceUrl;
    if (!base) {
      return true;
    }
    try {
      const res = await fetch(`${base}/api/v1/products/${encodeURIComponent(productId)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(ProductCatalogHttpAdapter.TIMEOUT_MS),
      });
      return res.status !== 404;
    } catch (error) {
      this.logger.warn(
        `Catalog check unavailable, allowing ${productId}: ${(error as Error).message}`,
      );
      return true;
    }
  }
}
