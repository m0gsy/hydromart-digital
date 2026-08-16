// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OtpInput } from '@/components/otp-input';

// OtpInput is controlled; wrap it so `value` actually updates across events.
function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [v, setV] = useState('');
  return <OtpInput value={v} onChange={setV} onComplete={onComplete} />;
}

const boxes = () => Array.from({ length: 6 }, (_, i) => screen.getByLabelText(`Digit ${i + 1}`) as HTMLInputElement);

describe('OtpInput', () => {
  it('typing a full code fills every box and fires onComplete once', async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText('Digit 1'));
    await userEvent.keyboard('123456');

    expect(boxes().map((b) => b.value).join('')).toBe('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('strips non-digits on input', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Digit 1'));
    await userEvent.keyboard('1a2b3');
    expect(boxes().map((b) => b.value).join('')).toBe('123');
  });

  it('backspace clears the current digit then walks left', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Digit 1'));
    await userEvent.keyboard('12');
    // Focus is on box 3 (empty) after typing two digits.
    await userEvent.keyboard('{Backspace}'); // empty box → deletes previous digit, moves left
    expect(boxes().map((b) => b.value).join('')).toBe('1');
    await userEvent.keyboard('{Backspace}'); // now on box with '1'
    expect(boxes().map((b) => b.value).join('')).toBe('');
  });

  // Found on a device: a tap on box 3 with 1-2 empty focused it, and the digit typed there
  // landed in box 1 — `value` is compact, so the sparse splice collapsed. The focus is
  // clamped to the first empty box now, so what the caret is on is what fills.
  it('a tap past the last filled box lands on the first empty one', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Digit 3'));
    expect(document.activeElement).toBe(screen.getByLabelText('Digit 1'));
    await userEvent.keyboard('7');
    expect(boxes().map((b) => b.value).join('')).toBe('7');
    expect(boxes()[0]?.value).toBe('7');

    // With one digit in, box 2 is reachable and box 4 is still not.
    await userEvent.click(screen.getByLabelText('Digit 4'));
    expect(document.activeElement).toBe(screen.getByLabelText('Digit 2'));
  });

  // The other half of the same rule: a box that already holds a digit is reachable, and the
  // redirection must not touch it. (What a keystroke then does to it is the browser's own
  // selection behaviour, which jsdom does not reproduce — not asserted here.)
  it('a tap on an already-filled box stays put', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Digit 1'));
    await userEvent.keyboard('123');
    const second = screen.getByLabelText('Digit 2');
    await userEvent.click(second);
    expect(document.activeElement).toBe(second);
  });

  it('pasting distributes digits and fires onComplete', async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const first = screen.getByLabelText('Digit 1');
    first.focus();
    await userEvent.paste('654321');
    expect(boxes().map((b) => b.value).join('')).toBe('654321');
    expect(onComplete).toHaveBeenCalledWith('654321');
  });
});
