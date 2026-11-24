import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FranchiseApplicationSubmittedDto } from '../../src/modules/dto/notification.dto';

// A place name goes into an email sent from our own address: letters and . , ' ( ) - only, never a link.
describe('FranchiseApplicationSubmittedDto place names', () => {
  const base = {
    eventId: 'franchise.application_submitted:3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
    applicationId: '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
    city: 'Bekasi',
    province: 'Jawa Barat',
  };
  const refusedFields = async (over: Record<string, unknown>) =>
    (await validate(plainToInstance(FranchiseApplicationSubmittedDto, { ...base, ...over }))).map((e) => e.property);
  it.each(['Bandung', 'Kab. Bekasi', 'Jawa Barat', 'D.I. Yogyakarta', 'Bau-Bau', 'Tanjung Pinang (Kepri)', 'Ma’rang', 'Sumatera Utara'])('accepts %s as city and province', async (place) => {
    expect(await refusedFields({ city: place, province: place })).toEqual([]);
  });
  it.each(['evil.com', 'x.co.id', 'bit.ly', 'a@b', 'http://x', 'Bandung 2', '<b>Bandung</b>', '...', '   ', ''])('refuses "%s" as city and province', async (place) => {
    expect((await refusedFields({ city: place, province: place })).sort()).toEqual(['city', 'province']);
  });

  // Lookalikes of a web address that a plain ASCII check would miss.
  it.each([
    ['a Cyrillic o', `evil.c${String.fromCodePoint(0x43e)}m`],
    ['fullwidth letters and stop', String.fromCodePoint(0xff45, 0xff56, 0xff49, 0xff4c, 0xff0e, 0xff43, 0xff4f, 0xff4d)],
    ['an ideographic full stop', `evil${String.fromCodePoint(0x3002)}com`],
    ['a combining mark after the dot', `evil.${String.fromCodePoint(0x301)}com`],
  ])('refuses %s in a web address', async (_name, place) => {
    expect((await refusedFields({ city: place, province: place })).sort()).toEqual(['city', 'province']);
  });
});
