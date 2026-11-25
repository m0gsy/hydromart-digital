import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FranchiseAppStage } from '../../src/domain/franchise-application';
import {
  ApplicationSummaryQueryDto,
  PatchApplicationDto,
  SubmitFranchiseApplicationDto,
} from '../../src/modules/dto/franchise-application.dto';

// F2: PATCH is the checklist/stage-progress edit. APPROVED/REJECTED have their own routes
// (approve/reject) that record the actor, the reason and the audit event — a PATCH that
// could set them skipped all of that.
describe('PatchApplicationDto', () => {
  it.each([FranchiseAppStage.APPROVED, FranchiseAppStage.REJECTED])(
    'refuses the terminal stage %s',
    async (stage) => {
      const errors = await validate(plainToInstance(PatchApplicationDto, { stage }));
      expect(errors.map((e) => e.property)).toEqual(['stage']);
    },
  );

  it.each([
    FranchiseAppStage.PENDING,
    FranchiseAppStage.DOC_VERIFICATION,
    FranchiseAppStage.SURVEY,
  ])('accepts the in-progress stage %s', async (stage) => {
    expect(await validate(plainToInstance(PatchApplicationDto, { stage }))).toHaveLength(0);
  });

  it('accepts a checklist-only patch', async () => {
    expect(
      await validate(plainToInstance(PatchApplicationDto, { checklist: { ktpNpwp: 'VERIFIED' } })),
    ).toHaveLength(0);
  });
});

// A place name goes into an email sent from our own address: letters and . , ' ( ) - only, never a link.
describe('SubmitFranchiseApplicationDto place names', () => {
  const base = {
    applicantName: 'Budi',
    applicantPhone: '+628123456789',
    proposedCode: 'BDG-02',
    proposedName: 'Depot Buah Batu',
    city: 'Bandung',
    province: 'Jawa Barat',
    lat: -6.9,
    lng: 107.6,
    investmentAmount: 1,
    projectedMonthlyRevenue: 1,
    privacyConsent: true,
  };
  const refusedFields = async (over: Record<string, unknown>) =>
    (await validate(plainToInstance(SubmitFranchiseApplicationDto, { ...base, ...over }))).map((e) => e.property);
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

describe('ApplicationSummaryQueryDto (HD-6 H5)', () => {
  const check = (body: object) => validate(plainToInstance(ApplicationSummaryQueryDto, body));
  it('takes an ordered window of at most a leap year, and refuses the rest', async () => {
    expect(await check({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' })).toHaveLength(0);
    expect(await check({ from: '2026-12-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })).not.toHaveLength(0);
    expect(await check({ from: '2020-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })).not.toHaveLength(0);
    expect(await check({ from: 'x' })).not.toHaveLength(0);
    // a real calendar date: 2026-02-31 is a 400, not a 500 from the database
    expect(await check({ from: '2026-02-31T00:00:00Z', to: '2026-03-31T00:00:00Z' })).not.toHaveLength(0);
    expect(await check({ from: '2026-02-01T00:00:00Z', to: '2026-02-30T00:00:00Z' })).not.toHaveLength(0);
  });
});
