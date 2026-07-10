export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function buildPage<T>(items: T[], total: number, page: number, limit: number): Page<T> {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
