import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateNotificationsDto } from '../../src/modules/dto/profile.dto';

/**
 * K5.3. `locale` selects a template table in another service. A free-text column would
 * either fall back to Indonesian forever for a typo nobody sees, or index into nothing —
 * so the whitelist is the validation, not a convention.
 */
describe('UpdateNotificationsDto · locale', () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateNotificationsDto, body))).map((e) => e.property);

  it.each(['id', 'en'])('accepts %s', async (locale) => {
    expect(await errors({ locale })).toEqual([]);
  });

  it.each(['jv', 'EN', '', 'id-ID'])('rejects %s', async (locale) => {
    expect(await errors({ locale })).toContain('locale');
  });

  it('stays optional — a channel toggle sends no language at all', async () => {
    expect(await errors({ push: false })).toEqual([]);
  });
});
