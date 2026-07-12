import { shop as base } from '../id/shop';

// English — mirrors the shape of id/shop.ts.
export const shop: typeof base = {
  catalog: {
    title: 'Order water',
    subtitle: 'Refill gallons and bottled water, delivered from the nearest depot.',
    subtitleDepot: 'Refill gallons and bottled water, delivered from {depot} — {dist} km.',
    searchPlaceholder: 'Search products…',
    searchLabel: 'Search products',
    all: 'All',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    pageN: 'Page {n}',
    trending: 'Best sellers',
  },
  pdp: {
    backToCatalog: 'Back to catalog',
    notFound: 'Product not found.',
    unitSku: 'per {unit} · SKU {sku}',
    memberDiscount: 'Member discount {percent}% applied automatically at checkout.',
    deliveredFrom: 'Delivered from {depot}',
    deliveryMeta: '{km} km · delivery',
    open: 'Open',
    cutoff: 'Order before 4pm — arrives today, ±30 min',
    setLocation: 'Set your location to see delivery estimates',
    added: 'Added',
    addToCart: 'Add to cart —',
    toCart: 'To cart →',
    addError: 'Failed to add to cart.',
    related: 'Frequently bought together',
  },
  card: {
    addAria: 'Add {name} to cart',
  },
  empty: {
    searchTitle: 'No results for “{query}”',
    searchBody: 'Try another keyword, or browse the best sellers below.',
    categoryTitle: 'No products in “{category}” yet',
    categoryTitleUnknown: 'No products in this category yet',
    categoryBody: 'This category is being stocked. Try another one.',
    catalogTitle: 'Catalog is being stocked',
    catalogBody: 'Products will be available soon. Check back shortly.',
    clearSearch: 'Clear search',
    viewAll: 'View all products',
    backHome: 'Back to home',
  },
};
