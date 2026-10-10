// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/hr/me/check-in' }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/hr/hr-rail', () => ({ HrRail: () => null }));
vi.mock('@/components/hr/hr-bottom-nav', () => ({ HrBottomNav: () => null }));
vi.mock('@/components/hq/access-denied', () => ({ AccessDeniedHq: () => null }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'STAFF_DEPOT' } }) }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn().mockResolvedValue([]) } }));

import HrLayout from '@/app/hr/layout';
import { useDepot } from '@/lib/depot-context';

function Probe() {
  useDepot(); // throws outside <DepotProvider>
  return <p>punch page</p>;
}

describe('/hr/me layout', () => {
  it('gives the self-service pages a DepotProvider (check-in names today\'s depot)', () => {
    render(
      <HrLayout>
        <Probe />
      </HrLayout>,
    );
    expect(screen.getByText('punch page')).toBeTruthy();
  });
});
