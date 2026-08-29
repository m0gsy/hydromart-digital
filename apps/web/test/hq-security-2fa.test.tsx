// @vitest-environment jsdom
//
// W10c. `/hq/security` shipped a "Wajib 2FA" switch, defaulted ON, whose body text told the
// only person allowed to change it: "Semua akun HQ harus verifikasi OTP saat masuk."
//
// Measured across the repo: `require2fa` is written by this page, stored by admin-service,
// and read by NOTHING. `SecurityPolicy` never leaves admin-service — the only other hit in
// `services/` is `contentSecurityPolicy` in the gateway, an unrelated string. And the
// platform has no second factor to require in the first place: there is no password
// anywhere in auth-service (`phone-change.service.ts`: "there is no password"), so phone +
// OTP is the whole credential. OTP is factor ONE here, not factor two.
//
// So the switch promised a security control that cannot exist, to the one account with the
// authority to rely on it. It is gone. Two things this has to get right:
//
//   1. no switch, and none of its copy — an "off" switch would be the same lie inverted.
//   2. the stored value still round-trips. `SaveSecurityPolicyDto.require2fa` is a REQUIRED
//      boolean; dropping it from the PUT body turns every save into a 400.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, put, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

const POLICY = {
  idleTimeoutMinutes: 15,
  require2fa: true,
  ipAllowlist: ['103.21.0.0/16'],
  updatedAt: new Date(0).toISOString(),
};

vi.mock('@/lib/api', () => ({
  api: { get, put, post },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/security',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqSecurityPage from '@/app/hq/security/page';

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({});
  put.mockReset().mockImplementation((_p: string, body: unknown) =>
    Promise.resolve({ ...POLICY, ...(body as object) }),
  );
  get.mockReset().mockImplementation((path: string) =>
    String(path).includes('/sessions') ? Promise.resolve([]) : Promise.resolve(POLICY),
  );
});

afterEach(() => vi.clearAllMocks());

const open = () => {
  const user = userEvent.setup();
  render(<HqSecurityPage />, { wrapper: LocaleProvider });
  return user;
};

describe('/hq/security · the 2FA switch nothing enforced (W10c)', () => {
  it('offers no "require 2FA" control, because there is no second factor to require', async () => {
    open();
    // The page has rendered: its other, real control is on screen.
    expect(await screen.findByLabelText('Sesi berakhir otomatis')).toBeTruthy();

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Wajib 2FA')).toBeNull();
    expect(screen.queryByText('Semua akun HQ harus verifikasi OTP saat masuk.')).toBeNull();
  });

  it('still round-trips the stored require2fa, so a save is not a 400', async () => {
    const user = open();
    const idle = await screen.findByLabelText('Sesi berakhir otomatis');
    await user.clear(idle);
    await user.type(idle, '30');
    await user.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toEqual({
      idleTimeoutMinutes: 30,
      require2fa: true, // untouched server value, not a UI default
      ipAllowlist: ['103.21.0.0/16'],
    });
  });

  it('keeps the controls that are still editable', async () => {
    open();
    expect(await screen.findByLabelText('IP allowlist')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simpan pengaturan' })).toBeTruthy();
  });
});
