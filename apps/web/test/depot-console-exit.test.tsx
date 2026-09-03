// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-61: the depot console had no way out for almost everybody in it.
 *
 * Its only exit was the `/dashboard/profile` link in the rail, and that link is gated
 * `canUseManagerConsole` — MANAGER or SUPER_ADMIN, two of the twelve roles. A supervisor,
 * an assistant supervisor, head office, the director, finance, HR, marketing, a franchise
 * owner and a depot head all land in this console, and none of them could end their
 * session from it. On a phone it was worse still: the rail is `hidden lg:flex`, so even a
 * manager had nothing.
 *
 * The other three consoles were fine and are deliberately not touched — the courier's tab
 * bar carries `/driver/profile`, the mobile manager's carries `/m/manager/account` and the
 * operator's carries `/dashboard/operator-settings`, and all three of those screens sign
 * out. This is about the one shell that had nothing.
 */
let role = 'SUPERVISOR';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [],
    selectedId: null,
    selected: null,
    scopedId: null,
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';

describe('depot console exit (CA-2-61)', () => {
  beforeEach(() => {
    role = 'SUPERVISOR';
  });

  it.each(['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'HEAD_OFFICE', 'FINANCE', 'MANAGER'])(
    'gives %s a way to sign out on a phone',
    (r) => {
      role = r;
      const { unmount } = render(<OpsBottomNav />);
      fireEvent.click(screen.getByRole('button', { name: /Lainnya/ }));
      expect(screen.getByRole('button', { name: /signOut/i })).toBeTruthy();
      unmount();
    },
  );
});
