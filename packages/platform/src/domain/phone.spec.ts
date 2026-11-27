import { normalizeIdPhone } from './phone';

describe('normalizeIdPhone', () => {
  it.each([
    ['08123456789', '+628123456789', true],
    ['628123456789', '+628123456789', true],
    ['+628123456789', '+628123456789', true],
    ['0812-3456-789', '+628123456789', true],
    ['(021) 5551234', '+62215551234', false],
  ])('reads %s', (raw, e164, mobile) => {
    expect(normalizeIdPhone(raw)).toEqual({ e164, mobile });
  });

  it.each(['', 'abc', '0', '0812', '00812345678', '8123456789', '+1 202 555 0100', null, undefined, 12345, '081234567890123456'])(
    'refuses %p',
    (raw) => {
      expect(normalizeIdPhone(raw)).toBeNull();
    },
  );
});
