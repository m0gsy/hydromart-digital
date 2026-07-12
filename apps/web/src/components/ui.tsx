'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import { formatIDR } from '@/lib/format';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Button ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'surface-elevated border border-app hover:bg-brand-50 disabled:opacity-60',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:opacity-60',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-60',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold',
        'transition-[background,transform] active:translate-y-px disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ---------- Field + Input ---------- */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm',
        'placeholder:text-[color:var(--text-muted)]',
        'focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600',
        className,
      )}
    />
  );
}

/* ---------- Card ---------- */
export function Card({
  className,
  children,
  elevated = true,
}: {
  className?: string;
  children: ReactNode;
  elevated?: boolean;
}) {
  return (
    <div
      className={cx(
        'surface rounded-2xl border border-app',
        elevated && 'shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------- Chip / Pill ---------- */
type ChipTone = 'tint' | 'ink' | 'outline' | 'amber' | 'success';

const CHIP_STYLES: Record<ChipTone, string> = {
  tint: 'bg-brand-50 text-brand-800',
  ink: 'bg-[color:var(--text)] text-[color:var(--surface)]',
  outline: 'border border-app text-muted',
  amber: 'bg-[color:var(--warning-bg)] text-[color:var(--warning)]',
  success: 'bg-[color:var(--success-bg)] text-[color:var(--success)]',
};

export function Chip({
  tone = 'tint',
  className,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
        CHIP_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- IconButton ---------- */
export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex h-10 w-10 items-center justify-center rounded-full transition-[background,transform]',
        'hover:bg-brand-50 active:scale-90 disabled:opacity-50',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- SectionHeader ---------- */
export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-4 flex items-baseline justify-between gap-4', className)}>
      <div>
        <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- RadioCard ---------- (selectable option — checkout address/payment) */
export function RadioCard({
  selected,
  onSelect,
  className,
  children,
}: {
  selected: boolean;
  onSelect?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        'flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        selected
          ? 'border-brand-600 bg-brand-50'
          : 'border-app hover:border-brand-400',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- MemberPrice ---------- (teal member-price chip on cards / PDP) */
export function MemberPrice({ amount, className }: { amount: number; className?: string }) {
  return (
    <Chip tone="tint" className={cx('whitespace-nowrap', className)}>
      Member {formatIDR(amount)}
    </Chip>
  );
}

/* ---------- Badge ---------- */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'brand' | 'success' | 'danger' | 'warning';
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    neutral: 'bg-[color:var(--surface-muted)] text-muted',
    brand: 'bg-brand-100 text-brand-800',
    success: 'bg-green-100 text-green-800',
    danger: 'bg-red-100 text-red-800',
    warning: 'bg-amber-100 text-amber-800',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        styles[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Money ---------- */
export function Money({ amount, className }: { amount: number; className?: string }) {
  return <span className={cx('tabular-nums', className)}>{formatIDR(amount)}</span>;
}

/* ---------- Spinner ---------- */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- State blocks ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-[color:var(--surface-muted)]', className)} />;
}

export function CenterState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-brand-500">{icon}</div>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <CenterState
      title="Something went wrong"
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </CenterState>
  );
}
