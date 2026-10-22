import { validate } from 'class-validator';

import { IsRoleKey } from '../../src/common/validators/is-role-key';

class Probe {
  @IsRoleKey()
  role: unknown;
}

const check = async (role: unknown): Promise<number> => {
  const p = new Probe();
  p.role = role;
  return (await validate(p)).length;
};

describe('IsRoleKey', () => {
  it.each(['CUSTOMER', 'SUPER_ADMIN', 'C_kasir', 'C_a_b_9'])('accepts %s', async (r) =>
    expect(await check(r)).toBe(0),
  );

  it.each(['', 'c_kasir', 'C_', 'C_Kasir', 'C_' + 'a'.repeat(41), 'WIZARD', 'C_a b', 5, null, undefined])(
    'rejects %p',
    async (r) => expect(await check(r)).toBe(1),
  );
});
