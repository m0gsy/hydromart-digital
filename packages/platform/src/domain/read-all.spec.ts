import { readAllPages } from './read-all';

const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `r-${from + i}` }));

const boom = (): never => {
  throw new Error('too many rows');
};

describe('readAllPages', () => {
  it('returns a single short page without asking for another', async () => {
    const fetchPage = jest.fn(async () => rows(0, 3));
    const out = await readAllPages(fetchPage, { max: 100, onOverflow: boom, pageSize: 10 });

    expect(out).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ take: 10, cursor: undefined });
  });

  it('walks with the last row of the previous page as the cursor', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(rows(0, 2))
      .mockResolvedValueOnce(rows(2, 1));
    const out = await readAllPages(fetchPage, { max: 100, onOverflow: boom, pageSize: 2 });

    expect(out.map((r) => r.id)).toEqual(['r-0', 'r-1', 'r-2']);
    expect(fetchPage).toHaveBeenLastCalledWith({ take: 2, cursor: 'r-1' });
  });

  it('stops on an exactly-empty final page rather than looping', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce(rows(0, 2)).mockResolvedValueOnce([]);
    const out = await readAllPages(fetchPage, { max: 100, onOverflow: boom, pageSize: 2 });

    expect(out).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('hands control to onOverflow rather than truncating', async () => {
    const fetchPage = jest.fn(async () => rows(0, 2));
    await expect(
      readAllPages(fetchPage, { max: 4, onOverflow: boom, pageSize: 2 }),
    ).rejects.toThrow('too many rows');
  });

  it('defaults the page size when the caller does not pick one', async () => {
    const fetchPage = jest.fn(async () => rows(0, 1));
    await readAllPages(fetchPage, { max: 10, onOverflow: boom });

    expect(fetchPage).toHaveBeenCalledWith({ take: 500, cursor: undefined });
  });
});
