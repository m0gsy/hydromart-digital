// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, replace } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), replace: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, patch } };
});
vi.mock('@/lib/session-store', () => ({
  getSession: () => ({ customer: { id: 'drv-1' } }),
  setSession: () => {},
  subscribe: () => () => {},
}));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'del-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/deliveries/detail/fail',
  useSearchParams: () => new URLSearchParams('id=del-1'),
}));

import FailPage from '@/app/driver/deliveries/detail/fail/page';
import ReschedulePage from '@/app/driver/deliveries/detail/reschedule/page';
import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/locale-context';
import { driver as idDriver } from '@/lib/dictionaries/id/driver';
import { driver as enDriver } from '@/lib/dictionaries/en/driver';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ id: 'del-1', cashHeld: false });
  patch.mockReset().mockResolvedValue({});
  replace.mockReset();
});

describe('fail screen', () => {
  it('stays disabled until a code is chosen, then sends code and trimmed note', async () => {
    render(<FailPage />, { wrapper: LocaleProvider });
    const submit = screen.getByRole('button', { name: /Tandai gagal/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    fireEvent.click(screen.getByLabelText('Barang rusak'));
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: '  kardus basah  ' } });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toEqual({
      reasonCode: 'GOODS_DAMAGED',
      note: 'kardus basah',
      cashReturned: false,
    });
  });

  it('omits the note when blank', async () => {
    render(<FailPage />, { wrapper: LocaleProvider });
    fireEvent.click(screen.getByLabelText('Lainnya'));
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Tandai gagal/ }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toEqual({ reasonCode: 'OTHER', cashReturned: false });
  });
});

describe('reschedule screen', () => {
  it('needs a reason, and sends whichever one was picked', async () => {
    for (const [label, value] of [
      ['Pelanggan minta', 'CUSTOMER_REQUEST'],
      ['Kendala kurir', 'COURIER_ISSUE'],
    ] as const) {
      patch.mockClear();
      const { unmount } = render(<ReschedulePage />, { wrapper: LocaleProvider });
      fireEvent.change(screen.getByLabelText(/Waktu antar baru/), { target: { value: '2999-01-01T10:00' } });
      const submit = screen.getByRole('button', { name: /Simpan jadwal ulang/ }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      fireEvent.click(screen.getByLabelText(label));
      await waitFor(() => expect(submit.disabled).toBe(false));
      fireEvent.click(submit);
      await waitFor(() => expect(patch).toHaveBeenCalled());
      expect(patch.mock.calls[0]![1]).toMatchObject({ reason: value });
      unmount();
    }
  });
});

describe('queue replay', () => {
  it('replays an old job (reason only) with the same body, and a new one with its code', async () => {
    const { runOrQueue } = await import('@/lib/offline-queue');
    await runOrQueue({ kind: 'deliveryFail', payload: { deliveryId: 'a', reason: 'Barang rusak', cashReturned: false } });
    expect(JSON.parse(JSON.stringify(patch.mock.calls[0]![1]))).toEqual({ reason: 'Barang rusak', cashReturned: false });
    await runOrQueue({ kind: 'deliveryReschedule', payload: { deliveryId: 'a', rescheduledFor: 'x', reason: 'COURIER_ISSUE' } });
    expect(JSON.parse(JSON.stringify(patch.mock.calls[1]![1]))).toEqual({ rescheduledFor: 'x', reason: 'COURIER_ISSUE' });
  });
});

describe('queue replay of a stored old-shape job', () => {
  it('flushes a job holding only `reason` with exactly that body', async () => {
    const q = await import('@/lib/offline-queue');
    patch.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await q.runOrQueue({ kind: 'deliveryFail', payload: { deliveryId: 'old-1', reason: 'Pelanggan menolak', cashReturned: false } });
    expect(q.pending()).toHaveLength(1);
    patch.mockClear();
    await q.flush(true);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toContain('old-1');
    expect(JSON.parse(JSON.stringify(patch.mock.calls[0]![1]))).toEqual({ reason: 'Pelanggan menolak', cashReturned: false });
    expect(q.pending()).toHaveLength(0);
  });
});

describe('i18n', () => {
  it('both languages carry the new keys', () => {
    for (const d of [idDriver, enDriver] as unknown as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = d.deliveryFail;
      for (const k of ['addressNotFound', 'customerRefused', 'goodsDamaged', 'cannotContact', 'other', 'noShow', 'depotCancelled']) {
        expect(f.reasons[k]).toBeTruthy();
      }
      expect(f.noteLabel && f.notePlaceholder).toBeTruthy();
      expect(d.reschedule.why.customer && d.reschedule.why.courier && d.reschedule.whyHint && d.reschedule.whyLabel).toBeTruthy();
    }
  });
});
