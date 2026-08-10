// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

let keyboardOpen = false;
vi.mock('@/lib/use-keyboard', () => ({ useKeyboardOpen: () => keyboardOpen }));

import { ListRow, Segmented, StickyActionBar } from '@/components/ui';

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ] as const;

  it('marks only the selected option as pressed', () => {
    render(<Segmented value="b" options={options} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'B' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('reports a change', () => {
    const onChange = vi.fn();
    render(<Segmented value="a" options={options} onChange={onChange} />);
    screen.getByRole('button', { name: 'B' }).click();
    expect(onChange).toHaveBeenCalledWith('b');
  });

  // The language switch calls a toggle, so re-firing on the current value would flip it back.
  it('stays quiet when the option already selected is tapped', () => {
    const onChange = vi.fn();
    render(<Segmented value="a" options={options} onChange={onChange} />);
    screen.getByRole('button', { name: 'A' }).click();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ListRow', () => {
  it('navigates when given an href', () => {
    render(<ListRow title="Alamat" href="/addresses" />);
    expect(screen.getByRole('link', { name: /Alamat/ }).getAttribute('href')).toBe('/addresses');
  });

  it('acts as a button when given a handler', () => {
    const onClick = vi.fn();
    render(<ListRow title="Preferensi" onClick={onClick} subtitle="Tema dan bahasa" />);
    screen.getByRole('button', { name: /Preferensi/ }).click();
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText('Tema dan bahasa')).toBeTruthy();
  });

  it('is inert, not a broken control, when it only displays', () => {
    render(<ListRow title="Versi" trailing={<span>1.0.3</span>} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('1.0.3')).toBeTruthy();
  });

  it('drops the chevron when a trailing slot is supplied', () => {
    const { container } = render(<ListRow title="Bahasa" onClick={() => {}} trailing={<i />} />);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
});

describe('StickyActionBar', () => {
  it('is pinned while the keyboard is down', () => {
    keyboardOpen = false;
    const { container } = render(<StickyActionBar>x</StickyActionBar>);
    expect(container.firstElementChild?.className).toContain('sticky');
  });

  // It must not vanish like the tab bar does — the CTA is the point of the screen. It stops
  // being pinned so it sits above the keyboard instead of on top of it.
  it('rejoins the flow while the keyboard is up, rather than hiding', () => {
    keyboardOpen = true;
    const { container } = render(<StickyActionBar>x</StickyActionBar>);
    expect(container.firstElementChild?.className).not.toContain('sticky');
    expect(screen.getByText('x')).toBeTruthy();
  });
});
