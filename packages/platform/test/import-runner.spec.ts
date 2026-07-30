import { runImport } from '../src/domain/import-runner';

describe('runImport', () => {
  it('numbers rows from 1 and tallies each status', async () => {
    const summary = await runImport(['a', 'b', 'c'], async (row) => {
      if (row === 'b') return { status: 'skipped', message: 'sudah ada' };
      return { status: 'created', id: `id-${row}` };
    });

    expect(summary).toEqual({
      created: 2,
      updated: 0,
      skipped: 1,
      failed: 0,
      results: [
        { row: 1, status: 'created', id: 'id-a' },
        { row: 2, status: 'skipped', message: 'sudah ada' },
        { row: 3, status: 'created', id: 'id-c' },
      ],
    });
  });

  it('fails only the throwing row and keeps going', async () => {
    const seen: string[] = [];
    const summary = await runImport(['a', 'b', 'c'], async (row) => {
      seen.push(row);
      if (row === 'b') throw new Error('kolom tidak valid');
      return { status: 'created' };
    });

    expect(seen).toEqual(['a', 'b', 'c']);
    expect(summary).toMatchObject({ created: 2, failed: 1 });
    expect(summary.results[1]).toEqual({ row: 2, status: 'failed', message: 'kolom tidak valid' });
  });

  it('reports a duplicate as skipped, not failed, so a re-upload reads clean', async () => {
    const duplicate = new Error('sudah terdaftar');
    const summary = await runImport(
      ['a'],
      async () => {
        throw duplicate;
      },
      (err) => err === duplicate,
    );

    expect(summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
  });

  it('describes a non-Error throw rather than leaking undefined', async () => {
    const summary = await runImport(['a'], async () => {
      throw 'boom';
    });
    expect(summary.results[0]?.message).toBe('Gagal memproses baris');
  });

  it('returns an empty summary for an empty batch', async () => {
    await expect(runImport([], async () => ({ status: 'created' }))).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });

  it('tallies overwritten rows separately from new ones (upsert imports)', async () => {
    const summary = await runImport(['a', 'b'], async (row) =>
      row === 'a' ? { status: 'created', id: 'id-a' } : { status: 'updated', id: 'id-b' },
    );

    expect(summary).toMatchObject({ created: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it('passes the zero-based index to the handler', async () => {
    const indexes: number[] = [];
    await runImport(['a', 'b'], async (_row, index) => {
      indexes.push(index);
      return { status: 'created' };
    });
    expect(indexes).toEqual([0, 1]);
  });
});
