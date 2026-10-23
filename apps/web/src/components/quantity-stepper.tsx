'use client';

import { useState } from 'react';
import { Minus, Plus } from '@phosphor-icons/react';

import { haptic } from '@/lib/platform';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled,
  editable = false,
  label = 'Quantity',
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /**
   * Let the number be typed as well as stepped. For a till, where 20 galon should not be 20
   * taps. Committed on blur or Enter, not per keystroke: typing "20" must not price a basket
   * of 2 on the way there. Off by default, so the customer cart and product page are untouched.
   */
  editable?: boolean;
  /** Names the typed box for a screen reader; with a list of products, which product it is for. */
  label?: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  // What is being typed, or null when the box just mirrors `value`.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    // An emptied box means "back to the minimum", not "leave it" — it reads as clearing.
    const typed = draft === '' ? min : Number.parseInt(draft, 10);
    const next = clamp(Number.isNaN(typed) ? value : typed);
    if (next !== value) onChange(next);
  };
  // The number changing is the only feedback this control gives, and on a phone the thumb
  // is usually covering it.
  const step = (next: number) => {
    haptic();
    onChange(next);
  };
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-app">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => step(clamp(value - 1))}
        className="flex h-full min-h-11 w-11 items-center justify-center text-muted transition-colors hover:text-brand-600 disabled:opacity-40 disabled:hover:text-muted"
      >
        <Minus size={16} />
      </button>
      {editable ? (
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          disabled={disabled}
          value={draft ?? String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
          className="h-full w-12 bg-transparent text-center text-[14px] font-extrabold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        />
      ) : (
        <span aria-live="polite" className="min-w-[1.75rem] text-center text-[14px] font-extrabold tabular-nums">
          {value}
        </span>
      )}
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled || value >= max}
        onClick={() => step(clamp(value + 1))}
        className="flex h-full min-h-11 w-11 items-center justify-center text-muted transition-colors hover:text-brand-600 disabled:opacity-40 disabled:hover:text-muted"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
