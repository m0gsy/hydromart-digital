import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  CatalogLookup,
  CatalogProduct,
  ProductCatalogPort,
} from '../../application/ports/product-catalog.port';

interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  unit: string;
  active: boolean;
}

/**
 * Resolves a product through product-service's public catalog endpoint — the same one
 * the shop uses, so it is active-only: a deactivated product reads as `missing`, which
 * is what we want when someone tries to open a stock line for it.
 *
 * Never throws. A blank PRODUCT_SERVICE_URL (dev default), a timeout, or a 5xx all come
 * back `unavailable`, and the caller decides — for stock lines that means accepting the
 * line with the label the operator typed rather than blocking depot work on a catalog
 * outage.
 */
@Injectable()
export class ProductCatalogHttpAdapter implements ProductCatalogPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ProductCatalogHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async find(productId: string): Promise<CatalogLookup> {
    return this.lookup(productId, `/api/v1/products/${productId}`, (body) =>
      this.toProduct(body as ProductResponse),
    );
  }

  async findBySku(sku: string): Promise<CatalogLookup> {
    // The catalog has no by-SKU route; search is the closest thing, and it matches on name
    // as well. So the SKU is re-checked here — "AIR-19" must not import as "AIR-19L".
    return this.lookup(
      sku,
      `/api/v1/products?search=${encodeURIComponent(sku)}&limit=20`,
      (body) => {
        const hit = ((body as { items?: ProductResponse[] }).items ?? []).find(
          (p) => p.sku.toLowerCase() === sku.trim().toLowerCase(),
        );
        return hit ? this.toProduct(hit) : null;
      },
    );
  }

  private toProduct(body: ProductResponse): CatalogProduct {
    return {
      id: body.id,
      name: body.name,
      sku: body.sku,
      unit: body.unit,
      active: body.active,
    };
  }

  private async lookup(
    subject: string,
    path: string,
    pick: (body: unknown) => CatalogProduct | null,
  ): Promise<CatalogLookup> {
    const base = this.config.productServiceUrl;
    if (!base) {
      this.logger.debug(`Catalog lookup skipped for ${subject} (no PRODUCT_SERVICE_URL)`);
      return { status: 'unavailable' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ProductCatalogHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) {
        return { status: 'missing' };
      }
      if (!res.ok) {
        throw new Error(`product-service responded ${res.status}`);
      }
      const product = pick(await res.json());
      return product ? { status: 'found', product } : { status: 'missing' };
    } catch (error) {
      this.logger.warn(`Catalog lookup for ${subject} failed: ${(error as Error).message}`);
      return { status: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
