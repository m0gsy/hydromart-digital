import {
  DEFAULT_MAX_ROWS,
  loggedQueryBounds,
  queryBoundsMiddleware,
  QueryBoundsParams,
} from './query-bounds';

const call = (
  middleware: ReturnType<typeof queryBoundsMiddleware>,
  params: QueryBoundsParams,
  result: unknown = [],
): Promise<{ seen: QueryBoundsParams; out: unknown }> => {
  let seen!: QueryBoundsParams;
  return middleware(params, async (p) => {
    seen = { ...p, args: p.args ? { ...p.args } : undefined };
    return result;
  }).then((out) => ({ seen, out }));
};

describe('queryBoundsMiddleware', () => {
  it('fills in the default bound when findMany asks for none', async () => {
    const { seen } = await call(queryBoundsMiddleware(), { model: 'Order', action: 'findMany' });

    expect(seen.args).toEqual({ take: DEFAULT_MAX_ROWS });
  });

  it('keeps the rest of the query untouched while adding the bound', async () => {
    const { seen } = await call(queryBoundsMiddleware({ max: 10 }), {
      model: 'Order',
      action: 'findMany',
      args: { where: { depotId: 'd1' }, orderBy: { createdAt: 'desc' } },
    });

    expect(seen.args).toEqual({
      where: { depotId: 'd1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('leaves a caller-supplied take alone — that caller owns its bound', async () => {
    const { seen } = await call(queryBoundsMiddleware({ max: 10 }), {
      model: 'Order',
      action: 'findMany',
      args: { take: 5_000, cursor: { id: 'x' } },
    });

    expect(seen.args).toEqual({ take: 5_000, cursor: { id: 'x' } });
  });

  it('ignores every action that is not findMany', async () => {
    const { seen } = await call(queryBoundsMiddleware({ max: 10 }), {
      model: 'Order',
      action: 'findFirst',
      args: { where: { id: 'o1' } },
    });

    expect(seen.args).toEqual({ where: { id: 'o1' } });
  });

  it('reports truncation when the capped query came back full', async () => {
    const onTruncate = jest.fn();
    await call(
      queryBoundsMiddleware({ max: 2, onTruncate }),
      { model: 'StockMovement', action: 'findMany' },
      [1, 2],
    );

    expect(onTruncate).toHaveBeenCalledWith('StockMovement', 2);
  });

  it('names the model as unknown when Prisma gives none', async () => {
    const onTruncate = jest.fn();
    await call(queryBoundsMiddleware({ max: 1, onTruncate }), { action: 'findMany' }, [1]);

    expect(onTruncate).toHaveBeenCalledWith('unknown', 1);
  });

  it('stays quiet when the result is short of the cap', async () => {
    const onTruncate = jest.fn();
    await call(
      queryBoundsMiddleware({ max: 5, onTruncate }),
      { model: 'Order', action: 'findMany' },
      [1, 2],
    );

    expect(onTruncate).not.toHaveBeenCalled();
  });

  it('stays quiet when a capped query returns something that is not a list', async () => {
    const onTruncate = jest.fn();
    const { out } = await call(
      queryBoundsMiddleware({ max: 1, onTruncate }),
      { model: 'Order', action: 'findMany' },
      null,
    );

    expect(out).toBeNull();
    expect(onTruncate).not.toHaveBeenCalled();
  });

  it('loggedQueryBounds warns through the service logger on truncation', async () => {
    const logger = { warn: jest.fn() };
    const { seen } = await call(
      loggedQueryBounds(logger, 2),
      { model: 'Employee', action: 'findMany' },
      [1, 2],
    );

    expect(seen.args).toEqual({ take: 2 });
    expect(logger.warn).toHaveBeenCalledWith(
      'findMany on Employee returned the full 2-row bound — results truncated',
    );
  });

  it('loggedQueryBounds falls back to the default bound', async () => {
    const logger = { warn: jest.fn() };
    const { seen } = await call(loggedQueryBounds(logger), {
      model: 'Employee',
      action: 'findMany',
    });

    expect(seen.args).toEqual({ take: DEFAULT_MAX_ROWS });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('caps without a listener configured', async () => {
    const { seen, out } = await call(
      queryBoundsMiddleware({ max: 1 }),
      { model: 'Order', action: 'findMany' },
      [1],
    );

    expect(seen.args).toEqual({ take: 1 });
    expect(out).toEqual([1]);
  });
});
