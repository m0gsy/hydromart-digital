'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { CaretRight, Drop } from '@phosphor-icons/react';

import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useKeyboardOpen } from '@/lib/use-keyboard';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Button ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-on-brand hover:bg-brand-700 disabled:bg-brand-300',
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
/**
 * A1. No `whitespace-nowrap`. On a 320px screen the product grid gives each card a 136px
 * box — 104px of content inside `p-4` — and this chip renders ~119.5px at the prices this
 * shop actually charges. Refusing to wrap pushed the add-to-cart button out of the card's
 * own `overflow:hidden`: measured at x=144 against a clip edge of x=136, so the button was
 * not merely cramped, it painted ZERO visible pixels. Wrapping to a second line is the whole
 * fix, and it costs a taller card on the narrowest phones only.
 */
export function MemberPrice({ amount, className }: { amount: number; className?: string }) {
  return (
    <Chip tone="tint" className={cx('min-w-0', className)}>
      Member {formatIDR(amount)}
    </Chip>
  );
}

/* ---------- BrandMark ---------- */
/**
 * A15 — the logo lockup, in one place.
 *
 * Four screens built it by hand (`app-bar`, `footer`, `login`, `onboarding-tour`) and had
 * already drifted into three circle colours, four sizes, three icon colours and one raw
 * hex (`#5ccbdd`) that exists nowhere else in the codebase. Nothing was wrong on any single
 * screen; they simply stopped being the same mark.
 *
 * This centralises the STRUCTURE — circle, drop, wordmark, gap, weight — while each caller
 * keeps its own tone and size. Deliberately not a redesign: making them all identical would
 * be a visual change on four screens, and a visual change is the one thing that cannot be
 * verified without looking at a device. What it does buy is that the next one cannot drift.
 */
type BrandTone = 'brand' | 'light' | 'accent';

const BRAND_TONE: Record<BrandTone, { circle: string; drop: string }> = {
  /** Teal circle, white drop — the app bar and the tour. */
  brand: { circle: 'bg-brand-600', drop: 'text-white' },
  /** White circle on a dark ground — the footer. */
  light: { circle: 'bg-white', drop: 'text-deep-teal' },
  /**
   * The login hero's lighter mark. The two values were inline hex on that page and appear
   * nowhere else; parked here so there is exactly one definition of them, and so the day
   * they become tokens there is one line to change.
   */
  accent: { circle: 'bg-[#5ccbdd]', drop: 'text-[#16282e]' },
};

export function BrandMark({
  tone = 'brand',
  circlePx = 36,
  dropPx = 19,
  textClass = 'text-[19px]',
  className,
}: {
  tone?: BrandTone;
  circlePx?: number;
  dropPx?: number;
  textClass?: string;
  className?: string;
}) {
  const { circle, drop } = BRAND_TONE[tone];
  return (
    <span className={cx('flex items-center gap-2.5 font-extrabold tracking-[-0.02em]', className)}>
      <span
        className={cx('flex shrink-0 items-center justify-center rounded-full', circle)}
        style={{ width: circlePx, height: circlePx }}
      >
        <Drop size={dropPx} weight="fill" className={drop} />
      </span>
      <span className={textClass}>hydromart</span>
    </span>
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

/* ---------- Toggle ---------- (accessible on/off switch) */
export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        'flex h-[27px] w-[46px] flex-shrink-0 items-center rounded-full p-[3px] transition-colors disabled:opacity-50',
        // A12. 27px is well under the 40px anyone can reliably hit, and this is the control
        // that turns notifications and subscriptions on and off. The target is grown with a
        // pseudo-element instead of the box, so the switch looks identical and no layout
        // that already places one moves by a pixel: 27 + 2×6.5 = 40.
        'relative before:absolute before:-inset-[6.5px] before:content-[""]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        on ? 'justify-end bg-brand-600' : 'justify-start bg-[color:var(--surface-soft)]',
      )}
    >
      <span className="h-[21px] w-[21px] rounded-full bg-white shadow-card" />
    </button>
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
  const { t } = useT();
  return (
    <CenterState
      title={t('common.somethingWrong')}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    >
      {message}
    </CenterState>
  );
}

/**
 * The failure of a read that fills a CONTROL, not a page: the depot dropdown, the category
 * list, the courier picker.
 *
 * `ErrorState` is page-sized and would blank the form somebody is halfway through, so these
 * reads used to render nothing at all — and an empty select is a sentence: it says the depot
 * has no couriers. This says the list is missing instead, and offers the same read again.
 */
