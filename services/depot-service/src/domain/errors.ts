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

/** A reservation was requested for more units than a stocked line has available. */
export class InsufficientStockError extends DomainError {
  readonly code = 'INVENTORY_INSUFFICIENT_STOCK';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(shortfalls: { productId: string; requested: number; available: number }[]) {
    const detail = shortfalls
      .map((s) => `${s.productId} (need ${s.requested}, have ${s.available})`)
      .join(', ');
    super(`Insufficient stock at the fulfilling depot: ${detail}.`);
  }
}

export class PricingRuleNotFoundError extends DomainError {
  readonly code = 'PRICING_RULE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Pricing rule not found.');
  }
}

export class InvalidPricingWindowError extends DomainError {
  readonly code = 'INVALID_PRICING_WINDOW';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(message = 'Invalid pricing rule window.') {
    super(message);
  }
}

export class FranchiseApplicationNotFoundError extends DomainError {
  readonly code = 'FRANCHISE_APPLICATION_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Franchise application not found.');
  }
}

/** Approve/reject or edit attempted on an already-decided (APPROVED/REJECTED) application. */
export class ApplicationAlreadyDecidedError extends DomainError {
  readonly code = 'FRANCHISE_APPLICATION_DECIDED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This application has already been approved or rejected.');
  }
}

export class PriceOverrideProposalNotFoundError extends DomainError {
  readonly code = 'PRICE_OVERRIDE_PROPOSAL_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Price-override proposal not found.');
  }
}

/** Approve/reject attempted on an already-decided (APPROVED/REJECTED) proposal. */
export class PriceOverrideProposalDecidedError extends DomainError {
  readonly code = 'PRICE_OVERRIDE_PROPOSAL_DECIDED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This price-override proposal has already been approved or rejected.');
  }
}
