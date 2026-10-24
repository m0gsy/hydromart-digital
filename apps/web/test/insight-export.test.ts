import { describe, expect, it } from 'vitest';

import { exportTable } from '@/lib/insight/export';

describe('exportTable', () => {
  it('exports a list of records, and the first list of records inside an object', () => {
    expect(
      exportTable([
        { a: 1, b: 'x' },
        { a: 2, b: null },
      ]),
    ).toEqual({
      headers: ['a', 'b'],
      rows: [
        [1, 'x'],
        [2, null],
      ],
    });
    expect(exportTable({ total: 5, rows: [{ k: 'v' }] })?.headers).toEqual(['k']);
  });

  it('leaves out nested values instead of printing [object Object]', () => {
    const t = exportTable([{ a: 1, nested: { x: 1 }, list: [1, 2] }]);
    expect(t?.headers).toEqual(['a']);
  });

  it('has no table for a bare number, an empty list, or a list of non-records', () => {
    expect(exportTable(5)).toBeNull();
    expect(exportTable([])).toBeNull();
    expect(exportTable([1, 2, 3])).toBeNull();
    expect(exportTable({ total: 5 })).toBeNull();
    expect(exportTable([{ nested: { x: 1 } }])).toBeNull();
    expect(exportTable(null)).toBeNull();
  });

  it('keeps a boolean as text', () => {
    expect(exportTable([{ ok: true }])?.rows).toEqual([['true']]);
  });
});
