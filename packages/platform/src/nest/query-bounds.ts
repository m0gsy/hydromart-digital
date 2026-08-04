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
    // ponytail: top-level reads only. Prisma middleware never sees a nested `include`, so a
    // relation list still returns whole; bound those on the relation's own repository method.
    if (params.action !== 'findMany') return next(params);

    const args = params.args ?? {};
    if (typeof args.take === 'number') return next(params);

    params.args = { ...args, take: max };
    const rows = await next(params);
    if (Array.isArray(rows) && rows.length >= max) {
      options.onTruncate?.(params.model ?? 'unknown', max);
    }
    return rows;
  };
}
