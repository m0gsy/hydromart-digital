// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadError } from '@/components/ui';
import { LocaleProvider } from '@/lib/locale-context';

/*
 * The other half of the PR-4 sweep. A read that fills a CONTROL — the depot dropdown, the
 * category list, the courier picker — cannot use `ErrorState`: that is a page-sized answer
 * and it would blank the form the person is in the middle of. So a failed lookup renders
 * this instead, next to its own control, and the difference it has to carry is "the list is
 * missing" versus "the list is empty" — an empty select says the depot has no couriers.
 */
describe('LoadError', () => {
  it('says the read failed and retries the same read', () => {
    const reload = vi.fn();
    render(
      <LocaleProvider>
        <LoadError onRetry={reload} />
      </LocaleProvider>,
    );

    expect(screen.getByText(/Gagal dimuat/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
