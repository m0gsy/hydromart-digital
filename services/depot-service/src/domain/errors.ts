import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class DepotNotFoundError extends DomainError {
  readonly code = 'DEPOT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Depot not found.');
  }
}

export class DuplicateDepotCodeError extends DomainError {
  readonly code = 'DEPOT_CODE_TAKEN';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('A depot with this code already exists.');
  }
}

export class InventoryItemNotFoundError extends DomainError {
  readonly code = 'INVENTORY_ITEM_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Inventory item not found.');
  }
}

export class DuplicateInventoryLineError extends DomainError {
  readonly code = 'INVENTORY_LINE_EXISTS';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('A stock line for this item already exists in the depot.');
  }
}

export class ProductLineRequiresProductError extends DomainError {
  readonly code = 'INVENTORY_PRODUCT_REQUIRED';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('A PRODUK stock line requires a productId; raw stock lines must not set one.');
  }
}

export class NegativeStockError extends DomainError {
  readonly code = 'INVENTORY_NEGATIVE_STOCK';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Adjustment would drive stock below zero.');
  }
}
