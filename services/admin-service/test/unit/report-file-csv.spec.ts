import { csvCell } from '../../src/domain/report-file';

// AAS-07: the formula-injection guard prefixed an apostrophe to ANY value starting with "-",
// numbers included, so every negative figure in a scheduled report became the text '-5.
describe('csvCell', () => {
  it('leaves negative numbers as numbers', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0)).toBe('0');
  });

  it('still neutralises formula-looking TEXT', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=CMD')).toBe("'\t=CMD");
  });

  it('quotes cells holding commas, quotes or newlines', () => {
    expect(csvCell('Depot "Baru", Cibubur')).toBe('"Depot ""Baru"", Cibubur"');
  });
});
