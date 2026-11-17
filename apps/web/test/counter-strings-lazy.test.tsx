/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.resetModules());

/*
 * The counter till's strings ship as their own chunk. They used to sit in the shared
 * dictionary every route loads, so the customer shop and the courier app carried ~6 KB of
 * till copy; the Lighthouse byte ratchet on /driver tripped on the till's own additions.
 */
describe('the counter strings are a lazy chunk, not part of the default dictionary', () => {
  it('leaves them out of the shared dictionary, and reads them after the chunk lands', async () => {
    vi.resetModules();
    const { id } = await import('@/lib/dictionaries/id');
    // A fresh module graph: the test setup grafted them onto the previous instance only.
    expect('walkIn' in id.opsFix).toBe(false);
    const { LocaleProvider, useCounterStrings, useT } = await import('@/lib/locale-context');
    function Probe() {
      const ready = useCounterStrings();
      const { t } = useT();
      return <p>{ready ? t('opsFix.walkIn.basketTitle') : 'loading'}</p>;
    }
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('Keranjang')).toBeTruthy();
  });
});
