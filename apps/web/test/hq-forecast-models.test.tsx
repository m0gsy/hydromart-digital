// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, put, del } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, put, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'SUPER_ADMIN' } }) }));

import { LocaleProvider } from '@/lib/locale-context';
import ForecastModelsPage from '@/app/hq/forecast-models/page';

const SCHEMA = {
  defs: [
    {
      key: 'forecast.demandModel',
      label: 'Model prakiraan permintaan',
      pattern: '^(heuristic|moving-average)$',
    },
    {
      key: 'forecast.churnModel',
      label: 'Model risiko churn',
      pattern: '^(rfm-lite|recency-only)$',
    },
  ],
  effective: { 'forecast.demandModel': 'heuristic', 'forecast.churnModel': 'rfm-lite' },
};

const renderPage = () =>
  render(
    <LocaleProvider>
      <ForecastModelsPage />
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
  toast.mockReset();
  get.mockResolvedValue(SCHEMA);
  put.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

/*
 * This screen is the whole reason the model choice is a setting instead of an env var:
 * turning a candidate on for one depot has to be something the person watching the numbers
 * can do. Two things make it worth testing — the options come from the SERVER's registry
 * (so the console can never offer a model the service would refuse), and an untouched row
 * must not be saveable (that is how a depot gets silently pinned to today's default).
 */
describe('hq/forecast-models', () => {
  it('offers exactly the models the server named in its pattern', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['heuristic', 'moving-average', 'rfm-lite']));
  });

  it('shows the effective value for each key', async () => {
    renderPage();
    // 'heuristic' is both the effective value and an option, so assert on the line that
    // reports it rather than on the string appearing anywhere on the page.
    expect(await screen.findByText(/efektif.*heuristic|effective.*heuristic/i)).toBeTruthy();
  });

  it('refuses to save a row nobody touched', async () => {
    const user = userEvent.setup();
    renderPage();
    const saves = await screen.findAllByRole('button', { name: /simpan|save/i });
    await user.click(saves[0]!);
    expect(put).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });

  it('writes the chosen model for the scope on screen', async () => {
    const user = userEvent.setup();
    renderPage();
    // The scope picker is first; the model selects follow it. Wait for the schema to have
    // rendered them rather than assuming a count that only holds after the fetch settles.
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(3));
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1]!, 'moving-average');
    const saves = await screen.findAllByRole('button', { name: /simpan|save/i });
    await user.click(saves[0]!);
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toMatchObject({
      scope: 'GLOBAL',
      key: 'forecast.demandModel',
      value: 'moving-average',
    });
  });

  it('reverting an override sends a delete for that key', async () => {
    const user = userEvent.setup();
    renderPage();
    const resets = await screen.findAllByRole('button', { name: /kembalikan|revert/i });
    await user.click(resets[0]!);
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del.mock.calls[0]![1]).toMatchObject({ scope: 'GLOBAL', key: 'forecast.demandModel' });
  });

  it('will not write a DEPOT override with no depot chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    const selects = await screen.findAllByRole('combobox');
    await user.selectOptions(selects[0]!, 'DEPOT');
    const after = await screen.findAllByRole('combobox');
    await user.selectOptions(after[after.length - 1]!, 'recency-only');
    const saves = await screen.findAllByRole('button', { name: /simpan|save/i });
    await user.click(saves[saves.length - 1]!);
    expect(put).not.toHaveBeenCalled();
  });
});
