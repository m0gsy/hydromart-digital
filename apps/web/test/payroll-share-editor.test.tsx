// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'a', name: 'Galaksi' },
      { id: 'b', name: 'Pekayon' },
      { id: 'c', name: 'Bekasi' },
    ],
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PayrollShareEditor } from '@/components/hr/payroll-share-editor';
import { LocaleProvider } from '@/lib/locale-context';
import type { Payroll } from '@/lib/hr';

const payroll = {
  id: 'p1',
  gross: '100',
  totalBonus: '0',
  totalDeduction: '10',
  shares: [
    { depotId: 'a', days: 20, gross: 70, bonus: 0, deduction: 7, shortfall: 0, net: 63 },
    { depotId: 'b', days: 10, gross: 30, bonus: 0, deduction: 3, shortfall: 0, net: 27 },
  ],
} as unknown as Payroll;

function view(onSaved = vi.fn()) {
  render(
    <LocaleProvider>
      <PayrollShareEditor payroll={payroll} onSaved={onSaved} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole('button'));
  return onSaved;
}

describe('PayrollShareEditor', () => {
  beforeEach(() => post.mockReset().mockResolvedValue([]));

  it('cannot be saved while the columns do not add up to the slip', () => {
    view();
    const gross = screen.getAllByRole('spinbutton')[1] as HTMLInputElement; // first depot gross
    fireEvent.change(gross, { target: { value: '80' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'koreksi mutasi' } });
    expect((screen.getByText(/Simpan pembagian/).closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/selisih gross 10/);
  });

  it('posts the corrected split with the reason once balanced', async () => {
    const onSaved = view();
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '60' } }); // a gross 70 -> 60
    fireEvent.change(inputs[6] as HTMLInputElement, { target: { value: '40' } }); // b gross 30 -> 40
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'koreksi mutasi' } });
    fireEvent.click(screen.getByText(/Simpan pembagian/));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, { reason: string; shares: { depotId: string; gross: number }[] }];
    expect(url).toMatch(/payroll\/p1\/reallocate-shares$/);
    expect(body.reason).toBe('koreksi mutasi');
    expect(body.shares.map((s) => [s.depotId, s.gross])).toEqual([
      ['a', 60],
      ['b', 40],
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('can add a depot that is not in the split yet and remove one', () => {
    view();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c' } });
    expect(screen.getByText('Bekasi')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Hapus')[0] as HTMLElement);
    // gone from the split, and offered again in the add list
    expect(screen.getAllByText('Galaksi').map((e) => e.tagName)).toEqual(['OPTION']);
  });
});
