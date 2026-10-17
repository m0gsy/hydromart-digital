// @vitest-environment jsdom
/**
 * FR-034: the PPN note under the checkout total. The server computes it; this prints it, and
 * stays silent whenever there is nothing honest to say.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get } };
});
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

import { TaxPreviewLine } from '@/components/order/tax-preview-line';
import { endpoints } from '@/lib/endpoints';

beforeEach(() => get.mockReset());

describe('TaxPreviewLine', () => {
  it('asks the server for the PPN inside the total and prints it with the rate', async () => {
    get.mockResolvedValue({ amount: 2477, percent: 11 });
    render(<TaxPreviewLine total={25000} />);
    await waitFor(() =>
      expect(screen.getByText('order.detail.taxIncluded:{"pct":11}')).toBeTruthy(),
    );
    expect(screen.getByText(/2\.477/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith(endpoints.orders.taxPreview(25000), true);
  });

  it('asks again when the total changes (express, a voucher, a different address)', async () => {
    get.mockResolvedValue({ amount: 2477, percent: 11 });
    const { rerender } = render(<TaxPreviewLine total={25000} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender(<TaxPreviewLine total={30000} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls[1]![0]).toBe(endpoints.orders.taxPreview(30000));
  });

  it('says nothing when there is no PPN', async () => {
    get.mockResolvedValue({ amount: 0, percent: null });
    const { container } = render(<TaxPreviewLine total={25000} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('says nothing when the read fails: a missing note never stops a payment', async () => {
    // A rejecting spy return value is reported as an unhandled rejection by the spy library itself,
    // whatever the component does with it; a thenable that fails the same way tests the component.
    get.mockImplementation(() => ({
      catch: (onFail: (e: unknown) => unknown) =>
        Promise.resolve(onFail(new Error('order-service down'))),
    }));
    const { container } = render(<TaxPreviewLine total={25000} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    // Let the rejection settle: the assertion is about what is on screen AFTER the read failed.
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('does not ask at all for an empty total', async () => {
    const { container } = render(<TaxPreviewLine total={0} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });
});
