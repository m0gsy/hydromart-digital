import { toCsv } from '../../src/domain/csv';

describe('toCsv', () => {
  it('joins headers + rows with CRLF', () => {
    const out = toCsv(['a', 'b'], [
      [1, 2],
      [3, 4],
    ]);
    expect(out).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes cells with commas, quotes, or newlines and doubles embedded quotes', () => {
    const out = toCsv(['name', 'note'], [['Doe, John', 'says "hi"'], ['multi\nline', 'ok']]);
    expect(out).toBe('name,note\r\n"Doe, John","says ""hi"""\r\n"multi\nline",ok');
  });

  it('renders null/undefined as empty and leaves plain values unquoted', () => {
    expect(toCsv(['x', 'y', 'z'], [['plain', null, undefined]])).toBe('x,y,z\r\nplain,,');
  });
});
