import { PhoneNumber } from '../../src/domain/value-objects/phone-number';
import { InvalidPhoneNumberError } from '../../src/domain/errors/auth.errors';

describe('PhoneNumber', () => {
  it.each([
    ['081234567890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['+6281234567890', '+6281234567890'],
    ['8123456789', '+628123456789'],
    ['0812-3456-7890', '+6281234567890'],
    ['0812 3456 7890', '+6281234567890'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(PhoneNumber.create(input).value).toBe(expected);
  });

  it.each(['12345', '02112345678', '+1202555010', 'not-a-phone', '+6271234567', ''])(
    'rejects invalid number %s',
    (input) => {
      expect(() => PhoneNumber.create(input)).toThrow(InvalidPhoneNumberError);
    },
  );

  it('rejects non-string input', () => {
    expect(() => PhoneNumber.create(undefined as unknown as string)).toThrow(
      InvalidPhoneNumberError,
    );
  });

  it('supports value equality', () => {
    const a = PhoneNumber.create('081234567890');
    const b = PhoneNumber.create('+6281234567890');
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe('+6281234567890');
  });
});
