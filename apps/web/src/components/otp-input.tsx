'use client';

import { useRef } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  onComplete?: (v: string) => void;
}

// Segmented per-digit OTP field. `value` is the compact digit string; box i shows
// value[i]. Entry is left-to-right (focus is driven), so a compact string is enough.
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  autoFocus,
  onComplete,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function focusBox(i: number) {
    const el = refs.current[Math.max(0, Math.min(i, length - 1))];
    el?.focus();
    el?.select();
  }

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  /**
   * A box past the end of what has been typed cannot hold a digit.
   *
   * `value` is a compact string — box i shows `value[i]` — so a digit "typed into box 3"
   * while 1 and 2 are empty is spliced into a sparse array and `join('')` closes the gaps:
   * it lands in box 1. Measured on both WebView 133 and 150, from a plain tap. Sending the
   * press to the first empty box instead makes the caret sit where the digit will actually
   * go, which is also how every other OTP field behaves.
   *
   * On the PRESS, not on focus: `focusBox()` moves focus from inside `handleChange`, before
   * React has committed the digit, so a focus-time check reads a stale `value`, decides box
   * 2 is out of reach and drags the caret back to box 1 on every keystroke. A pointer press
   * only ever happens between renders, where `value` is what the user can see.
   */
  function handlePress(i: number, e: React.MouseEvent<HTMLInputElement>) {
    const frontier = Math.min(value.length, length - 1);
    if (i <= frontier) return;
    // Default would focus the box that was pressed; this is the whole redirection.
    e.preventDefault();
    focusBox(frontier);
  }

  function handleChange(i: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return; // deletions are handled in keydown
    const arr = value.split('');
    for (let k = 0; k < digits.length && i + k < length; k++) arr[i + k] = digits.charAt(k);
    commit(arr.join(''));
    focusBox(i + digits.length);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[i]) {
        commit(value.slice(0, i) + value.slice(i + 1));
      } else if (i > 0) {
        commit(value.slice(0, i - 1) + value.slice(i));
        focusBox(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusBox(i + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!text) return;
    commit(text);
    focusBox(text.length);
  }

  return (
    <div role="group" aria-label="Kode verifikasi" className="flex gap-2">
      {Array.from({ length }).map((_, i) => {
        // Filled or focused cells get the 2px teal border; empty cells a 1.5px hairline.
        const filled = Boolean(value[i]);
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            value={value[i] ?? ''}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            onMouseDown={(e) => handlePress(i, e)}
            style={{ height: 60 }}
            className={
              'min-w-0 flex-1 rounded-[14px] bg-[color:var(--surface-elevated)] text-center text-[24px] font-extrabold tabular-nums caret-brand-600 outline-none focus:border-2 focus:border-brand-600 disabled:opacity-60 ' +
              (filled ? 'border-2 border-brand-600' : 'border-[1.5px] border-app')
            }
          />
        );
      })}
    </div>
  );
}
