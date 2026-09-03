// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, post, uploadFile } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, patch, post },
  uploadFile,
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c-1', fullName: 'Wahyu', email: null, phone: '0811', avatarUrl: null },
    session: { accessToken: 't', customer: { id: 'c-1' } },
    ready: true,
    signIn: vi.fn(),
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/account/edit',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import EditProfilePage from '@/app/account/edit/page';

const renderPage = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <EditProfilePage />
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset().mockResolvedValue({ customerId: 'c-1', favoriteDepotId: null, birthdate: null });
  patch
    .mockReset()
    .mockResolvedValue({ customerId: 'c-1', favoriteDepotId: null, birthdate: '1990-05-17' });
  post.mockReset().mockResolvedValue({});
  uploadFile.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H16. The birthday reward is built end to end on the server: a `birthdate` column, a
 * `PATCH /profile` that sets it, a `lastBirthdayRewardYear` guard, configurable points and
 * a daily sweep that grants them. And it can never fire, because NO SCREEN HAS EVER ASKED
 * FOR A DATE OF BIRTH. Production on 22 Aug 2026: 4 profiles, 0 with a birthdate.
 *
 * The field belongs on /account/edit — the screen that already owns name, email and photo
 * — and it is optional, because a date of birth is personal data the customer is entitled
 * to withhold. The deletion page already promises "Tanggal lahir dihapus", so the promise
 * predates the field that would have made it meaningful.
 */
describe('H16 — the birthday nobody could ever tell us', () => {
  it('asks for a date of birth, optionally', async () => {
    renderPage();
    const field = await screen.findByLabelText(/tanggal lahir|date of birth/i);
    expect(field).toHaveAttribute('type', 'date');
    expect(field).not.toBeRequired();
  });

  it('shows back the date already on file', async () => {
    get.mockResolvedValue({ customerId: 'c-1', favoriteDepotId: null, birthdate: '1990-05-17' });
    renderPage();
    await waitFor(async () =>
      expect(await screen.findByLabelText(/tanggal lahir|date of birth/i)).toHaveValue(
        '1990-05-17',
      ),
    );
  });

  it('saves it to the profile endpoint the sweep actually reads', async () => {
    renderPage();
    const field = await screen.findByLabelText(/tanggal lahir|date of birth/i);
    await userEvent.type(field, '1990-05-17');
    await userEvent.click(screen.getByRole('button', { name: /simpan|save/i }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls.find((c) => String(c[0]).includes('/profile'));
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({ birthdate: '1990-05-17' });
  });

  it('clears it to null rather than sending an empty string', async () => {
    get.mockResolvedValue({ customerId: 'c-1', favoriteDepotId: null, birthdate: '1990-05-17' });
    renderPage();
    const field = await screen.findByLabelText(/tanggal lahir|date of birth/i);
    await waitFor(() => expect(field).toHaveValue('1990-05-17'));
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: /simpan|save/i }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls.find((c) => String(c[0]).includes('/profile'));
    expect(call?.[1]).toMatchObject({ birthdate: null });
  });
});
