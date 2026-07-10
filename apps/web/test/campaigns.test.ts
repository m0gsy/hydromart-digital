import { describe, expect, it } from 'vitest';

import { parseRecipients } from '@/lib/campaigns';

describe('parseRecipients', () => {
  it('parses phone-only and phone,name lines, skipping blanks', () => {
    const text = '  +6281234567890  \n\n081111111111,Andi\n';
    expect(parseRecipients(text)).toEqual([
      { phone: '+6281234567890' },
      { phone: '081111111111', name: 'Andi' },
    ]);
  });

  it('folds extra commas into the name and drops empty trailing name', () => {
    expect(parseRecipients('0812,Andi, Jr\n0813,')).toEqual([
      { phone: '0812', name: 'Andi, Jr' },
      { phone: '0813' },
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseRecipients('   \n\n')).toEqual([]);
  });
});
