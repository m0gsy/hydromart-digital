import { SecurityPolicyService } from '../../src/application/services/security-policy.service';
import { InMemorySecurityPolicyRepository } from '../support/fakes';

describe('SecurityPolicyService', () => {
  let repo: InMemorySecurityPolicyRepository;
  let service: SecurityPolicyService;

  beforeEach(() => {
    repo = new InMemorySecurityPolicyRepository();
    service = new SecurityPolicyService(repo);
  });

  it('returns platform defaults before anything is saved', async () => {
    const p = await service.get();
    expect(p).toMatchObject({ idleTimeoutMinutes: 15, require2fa: true, ipAllowlist: [] });
  });

  it('saves and reads back the policy', async () => {
    await service.save({ idleTimeoutMinutes: 30, require2fa: false, ipAllowlist: ['103.21.0.0/16'] });
    const p = await service.get();
    expect(p).toMatchObject({ idleTimeoutMinutes: 30, require2fa: false, ipAllowlist: ['103.21.0.0/16'] });
  });
});
