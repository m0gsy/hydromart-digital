// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import { Sheet } from '@/components/overlay';

/** jsdom has no pointer capture; the drag handler calls it unconditionally. */
function stubPointerCapture(el: Element) {
  Object.assign(el, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
}

function handle(): HTMLElement {
  const el = document.querySelector('[aria-hidden="true"]');
  if (!el) throw new Error('drag handle missing');
  stubPointerCapture(el);
  return el as HTMLElement;
}

/**
 * jsdom has no `PointerEvent`, and Testing Library's `fireEvent.pointerDown` then builds an
 * event with no `clientY` — the drag reads `NaN` and every assertion below passes for the
 * wrong reason. A `MouseEvent` carries the coordinate and React's synthetic system still
 * routes it by type.
 */
function drag(el: HTMLElement, from: number, to: number) {
  el.dispatchEvent(new MouseEvent('pointerdown', { clientY: from, bubbles: true }));
  el.dispatchEvent(new MouseEvent('pointermove', { clientY: to, bubbles: true }));
  el.dispatchEvent(new MouseEvent('pointerup', { clientY: to, bubbles: true }));
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} title="Alamat">
        body
      </Sheet>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // native-bridge routes the Android hardware back button by looking for this exact pair.
  // Losing either turns "back closes the sheet" into "back leaves the screen".
  it('keeps the dialog role and modal flag the hardware back button looks for', () => {
    render(
      <Sheet open onClose={() => {}} title="Alamat">
        body
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Alamat');
  });

  it('pins the footer outside the scrolling body', () => {
    render(
      <Sheet open onClose={() => {}} title="Alamat" footer={<button>Simpan</button>}>
        body
      </Sheet>,
    );
    const save = screen.getByRole('button', { name: 'Simpan' });
    const scroller = document.querySelector('.overflow-y-auto');
    expect(scroller?.contains(save)).toBe(false);
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('has no footer element when none is given', () => {
    render(
      <Sheet open onClose={() => {}} title="Alamat">
        body
      </Sheet>,
    );
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull();
  });

  it('closes when the handle is dragged far enough', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Alamat">
        body
      </Sheet>,
    );
    drag(handle(), 100, 300);
    expect(onClose).toHaveBeenCalled();
  });

  it('springs back when the drag is only a nudge', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Alamat">
        body
      </Sheet>,
    );
    drag(handle(), 100, 140);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Alamat">
        body
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
