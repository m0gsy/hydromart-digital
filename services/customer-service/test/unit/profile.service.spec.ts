import { ProfileService } from '../../src/application/services/profile.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { MembershipTier } from '../../src/domain/membership-tier.enum';
import {
  InMemoryNotificationRepository,
  InMemoryProfileRepository,
} from '../support/fakes';

describe('ProfileService', () => {
  let repo: InMemoryProfileRepository;
  let service: ProfileService;

  beforeEach(() => {
    repo = new InMemoryProfileRepository();
    service = new ProfileService(repo);
  });

  it('lazily creates a default BASIC profile on first read', async () => {
    const p = await service.get('cust-1');
    expect(p.membershipTier).toBe(MembershipTier.BASIC);
    expect(p.pointBalance).toBe(0);
    expect(p.favoriteDepotId).toBeNull();
  });

  it('sets the favorite depot', async () => {
    const p = await service.setFavoriteDepot('cust-1', 'depot-9');
    expect(p.favoriteDepotId).toBe('depot-9');
    const cleared = await service.setFavoriteDepot('cust-1', null);
    expect(cleared.favoriteDepotId).toBeNull();
  });
});

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService(new InMemoryNotificationRepository());
  });

  it('defaults to all channels on', async () => {
    const prefs = await service.get('cust-1');
    expect(prefs).toMatchObject({ push: true, email: true, whatsapp: true });
  });

  it('updates only the provided channels', async () => {
    await service.update('cust-1', { whatsapp: false });
    const prefs = await service.get('cust-1');
    expect(prefs).toMatchObject({ push: true, email: true, whatsapp: false });
  });
});
