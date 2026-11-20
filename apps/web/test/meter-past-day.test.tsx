// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Owner decision 2026-11-20: the meter screen opens any earlier day, a previous day can be
 * corrected only with a reason, and a corrected day says who corrected it, when and why.
 */

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, put } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'KEPALA_DEPOT' }, ready: true }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k), locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Satu', code: 'D1' }],
    selected: { id: 'd1', name: 'Depot Satu', code: 'D1' },
    selectedId: 'd1',
    scopedId: 'd1',
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MeterPage from '@/app/dashboard/meter/page';

const reconciliation = (date: string, over: Record<string, unknown> = {}) => ({
  depotId: 'd1',
  date,
  reading: {
    depotId: 'd1',
    date,
    openingM3: 1000,
    closingM3: 1002,
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...over,
  },
  soldLiters: 0,
  meterLiters: 2000,
  varianceLiters: 0,
  tank: { levelPct: null, liters: null, capacityLiters: 0, avgDailyLiters: null, hoursRemaining: null },
  correctedByName: null,
});

afterEach(() => {
  get.mockReset();
  put.mockReset();
});

const serve = (over: Record<string, unknown> = {}, name: string | null = null) =>
  get.mockImplementation(async (url: string) => {
    const day = url.match(/meter\/d1\/(\d{4}-\d{2}-\d{2})/)?.[1];
    return day ? { ...reconciliation(day, over), correctedByName: name } : [];
  });

describe('the meter screen on an earlier day', () => {
  it('opens the chosen day, and saves it only as a correction with a reason', async () => {
    serve();
    put.mockResolvedValue({});
    render(<MeterPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('hrFix.meter.day'), { target: { value: '2026-11-18' } });
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('/meter/d1/2026-11-18'))).toBe(true));

    fireEvent.change(screen.getByPlaceholderText('1002'), { target: { value: '1003' } });
    const save = screen.getByRole('button', { name: 'hrFix.meter.saveCorrection' });
    // No reason yet: nothing to send.
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('hrFix.meter.correctionReasonPlaceholder'), {
      target: { value: 'angka sore salah ketik' },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    const readsBefore = get.mock.calls.length;
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalled());
    // The day and the history are read again once the correction is stored.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(readsBefore + 2));
    expect(String(put.mock.calls[0]![0])).toContain('/meter/d1/2026-11-18');
    expect(put.mock.calls[0]![1]).toMatchObject({ closingM3: 1003, correctionReason: 'angka sore salah ketik' });
  });

  it('says who corrected a day, when and why', async () => {
    serve(
      { correctedAt: '2026-11-19T02:00:00.000Z', correctedBy: 'hq-1', correctionReason: 'angka sore salah ketik' },
      'Budi HQ',
    );
    render(<MeterPage />);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('hrFix.meter.correctedNote');
    expect(note.textContent).toContain('Budi HQ');
    expect(note.textContent).toContain('angka sore salah ketik');
  });

  it("today's own save needs no reason", async () => {
    serve();
    render(<MeterPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('hrFix.meter.correctionReasonPlaceholder')).toBeNull();
    expect(screen.getByRole('button', { name: 'hrFix.meter.save' })).toBeTruthy();
  });
});
