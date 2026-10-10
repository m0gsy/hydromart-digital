// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd1', name: 'Pekayon' }], scopedId: 'd1', selected: null }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/hr/depot-picker', () => ({
  HrDepotPicker: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('d1')}>
      pick-depot
    </button>
  ),
}));

import DepotRequestsPage from '@/app/hr/depot-requests/page';
import { LocaleProvider } from '@/lib/locale-context';

const page = () => (
  <LocaleProvider>
    <DepotRequestsPage />
  </LocaleProvider>
);

describe('/hr/depot-requests', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({});
    get.mockReset().mockResolvedValue({
      rows: [
        {
          id: 'r1',
          employeeId: 'e1',
          kind: 'LOAN',
          depotId: 'd1',
          startDate: '2026-10-20T00:00:00.000Z',
          endDate: '2026-10-25T00:00:00.000Z',
          status: 'CANCELLED',
          failReason: 'stok orang kurang',
          note: null,
        },
      ],
      total: 1,
    });
  });

  it('shows my requests with the reason HR gave', async () => {
    render(page());
    expect(await screen.findByText('stok orang kurang')).toBeTruthy();
  });

  it('sends the employee code, not an id', async () => {
    render(page());
    await screen.findByText('stok orang kurang');
    fireEvent.change(screen.getByPlaceholderText(/EMP-0012|0012/), { target: { value: ' EMP-0042 ' } });
    fireEvent.click(screen.getByText('pick-depot'));
    const end = document.querySelectorAll('input[type="date"]')[1] as HTMLInputElement;
    fireEvent.change(end, { target: { value: '2099-01-02' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(url)).toMatch(/depot-assignments\/requests$/);
    expect(body).toMatchObject({ employeeCode: 'EMP-0042', depotId: 'd1', endDate: '2099-01-02' });
    expect(body).not.toHaveProperty('employeeId');
  });
});
