import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class ProductNotFoundError extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Product not found.');
  }
}

export class CategoryNotFoundError extends DomainError {
  readonly code = 'PRODUCT_CATEGORY_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Category not found.');
  }
}

export class DuplicateSkuError extends DomainError {
  readonly code = 'PRODUCT_SKU_TAKEN';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('A product with this SKU already exists.');
  }
}

export class DuplicateSlugError extends DomainError {
  readonly code = 'PRODUCT_CATEGORY_SLUG_TAKEN';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('A category with this slug already exists.');
  }
}
