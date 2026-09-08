// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

// The network and the native-only token vault are not what these tests are about; what is,
// is what `signOut` leaves behind on the device.
vi.mock('@/lib/api', () => ({
  api: {
    post,
    get: vi.fn().mockResolvedValue(null),
    getCached: vi.fn().mockResolvedValue(null),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/push', () => ({ unsubscribeFromPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/token-store', () => ({
  clearTokens: vi.fn(),
  getRefreshToken: () => null,
  hasTokens: () => false,
  // Awaited on mount before anything may reach the API, so it has to be a promise.
  unlockTokens: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Four things the account area kept, said, or failed to say.
 *
 *  - CA-3-56: the notifications "last seen" marker is keyed to the DEVICE, not the person,
 *    and was never cleared. The next account signed in on a shared handset found every row
 *    already older than the previous person's last visit — their notifications existed and
 *    the badge said nothing.
 *  - CA-3-59: the delivery location — a lat/lng and a place name — survived sign-out too,
 *    so the next person to open the app was shown, and would have ordered to, where the
 *    last one lives.
 *  - CA-3-57: the devices list marked nothing as "this device", so the dangerous row and
 *    the harmless one looked identical to somebody deciding which session to revoke.
 *  - CA-3-58: the delete-account page named menus that do not exist in the app.
 */

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LAST_SEEN_KEY, forgetNotificationsSeen, markNotificationsSeen } from '@/lib/unread';
import {
  currentSessionFamily,
  forgetSessionFamily,
  rememberSessionFamily,
} from '@/lib/session-device';
import { getLocation, setLocation } from '@/lib/location-store';
import { id } from '@/lib/dictionaries/id';
import { en } from '@/lib/dictionaries/en';
import { deleteAccount as deleteAccountId } from '@/lib/dictionaries/id/deleteAccount';
import { deleteAccount as deleteAccountEn } from '@/lib/dictionaries/en/deleteAccount';

beforeEach(() => {
  localStorage.clear();
  post.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('CA-3-56 the read marker belongs to a person, not a handset', () => {
  it('is forgotten, so the next account does not inherit a read inbox', () => {
    markNotificationsSeen('2026-09-08T00:00:00.000Z');
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('2026-09-08T00:00:00.000Z');

    forgetNotificationsSeen();
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
  });

  it('survives storage being unavailable rather than breaking sign-out', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => forgetNotificationsSeen()).not.toThrow();
    removeItem.mockRestore();
  });
});

describe('CA-3-59 the delivery location does not stay behind', () => {
  it('clears to null, and clears the stored copy with it', () => {
    setLocation({ label: 'Jl. Melati', lat: -6.2, lng: 106.8 });
    expect(getLocation()?.label).toBe('Jl. Melati');

    setLocation(null);
    expect(getLocation()).toBeNull();
    // The stored copy matters as much as the in-memory one: it is what a reload reads.
    expect(localStorage.getItem('hm.location')).toBeNull();
  });
});

describe('CA-3-57 which session is the one you are holding', () => {
  it('remembers the rotation family and gives it back', () => {
    rememberSessionFamily('fam-1');
    expect(currentSessionFamily()).toBe('fam-1');
  });

  it('marks nothing rather than the wrong row when the server sent no family', () => {
    // An older gateway build answers without `familyId`. Marking a row on a guess would be
    // worse than marking none: the person is deciding which session to revoke.
    rememberSessionFamily(undefined);
    expect(currentSessionFamily()).toBeNull();
  });

  it('is forgotten at sign-out, so the next account is not told a stranger row is theirs', () => {
    rememberSessionFamily('fam-1');
    forgetSessionFamily();
    expect(currentSessionFamily()).toBeNull();
  });
});

describe('CA-3-58 the delete-account steps name what is on screen', () => {
  /*
   * These strings are the only instructions anybody gets for exercising a legal right, and
   * they pointed at "Data & privasi" / "Hapus akun" / "Unduh data" — three labels that
   * appear nowhere in the app. Asserted against the live dictionary rather than against a
   * copy of the words, so renaming a sheet reddens this instead of stranding the steps.
   */
  const sheet = id.account.privacyData;

  const inAppStep = (d: typeof deleteAccountId) => d.steps[0] ?? '';

  it('names the sheet exactly as the account screen labels it', () => {
    expect(inAppStep(deleteAccountId)).toContain(sheet.title);
    expect(inAppStep(deleteAccountEn)).toContain(en.account.privacyData.title);
  });

  it('names the two controls exactly as the sheet labels them', () => {
    expect(inAppStep(deleteAccountId)).toContain(sheet.requestDelete);
    const exportStep = deleteAccountId.sections.find((sec) =>
      sec.body.includes(sheet.requestExport),
    );
    expect(exportStep).toBeTruthy();
  });

  it('no longer sends anybody looking for menus that do not exist', () => {
    const everything = [
      ...deleteAccountId.steps,
      ...deleteAccountId.sections.map((sec) => sec.body),
    ].join(' ');
    for (const ghost of ['Data & privasi', 'Unduh data']) {
      expect(everything).not.toContain(ghost);
    }
  });
});


/*
 * The one place all three device-local stores are actually cleared. Testing the stores on
 * their own proves they CAN forget; this proves that signing out is what makes them.
 */
function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={signOut}>
      keluar
    </button>
  );
}

describe('signing out leaves nothing of the last person behind', () => {
  it('clears the read marker, the delivery location and the session family', async () => {
    markNotificationsSeen('2026-09-08T00:00:00.000Z');
    setLocation({ label: 'Jl. Melati', lat: -6.2, lng: 106.8 });
    rememberSessionFamily('fam-1');

    render(
      <AuthProvider>
        <SignOutButton />
      </AuthProvider>,
    );
    await act(async () => {
      await userEvent.click(screen.getByText('keluar'));
    });

    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
    // A location is the sharpest of the three: it says where the last person lives, on a
    // device they have walked away from.
    expect(getLocation()).toBeNull();
    expect(currentSessionFamily()).toBeNull();
  });
});
