'use client';

import { useEffect } from 'react';
import { X } from '@phosphor-icons/react';

import { Button } from '@/components/ui';

// Overlay primitives — a bottom-sheet-on-mobile / centered-dialog-on-desktop
// Sheet, and a small ConfirmDialog built on the same shell. Dependency-free:
// a fixed backdrop + panel, Esc-to-close, body scroll lock, backdrop click.
// Not a full focus trap (ponytail: Esc + labelled dialog cover the common case;
// add a trap if these host long forms with many tab stops).

function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/**
 * A modal surface: slides up from the bottom on mobile (rounded top, full width),
 * centers as a card on desktop. Title is the accessible label.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-[color:var(--text)]/40"
        style={{ animation: 'fadeUp 0.15s var(--ease-out) both' }}
      />
      <div
        className="surface relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-lift sm:w-full sm:max-w-lg sm:rounded-3xl"
        style={{ animation: 'fadeUp 0.25s var(--ease-out) both' }}
      >
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button
            type="button"
            aria-label="Tutup"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-[color:var(--surface-soft)]"
          >
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** A small confirm dialog — replaces window.confirm for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  tone = 'danger',
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-[color:var(--text)]/40"
      />
      <div
        className="surface relative flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6 shadow-lift"
        style={{ animation: 'fadeUp 0.2s var(--ease-out) both' }}
      >
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{message}</p>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
