/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.resetModules());

// The WhatsApp copy is its own chunk: every other route stays out of it (Lighthouse byte ratchet).
describe('the wa.* strings are a lazy chunk, not part of the default dictionary', () => {
  it('leaves them out of the shared dictionary, and reads them after the chunk lands', async () => {
    vi.resetModules();
    const { id } = await import('@/lib/dictionaries/id');
    expect('wa' in id).toBe(false);
    const { LocaleProvider, useWaStrings, useT } = await import('@/lib/locale-context');
    function Probe() {
      const ready = useWaStrings();
      const { t } = useT();
      return <p>{ready ? t('wa.card.connect') : 'loading'}</p>;
    }
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('Hubungkan WhatsApp')).toBeTruthy();
  });
});
