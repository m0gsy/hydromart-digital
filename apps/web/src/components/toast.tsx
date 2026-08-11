'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';

// Lightweight toast: transient feedback for add-to-cart, order actions, etc.
// First consumer lands in M4. Stacked pills, bottom-center, auto-dismiss.
// No portal/deps — a fixed container in the provider is enough.

type ToastTone = 'success' | 'error' | 'info';

/**
 * Optional: makes the pill tappable. Added for the foreground push (E4), which announced
 * "your order is on its way" and then had nowhere to go — the destination was in the
 * payload the whole time. Optional because a toast that looks pressable and does nothing
 * is worse than one that plainly does not, so only callers with a real destination pass it.
 */
type ToastAction = () => void;

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  onPress?: ToastAction;
}

interface ToastValue {
  toast: (message: string, tone?: ToastTone, onPress?: ToastAction) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const TONE_ICON = {
  success: CheckCircle,
  error: WarningCircle,
  info: Info,
} as const;

const TONE_STYLE: Record<ToastTone, string> = {
  success: 'text-[color:var(--success)]',
  error: 'text-[color:var(--danger)]',
  info: 'text-brand-600',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: ToastTone = 'success', onPress?: ToastAction) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, tone, onPress }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-8"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const Icon = TONE_ICON[t.tone];
          const body = (
            <>
              <Icon size={18} weight="fill" className={TONE_STYLE[t.tone]} />
              {t.message}
            </>
          );
          const shell =
            'pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full bg-[color:var(--text)] px-5 py-3 text-left text-sm font-semibold text-[color:var(--surface)] shadow-lift';
          if (t.onPress) {
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setItems((prev) => prev.filter((i) => i.id !== t.id));
                  t.onPress?.();
                }}
                className={shell}
                style={{ animation: 'fadeUp 0.25s var(--ease-out) both' }}
              >
                {body}
              </button>
            );
          }
          return (
            <div
              key={t.id}
              // An error is not a status update: role="status"/aria-live="polite" makes a
              // screen reader wait for a pause before mentioning that what the user just
              // did failed. Errors announce assertively; everything else stays polite.
              // It is also what makes a failure assertable — the face check-in e2e was
              // looking for an alert the UI never marked as one.
              role={t.tone === 'error' ? 'alert' : undefined}
              className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full bg-[color:var(--text)] px-5 py-3 text-sm font-semibold text-[color:var(--surface)] shadow-lift"
              style={{ animation: 'fadeUp 0.25s var(--ease-out) both' }}
            >
              <Icon size={18} weight="fill" className={TONE_STYLE[t.tone]} />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
