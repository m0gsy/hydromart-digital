'use client';

import { createContext, useCallback, useContext, useState } from 'react';

import { ConfirmDialog } from '@/components/overlay';

/*
 * One asking-place for the whole app.
 *
 * `ConfirmDialog` has existed since M4 and was used by 4 of 132 console pages. The other
 * 128 either called `window.confirm`/`window.prompt` or asked nothing at all — a trash icon
 * that deleted a cash deposit on one tap, a "Tandai Dibayar" that paid a payroll run on
 * one tap, a toggle that switched off an HQ-approved price rule on one tap.
 *
 * The reason it stayed at 4 is mechanical, not lazy: the dialog is a controlled component,
 * so every call site needed its own `useState`, its own pending-target state and its own
 * JSX branch — twelve lines to guard a one-line action, times a hundred. This turns that
 * into one line:
 *
 *     if (!(await confirm({ title, message }))) return;
 *     const reason = await askReason({ title, message, label });  // null = cancelled
 *
 * Same shape as `useToast`, and mounted next to it in the root layout for the same reason:
 * every screen in the app, console screens included, already renders inside it.
 */

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

interface ReasonRequest extends ConfirmRequest {
  /** Field label above the box. */
  label: string;
  placeholder?: string;
  /** Blank allowed. Off by default: a recorded reason nobody typed is not a record. */
  optional?: boolean;
}

interface ConfirmValue {
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  askReason: (req: ReasonRequest) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmValue | null>(null);

interface Pending {
  req: ConfirmRequest & Partial<ReasonRequest>;
  wantsReason: boolean;
  settle: (value: string | null) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const open = useCallback(
    (req: ConfirmRequest & Partial<ReasonRequest>, wantsReason: boolean) =>
      new Promise<string | null>((resolve) => {
        setPending({
          req,
          wantsReason,
          settle: (value) => {
            setPending(null);
            resolve(value);
          },
        });
      }),
    [],
  );

  const confirm = useCallback(
    (req: ConfirmRequest) => open(req, false).then((v) => v !== null),
    [open],
  );
  const askReason = useCallback((req: ReasonRequest) => open(req, true), [open]);

  return (
    <ConfirmContext.Provider value={{ confirm, askReason }}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          title={pending.req.title}
          message={pending.req.message}
          confirmLabel={pending.req.confirmLabel}
          cancelLabel={pending.req.cancelLabel}
          tone={pending.req.tone}
          reason={
            pending.wantsReason
              ? {
                  label: pending.req.label ?? '',
                  placeholder: pending.req.placeholder,
                  optional: pending.req.optional,
                }
              : undefined
          }
          onConfirm={(reason) => pending.settle(reason)}
          // Dismissing — Esc, the backdrop, the Android back button — is a "no", and it
          // resolves rather than hanging. A promise nobody settles leaves the caller's
          // `busy` flag stuck true and the screen dead.
          onClose={() => pending.settle(null)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
