import { OnboardingStateService } from '../../src/application/services/onboarding-state.service';
import { InMemoryOnboardingStateRepository } from '../support/fakes';

describe('OnboardingStateService', () => {
  let repo: InMemoryOnboardingStateRepository;
  let service: OnboardingStateService;

  beforeEach(() => {
    repo = new InMemoryOnboardingStateRepository();
    service = new OnboardingStateService(repo);
  });

  it('returns all-incomplete before anything is saved', async () => {
    const s = await service.get();
    expect(s).toMatchObject({
      verify2fa: false,
      addDepot: false,
      inviteHeadOffice: false,
      setPricingTax: false,
      enablePayments: false,
    });
  });

  it('marks one step done and leaves the rest untouched', async () => {
    await service.setStep('addDepot', true);
    const s = await service.get();
    expect(s.addDepot).toBe(true);
    expect(s.verify2fa).toBe(false);
  });

  it('can toggle a step back to undone', async () => {
    await service.setStep('addDepot', true);
    await service.setStep('addDepot', false);
    expect((await service.get()).addDepot).toBe(false);
  });
});