export function LoadError({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const { t } = useT();
  return (
    <p className={cx('text-xs text-red-600', className)}>
      {t('common.loadFailed')}{' '}
      <button type="button" onClick={onRetry} className="font-semibold underline">
        {t('common.retry')}
      </button>
    </p>
  );
}

/* ---------- Segmented ---------- */
/**
 * A pill-in-a-track switch for two or three mutually exclusive options. Extracted rather
 * than invented: this exact markup was written twice inside /account (language, theme), and
 * a third copy was about to appear for the rewards tabs.
 *
 * `aria-pressed` on each option rather than a radio group, matching what was already there —
 * these switch a view or a preference immediately, they do not stage a form value.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex gap-1 rounded-full border border-app bg-[color:var(--surface-muted)] p-[3px]',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
          aria-pressed={option.value === value}
          className={cx(
            'rounded-full px-3.5 py-[5px] text-xs font-extrabold transition-colors',
            // A12, same reasoning as Toggle: the pill stays its designed size and the tap
            // target grows past it. These sit in filter rows where the neighbours are
            // ~6px away, so the pseudo-element is kept to what closes the 40px gap without
            // two adjacent segments overlapping each other's target.
            'relative before:absolute before:-inset-y-[7px] before:-inset-x-[2px] before:content-[""]',
            option.value === value ? 'bg-brand-600 text-on-brand' : 'text-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- ListRow ---------- */
/**
 * One row of a settings-style list: icon tile, title, optional subtitle, trailing slot.
 * The shape was copy-pasted in four places before this existed, which is also why it takes
 * either an `href` or an `onClick` — half of those rows navigate and half open a sheet.
 *
 * A row with neither is a plain row, not a broken button: some of them only display.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  href,
  onClick,
  tone = 'default',
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
}) {
  const body = (
    <>
      {icon && (
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-50">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span
          className={cx(
            'block truncate text-[13.5px] font-extrabold',
            tone === 'danger' && 'text-[color:var(--danger)]',
          )}
        >
          {title}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>}
      </span>
      {trailing ?? ((href || onClick) && <CaretRight size={16} className="flex-none text-muted" />)}
    </>
  );

  const shell = 'flex w-full items-center gap-3.5 py-3.5 text-left';

  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shell}>
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}

/* ---------- StickyActionBar ---------- */
/**
 * The primary action of a screen, pinned above the fold on a phone and inline from `sm:` up.
 * Every commerce screen here puts its total and its CTA in a right-hand rail, which on a
 * phone lands at the bottom of a long scroll — permanently below the fold.
 *
 * Extracted from the product detail page, which had already solved this inline.
 *
 * The keyboard case is the reason this is a component and not a class string: Android
 * shrinks the WebView, so a bar pinned to the bottom ends up sitting on top of the keyboard,
 * over the field being typed into. Unlike the tab bar it must not disappear — the CTA is the
 * point of the screen — so it stops being sticky and rejoins the flow instead.
 */
export function StickyActionBar({
  children,
  className,
  unstickAt = 'sm',
}: {
  children: ReactNode;
  className?: string;
  /**
   * The width at which the screen has room to show the action inline again — usually `sm:`,
   * but `lg:` for a screen whose page is long enough that "inline" still means "off the
   * bottom of a tablet". Match it to where that screen's summary rail comes back.
   */
  unstickAt?: 'sm' | 'lg';
}) {
  const keyboardOpen = useKeyboardOpen();
  return (
    <div
      className={cx(
        'z-10 flex items-center gap-3.5 border-t border-app bg-[color:var(--surface)] px-4 pt-3',
        // A3+E0. The gesture bar sits under this. `env(safe-area-inset-bottom)` alone is 0
        // on a WebView older than 140, which is most of the fleet, so the bar lands under
        // the system navigation and the CTA — the entire point of the screen — is a strip
        // the thumb cannot reach. The Capacitor plugin always injects
        // `--safe-area-inset-bottom`, and nothing in apps/web read it until now. `max()`
        // keeps the ordinary 0.75rem when the inset is 0 or absent.
        'pb-[max(0.75rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]',
        '-mx-4',
        unstickAt === 'lg'
          ? 'lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pb-0'
          : 'sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pb-0',
        !keyboardOpen && 'sticky bottom-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
