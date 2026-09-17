import { phoneVariants } from '../../src/domain/phone-variants';

// CRM-8: the same person is stored as 0812…, 62812… and +62812…; erasure must hit all three.
describe('phoneVariants', () => {
  it.each(['081234567890', '6281234567890', '+62 812-3456-7890'])('spells %s every way', (phone) => {
    expect(phoneVariants(phone)).toEqual(
      expect.arrayContaining(['081234567890', '6281234567890', '+6281234567890']),
    );
  });

  it('matches anything unrecognisable exactly as given, and only that way', () => {
    expect(phoneVariants('12345')).toEqual(['12345']);
    expect(phoneVariants('+1 555 0100')).toEqual(['+1 555 0100']);
  });
});
