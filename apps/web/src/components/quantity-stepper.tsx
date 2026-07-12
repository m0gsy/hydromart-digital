'use client';

import { Minus, Plus } from '@phosphor-icons/react';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-app">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="flex h-full w-[38px] items-center justify-center text-muted transition-colors hover:text-brand-600 disabled:opacity-40 disabled:hover:text-muted"
      >
        <Minus size={16} />
      </button>
      <span aria-live="polite" className="min-w-[1.75rem] text-center text-[14px] font-extrabold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="flex h-full w-[38px] items-center justify-center text-muted transition-colors hover:text-brand-600 disabled:opacity-40 disabled:hover:text-muted"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
