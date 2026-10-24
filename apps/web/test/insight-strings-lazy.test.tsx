/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.resetModules());

describe('the insight strings are a lazy chunk, not part of the default dictionary', () => {
  it('leaves them out of the shared dictionary, and reads them after the chunk lands', async () => {
    vi.resetModules();
    const { id } = await import('@/lib/dictionaries/id');
    // A fresh module graph: the test setup grafted them onto the previous instance only.
    expect('insight' in id).toBe(false);

    const { LocaleProvider, useInsightStrings, useT } = await import('@/lib/locale-context');
    function Probe() {
      const ready = useInsightStrings();
      const { t } = useT();
      return <p>{ready ? t('insight.title') : 'loading'}</p>;
    }
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText(id_title())).toBeTruthy();
  });
});

function id_title(): string {
  return 'Dasbor';
}
