/**
 * A ceiling on every `findMany` that did not ask for one.
 *
 * The audit counted 129 `findMany` calls across the services with no `take`. Each one is a
 * request whose cost is set by how much data the table happens to hold — fine on day one,
 * an out-of-memory on the day a depot has three years of stock movements. Guarding them one
 * call site at a time leaves the next new query unguarded, so the bound lives here instead:
 * a Prisma middleware every PrismaService installs.
 *
 * A caller that passes its own `take` keeps it — the middleware only fills in the missing
 * bound. Paths that genuinely need every row (exports, purge sweeps, month-end reports) must
 * therefore page explicitly with `take` + `cursor`; they are not exempt, they are just the
 * ones that own their bound.
 *
 * Truncation is never silent: when a query comes back holding exactly the cap, `onTruncate`
 * fires so the service logs which model hit it. A capped read that nobody notices is the
 * same defect wearing a smaller number.
 */
export const DEFAULT_MAX_ROWS = 500;

export interface QueryBoundsOptions {
  /** Rows a bound-less `findMany` may return. Defaults to {@link DEFAULT_MAX_ROWS}. */
  max?: number;
  /** Called when a capped query came back full — i.e. rows were probably dropped. */
  onTruncate?: (model: string, max: number) => void;
}

/** The subset of Prisma's `MiddlewareParams` this needs; typed locally so the shared package
 * stays free of a dependency on any one service's generated client. */
export interface QueryBoundsParams {
  model?: string;
  action: string;
  args?: Record<string, unknown>;
}

/**
 * Generic in the params so each service's own `Prisma.MiddlewareParams` — which carries two
 * more fields and brands `model`/`action` as generated unions — satisfies it verbatim. A
 * concrete `QueryBoundsParams` here would not be assignable to `$use`.
 */
export type QueryBoundsMiddleware = <P extends QueryBoundsParams>(
  params: P,
  next: (params: P) => Promise<unknown>,
) => Promise<unknown>;

/**
 * The wiring every PrismaService uses: the bound, with the truncation warning pointed at that
 * service's own logger. Kept here rather than inlined 16 times so the message cannot drift.
 */
export function loggedQueryBounds(
  logger: { warn: (message: string) => void },
  max?: number,
): QueryBoundsMiddleware {
  return queryBoundsMiddleware({
    max,
    onTruncate: (model, cap) =>
      logger.warn(`findMany on ${model} returned the full ${cap}-row bound — results truncated`),
  });
}

export function queryBoundsMiddleware(options: QueryBoundsOptions = {}): QueryBoundsMiddleware {
  const max = options.max ?? DEFAULT_MAX_ROWS;

  return async <P extends QueryBoundsParams>(params: P, next: (params: P) => Promise<unknown>) => {
    if (params.action !== 'findMany') return next(params);

    const args = params.args ?? {};
    /*
     * PLAT-8 — the bound used to stop at the top level, and said so in its own note: "a
     * relation list still returns whole". That is the half of the problem the middleware
     * exists to solve. `order.findMany({ include: { items: true } })` is bounded to 500
     * ORDERS and unbounded in items, so one order with three years of movements is the
     * out-of-memory this file was written to prevent, reached by a different road.
     *
     * The relation objects are in the args, so they can be bounded here: `include: { x: true }`
     * becomes `{ x: { take: max } }`, and one that already names a `take` is left alone —
     * same rule as the top level.
     */
    const bounded = {
      ...args,
      ...(typeof args.take === 'number' ? {} : { take: max }),
      ...boundRelations(args.include, 'include', max),
      ...boundRelations(args.select, 'select', max),
    };
    params.args = bounded;
    const rows = await next(params);
    if (Array.isArray(rows)) {
      if (typeof args.take !== 'number' && rows.length >= max) {
        options.onTruncate?.(params.model ?? 'unknown', max);
      }
      reportFullRelations(rows, params.model ?? 'unknown', max, options.onTruncate);
    }
    return rows;
  };
}

/**
 * PLAT-8: `include`/`select` with a bound filled into each relation that has none.
 *
 * `true` becomes `{ take: max }` — still the whole relation, just not all of it. A relation
 * given its own object keeps whatever it asked for, including a `take` it set itself; a
 * scalar `select: { name: true }` is untouched, because `take` there means nothing and
 * Prisma would reject it.
 */
function boundRelations(
  clause: unknown,
  key: 'include' | 'select',
  max: number,
): Record<string, unknown> {
  if (!clause || typeof clause !== 'object') return {};
  const entries = Object.entries(clause as Record<string, unknown>);
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [relation, value] of entries) {
    if (key === 'include' && value === true) {
      next[relation] = { take: max };
      changed = true;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>;
      // A `select` entry is a relation only when it carries relation arguments; a plain
      // `{ id: true }` projection is not a list and must not be given a `take`.
      const isRelation = key === 'include' || 'select' in inner || 'include' in inner || 'where' in inner;
      if (isRelation && typeof inner.take !== 'number') {
        next[relation] = { ...inner, take: max };
        changed = true;
        continue;
      }
    }
    next[relation] = value;
  }
  return changed ? { [key]: next } : {};
}

/** A relation array that came back exactly full is the same truncation, one level down. */
function reportFullRelations(
  rows: unknown[],
  model: string,
  max: number,
  onTruncate?: (model: string, max: number) => void,
): void {
  if (!onTruncate) return;
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length >= max && !seen.has(key)) {
        seen.add(key);
        onTruncate(`${model}.${key}`, max);
      }
    }
  }
}
