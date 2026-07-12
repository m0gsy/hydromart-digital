'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';

// Lightweight toast: transient feedback for add-to-cart, order actions, etc.
// First consumer lands in M4. Stacked pills, bottom-center, auto-dismiss.
// No portal/deps — a fixed container in the provider is enough.

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastValue {
  toast: (message: string, tone?: ToastTone) => void;
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

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, tone }]);
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
          return (
            <div
              key={t.id}
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
