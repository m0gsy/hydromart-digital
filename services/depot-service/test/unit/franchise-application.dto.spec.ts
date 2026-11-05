import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FranchiseAppStage } from '../../src/domain/franchise-application';
import { PatchApplicationDto } from '../../src/modules/dto/franchise-application.dto';

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
