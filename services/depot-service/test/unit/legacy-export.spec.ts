import { FranchiseApplicationService } from '../../src/application/services/franchise-application.service';
import { OPEN_STAGES, toE164 } from '../../src/domain/franchise-application';
import { FranchiseApplicationPrismaRepository } from '../../src/infrastructure/prisma/franchise-application.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('toE164', () => {
  it.each([
    ['081234567890', '+6281234567890'],
    ['+62 812-3456-7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['(0812) 3456 7890', '+6281234567890'],
    ['02112345678', '+622112345678'],
  ])('reads %s as %s', (raw, want) => expect(toE164(raw)).toBe(want));

  it.each([['12345'], [''], ['abc'], ['0'], ['0812'], ['+1 202 555 0100'], ['0000000000'], ['08123456789012345']])(
    'cannot read %s: null, never a guess',
    (raw) => expect(toE164(raw)).toBeNull(),
  );
});

const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  applicantName: 'Calon Contoh Satu',
  applicantPhone: '081200000001',
  proposedCode: 'XXX-01',
  proposedName: 'Depot Contoh',
  city: 'Bekasi',
  province: 'Jawa Barat',
  lat: -6.2,
  lng: 107,
  investmentAmount: 150_000_000,
  projectedMonthlyRevenue: 99,
  checklist: { ktpNpwp: 'VERIFIED' },
  stage: 'PENDING',
  decisionReason: null,
  firstSource: 'ig',
  lastSource: 'wa',
  privacyConsentVersion: '2026-11-24',
  submittedAt: new Date('2026-11-01T03:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('FranchiseApplicationService.openForCrm (HD-21 section 5)', () => {
  it('answers exactly the contract fields, with the phone in E.164 or null, and nothing else', async () => {
    const listOpen = jest.fn(async () => [
      row(),
      row({ id: 'b', stage: 'SURVEY', applicantPhone: 'tidak ada', proposedName: '', investmentAmount: Number.NaN, firstSource: null, privacyConsentVersion: null }),
    ]);
    const service = new FranchiseApplicationService({ listOpen } as never, {} as never, {} as never);
    const { applications } = await service.openForCrm();
    expect(listOpen).toHaveBeenCalledWith(2000);
    expect(applications[0]).toEqual({
      id: '00000000-0000-4000-8000-0000000000a1',
      stage: 'PENDING',
      applicantName: 'Calon Contoh Satu',
      applicantPhoneE164: '+6281200000001',
      city: 'Bekasi',
      province: 'Jawa Barat',
      proposedName: 'Depot Contoh',
      investmentAmountIdr: 150_000_000,
      firstSource: 'ig',
      privacyConsentVersion: '2026-11-24',
      submittedAt: '2026-11-01T03:00:00.000Z',
    });
    expect(applications[1]).toMatchObject({ stage: 'SURVEY', applicantPhoneE164: null, proposedName: null, investmentAmountIdr: null, firstSource: null, privacyConsentVersion: null });
    // No GPS pin, no checklist, no revenue, no internal code or decision.
    expect(Object.keys(applications[0]!).sort()).toEqual(
      ['applicantName', 'applicantPhoneE164', 'city', 'firstSource', 'id', 'investmentAmountIdr', 'privacyConsentVersion', 'proposedName', 'province', 'stage', 'submittedAt'],
    );
  });
});

describe('FranchiseApplicationPrismaRepository.listOpen', () => {
  it('reads only the open stages, oldest first, capped', async () => {
    const findMany = jest.fn(async () => [row()]);
    const repo = new FranchiseApplicationPrismaRepository({ franchiseApplication: { findMany } } as unknown as PrismaService);
    const rows = await repo.listOpen(50);
    expect(rows[0]).toMatchObject({ id: '00000000-0000-4000-8000-0000000000a1', investmentAmount: 150_000_000 });
    expect(findMany).toHaveBeenCalledWith({
      where: { stage: { in: ['PENDING', 'DOC_VERIFICATION', 'SURVEY'] } },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    expect([...OPEN_STAGES]).not.toContain('APPROVED');
    expect([...OPEN_STAGES]).not.toContain('REJECTED');
  });
});
