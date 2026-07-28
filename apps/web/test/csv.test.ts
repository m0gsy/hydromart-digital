import { describe, expect, it } from 'vitest';

import { detectDelimiter, parseCsv, parseCsvRecords, toCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('splits a plain LF document into cells', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas and newlines inside a quoted cell', () => {
    expect(parseCsv('name,address\nBudi,"Jl. Melati 3, RT 04\nBekasi"')).toEqual([
      ['name', 'address'],
      ['Budi', 'Jl. Melati 3, RT 04\nBekasi'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('note\n"depot ""utara"" lantai 2"')).toEqual([
      ['note'],
      ['depot "utara" lantai 2'],
    ]);
  });

  it('strips a UTF-8 BOM written by Excel', () => {
    expect(parseCsv('﻿fullName,phone\nBudi,0812')).toEqual([
      ['fullName', 'phone'],
      ['Budi', '0812'],
    ]);
  });

  it('drops blank lines instead of emitting empty rows', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
  });

  it('keeps empty cells within a populated row', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('ends the last row without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('returns nothing for an empty document', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('treats a lone CR as a row break', () => {
    expect(parseCsv('a\r1')).toEqual([['a'], ['1']]);
  });
});

describe('parseCsvRecords', () => {
  it('keys values by the trimmed header row and trims values', () => {
    expect(parseCsvRecords('fullName , phone\n Budi , 0812 ')).toEqual([
      { fullName: 'Budi', phone: '0812' },
    ]);
  });

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsvRecords('a,b,c\n1')).toEqual([{ a: '1', b: '', c: '' }]);
  });

  it('returns an empty list when there is no header', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('joins with CRLF and quotes only what needs it', () => {
    expect(toCsv(['a', 'b'], [['plain', 'has,comma']])).toBe('a,b\r\nplain,"has,comma"');
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
  });

  it('doubles embedded quotes', () => {
    expect(toCsv(['a'], [['say "hi"']])).toBe('a\r\n"say ""hi"""');
  });
});

describe('detectDelimiter', () => {
  it('defaults to a comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('picks the semicolon Excel writes on an Indonesian locale', () => {
    expect(detectDelimiter('fullName;phone;depotCode\nBudi;0812;JKT-01')).toBe(';');
  });

  it('picks tab for a pasted-from-Excel file', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it('ignores separators inside a quoted header', () => {
    expect(detectDelimiter('"nama, lengkap";phone')).toBe(';');
  });

  it('survives an empty document', () => {
    expect(detectDelimiter('')).toBe(',');
  });
});

describe('parseCsv with a detected separator', () => {
  it('splits a semicolon file into real columns', () => {
    expect(parseCsv('fullName;phone\nBudi;0812')).toEqual([
      ['fullName', 'phone'],
      ['Budi', '0812'],
    ]);
  });

  it('keeps a comma inside a cell when the separator is a semicolon', () => {
    expect(parseCsv('name;address\nBudi;"Jl. Melati 3, RT 04"')).toEqual([
      ['name', 'address'],
      ['Budi', 'Jl. Melati 3, RT 04'],
    ]);
  });

  it('honours an explicitly passed separator', () => {
    expect(parseCsv('a;b', ',')).toEqual([['a;b']]);
  });
});
