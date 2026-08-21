// @vitest-environment jsdom
/**
 * I5 · the customer had no screen for their own deposit.
 *
 * "Berapa galon yang saya pegang" and "berapa deposit saya yang masih di depot" both
 * already existed as data — and were rendered only in the depot staff console. The person
 * whose money it is could not see either number anywhere in the app.
 *
 * The distinction this pins is `null` vs `[]`. `null` means depot-service could not be
 * read; printing "you are holding nothing" there would be a deposit quietly disappearing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';
import { GallonDepositCard } from '@/components/gallon-deposit-card';

const answer = (deposits: unknown) => async (path: string) =>
  path === endpoints.profile.gallonDeposit ? deposits : null;

beforeEach(() => get.mockReset());
afterEach(() => vi.clearAllMocks());

describe('I5 · the customer can see their own gallon deposit', () => {
  it('names each depot, the gallons held and the rupiah still on deposit', async () => {
    get.mockImplementation(
      answer([
        { depotId: 'd1', depotName: 'Depot Cikini', gallonsOnLoan: 2, depositHeldIdr: 40000 },
      ]),
    );
    render(<GallonDepositCard />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getByText('Depot Cikini')).toBeTruthy());
    expect(screen.getByText(/2 galon dipegang/)).toBeTruthy();
    expect(screen.getByText(/Rp\s?40\.000/)).toBeTruthy();
  });

  // Two different answers that must not look the same.
  it('says "not connected" when the ledger cannot be read, never "you hold nothing"', async () => {
    get.mockImplementation(answer(null));
    render(<GallonDepositCard />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getByText(/Belum tersambung/)).toBeTruthy());
    expect(screen.queryByText(/Belum ada galon yang Anda pegang/)).toBeNull();
  });

  it('says "you hold nothing" only when the ledger really answered empty', async () => {
    get.mockImplementation(answer([]));
    render(<GallonDepositCard />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getByText(/Belum ada galon yang Anda pegang/)).toBeTruthy());
    expect(screen.queryByText(/Belum tersambung/)).toBeNull();
  });
});
