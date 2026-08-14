'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// Overlay primitives — a bottom-sheet-on-mobile / centered-dialog-on-desktop
// Sheet, and a small ConfirmDialog built on the same shell. Dependency-free:
// a fixed backdrop + panel, Esc-to-close, body scroll lock, backdrop click.
// Not a full focus trap (ponytail: Esc + labelled dialog cover the common case;
// add a trap if these host long forms with many tab stops).
//
// Both render into `document.body`. `position: fixed` is relative to the nearest
// transformed ancestor, not the viewport, and `PageTransition` leaves a filled
// transform on every page — so an overlay left in the page tree measured `inset-0`
// against the whole scroll height and opened below the fold on any long screen.

/** Renders into `document.body`, or nowhere at all before hydration. */
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

// Every open overlay listens on the document, so one Escape used to close the whole stack
// at once — and the Android back button *is* an Escape here (native-bridge dispatches one).
// A confirm opened over a sheet has to close the confirm only. Registration order is open
// order, which is the same as stacking order for anything a user opened by tapping.
const stack: (() => void)[] = [];

function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const self = () => onClose();
    stack.push(self);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === self) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      stack.splice(stack.indexOf(self), 1);
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
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /**
   * Pinned below the scroll area rather than at the end of it. A sheet that carries a form
   * needs its Simpan button reachable without scrolling to the bottom of the form first.
   */
  footer?: React.ReactNode;
}) {
  useOverlay(open, onClose);
  const { t } = useT();
  const [dragY, setDragY] = useState(0);
  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);
  if (!open) return null;

  // Drag-to-dismiss on the handle only, not the whole panel — the panel scrolls, and a
  // gesture that both scrolls and dismisses picks the wrong one about half the time.
  // Pointer events rather than touch: the same code then works with a mouse on desktop.
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDragY(Math.max(0, ev.clientY - startY));
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (ev.clientY - startY > 120) onClose();
      else setDragY(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute inset-0 bg-[color:var(--text)]/40"
          style={{ animation: 'fadeUp 0.15s var(--ease-out) both' }}
        />
        <div
          className="surface relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-lift sm:w-full sm:max-w-lg sm:rounded-3xl"
          style={{
            animation: dragY === 0 ? 'slideUp 0.25s var(--ease-out) both' : undefined,
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragY ? 'none' : 'transform 0.2s var(--ease-out)',
          }}
        >
          {/* Grab handle — the affordance that says this can be flicked away, and the only
            part of the panel that listens for the drag. Hidden from `sm:` up, where the
            sheet is a centered dialog and there is nothing to drag it towards. */}
          <div
            onPointerDown={onHandleDown}
            className="flex touch-none justify-center pt-2.5 pb-1 sm:hidden"
            aria-hidden="true"
          >
            <span className="h-1 w-10 rounded-full bg-[color:var(--border)]" />
          </div>
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-[color:var(--surface-soft)]"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer && (
            <div className="border-t border-app p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** A small confirm dialog — replaces window.confirm for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
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
  const { t } = useT();
  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          aria-label={t('common.close')}
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
              {cancelLabel ?? t('common.cancel')}
            </Button>
            <Button type="button" variant={tone} onClick={onConfirm} loading={loading}>
              {confirmLabel ?? t('common.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
