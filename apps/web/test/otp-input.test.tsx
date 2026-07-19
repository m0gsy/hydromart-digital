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
