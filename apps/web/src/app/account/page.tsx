'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowsClockwise,
  Bank,
  Bell,
  ChartLineUp,
  CreditCard,
  DeviceMobile,
  Gift,
  Hash,
  Headset,
  House,
  MapPin,
  Medal,
  Money,
  PencilSimple,
  Plus,
  QrCode,
  Receipt,
  SignOut,
  Translate,
  User,
} from '@phosphor-icons/react';

import { Sheet, ConfirmDialog } from '@/components/overlay';
import { Button, Chip, ErrorState, Field, Input, CenterState, LinkButton, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewDashboard, isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
  Address,
  Customer,
  LoyaltyAccount,
  NotificationPreferences,
  SavedPaymentMethod,
  SavedPaymentType,
} from '@/lib/types';

const APP_VERSION = '3.0.1';

// Shared right-column card shell (spec 4f: white, 1px border, radius 20, pad 24).
const CARD = 'surface rounded-[20px] border border-app p-6';

const PAY_ICON: Record<SavedPaymentType, typeof Money> = {
  CASH: Money,
  TRANSFER: Bank,
  QRIS: QrCode,
  EWALLET: DeviceMobile,
  VA: Hash,
};

/* ---------- Toggle (accessible switch, spec 46×27) ---------- */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex h-[27px] w-[46px] flex-shrink-0 items-center rounded-full p-[3px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        on ? 'justify-end bg-brand-600' : 'justify-start bg-[#dcdad2] dark:bg-[color:var(--surface-soft)]'
      }`}
    >
      <span className="h-[21px] w-[21px] rounded-full bg-white shadow-card" />
    </button>
  );
}

/* ---------- Section header (title + trailing action) ---------- */
function CardHead({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 id={id} className="scroll-mt-24 text-[17px] font-extrabold">{title}</h2>
      {action}
    </div>
  );
}

/* ---------- Profile (read-only; full editing incl. photo lives at /account/edit) ---------- */
function ProfileSection({ customer }: { customer: Customer }) {
  const { t, locale } = useT();

  const memberSince = new Date(customer.createdAt).toLocaleDateString(
    locale === 'en' ? 'en-US' : 'id-ID',
    { month: 'short', year: 'numeric' },
  );

  const rows = [
    { label: t('account.profileCard.name'), value: customer.fullName ?? '—' },
    { label: t('account.profileCard.phone'), value: customer.phone },
    { label: t('account.profileCard.email'), value: customer.email ?? t('account.profileCard.emailEmpty') },
    { label: locale === 'en' ? 'Member since' : 'Member sejak', value: memberSince },
  ];

  return (
    <section className={CARD}>
      <CardHead
        id="profile"
        title={t('account.profileCard.title')}
        action={
          <Link
            href="/account/edit"
            className="flex items-center gap-1.5 rounded-full border border-app px-4 py-1.5 text-xs font-extrabold transition-colors hover:border-brand-600 hover:text-brand-700"
          >
            <PencilSimple size={14} weight="bold" />
            {t('account.profileCard.edit')}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-x-7 gap-y-[18px]">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">{r.label}</div>
            <div className="mt-1 truncate text-[14.5px] font-bold">{r.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Saved addresses (compact read + manage at /addresses) ---------- */
function AddressesSection() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Address[]>(() => api.get(endpoints.addresses.list, true));

  return (
    <section className={CARD}>
      <CardHead
        id="addresses"
        title={t('account.addressesCard.title')}
        action={
          <Link href="/addresses" className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:underline">
            <Plus size={14} weight="bold" />
            {t('account.addressesCard.add')}
          </Link>
        }
      />
      {loading ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">{t('account.addressesCard.empty')}</p>
          <LinkButton href="/addresses" variant="secondary">{t('account.addressesCard.add')}</LinkButton>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {data.map((a) => (
            <div key={a.id} className="flex gap-3 rounded-[16px] border border-app px-4 py-[15px]">
              <House size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-extrabold">
                  <span className="truncate">{a.label}</span>
                  {a.isPrimary && <Chip tone="tint">{t('account.addressesCard.primary')}</Chip>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{a.addressLine}</div>
                <div className="mt-2 flex items-center gap-4">
                  <Link href="/addresses" className="text-xs font-extrabold text-brand-700 hover:underline">
                    {t('account.profileCard.edit')}
                  </Link>
                  <Link href="/addresses" className="text-xs font-bold text-muted hover:text-[color:var(--danger)]">
                    {t('account.payments.delete')}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Payment methods ---------- */
const PAY_TYPES: SavedPaymentType[] = ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'];

function PaymentsSection() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<SavedPaymentMethod[]>(() =>
    api.get(endpoints.paymentMethods.list, true),
  );
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SavedPaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);

  // add-form state
  const [type, setType] = useState<SavedPaymentType>('EWALLET');
  const [label, setLabel] = useState('');
  const [masked, setMasked] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post(endpoints.paymentMethods.create, { type, label: label.trim(), maskedIdentifier: masked.trim() || undefined }, true);
      setAdding(false);
      setLabel('');
      setMasked('');
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('account.payments.addError'));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    await api.post(endpoints.paymentMethods.default(id), {}, true);
    reload();
  }

  async function remove() {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await api.del(endpoints.paymentMethods.detail(removeTarget.id), true);
      setRemoveTarget(null);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <CardHead
        id="payments"
        title={t('account.payments.title')}
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:underline"
          >
            <Plus size={14} weight="bold" />
            {t('account.payments.add')}
          </button>
        }
      />

      {loading ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted">{t('account.payments.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {data.map((m) => {
            const Icon = PAY_ICON[m.type];
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-[14px] border border-app px-[15px] py-[13px]">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Icon size={18} weight="fill" className="text-brand-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-extrabold">{m.label}</div>
                  {m.maskedIdentifier && (
                    <div className="mt-0.5 truncate text-[11.5px] text-muted">{m.maskedIdentifier}</div>
                  )}
                </div>
                {m.isDefault ? (
                  <Chip tone="tint">{t('account.payments.default')}</Chip>
                ) : (
                  <>
                    <button type="button" onClick={() => setDefault(m.id)} className="text-xs font-extrabold text-brand-700 hover:underline">
                      {t('account.payments.makeDefault')}
                    </button>
                    <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs font-bold text-muted hover:text-[color:var(--danger)]">
                      {t('account.payments.delete')}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('account.payments.sheetTitle')}>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Field label={t('account.payments.type')} htmlFor="pm-type">
            <div className="flex flex-wrap gap-2">
              {PAY_TYPES.map((ty) => {
                const Icon = PAY_ICON[ty];
                const active = ty === type;
                return (
                  <button
                    key={ty}
                    type="button"
                    onClick={() => setType(ty)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-extrabold transition-colors ${active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted'}`}
                  >
                    <Icon size={14} weight="fill" />
                    {ty}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t('account.payments.label')} hint={t('account.payments.labelHint')} htmlFor="pm-label">
            <Input id="pm-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label={t('account.payments.masked')} hint={t('account.payments.maskedHint')} htmlFor="pm-masked" error={formError ?? undefined}>
            <Input id="pm-masked" value={masked} onChange={(e) => setMasked(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} disabled={!label.trim()}>{t('account.payments.save')}</Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('account.payments.delete')}
        message={removeTarget?.label ?? ''}
        confirmLabel={t('account.payments.delete')}
        loading={busy}
        onConfirm={remove}
        onClose={() => setRemoveTarget(null)}
      />
    </section>
  );
}

/* ---------- Preferences (notifications + language) ---------- */
function PrefsSection() {
  const { t, locale, toggle } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<NotificationPreferences>(() =>
    api.get(endpoints.preferences.notifications, true),
  );
  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  const prefs = local ?? data;

  async function togglePref(key: 'push' | 'email' | 'whatsapp', value: boolean) {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setLocal(next); // optimistic
    try {
      await api.patch(endpoints.preferences.notifications, { [key]: value }, true);
    } catch {
      setLocal(prefs); // revert
      toast(t('account.prefs.saveError'), 'error');
    }
  }

  const rows = [
    { key: 'push' as const, icon: Bell },
    { key: 'email' as const, icon: Gift },
    { key: 'whatsapp' as const, icon: DeviceMobile },
  ];

  const rowShell = 'flex items-center gap-3.5 border-b border-[color:var(--border-soft)] py-3.5';
  const tileIcon = 'flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-xl bg-brand-50';

  return (
    <section className={CARD}>
      <h2 id="prefs" className="mb-2 scroll-mt-24 text-[17px] font-extrabold">{t('account.prefs.title')}</h2>
      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : prefs ? (
        <div>
          {rows.map(({ key, icon: Icon }) => (
            <div key={key} className={rowShell}>
              <span className={tileIcon}>
                <Icon size={18} weight="fill" className="text-brand-600" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold">{t(`account.prefs.${key}.title`)}</div>
                <div className="mt-0.5 text-xs text-muted">{t(`account.prefs.${key}.body`)}</div>
              </div>
              <Toggle on={prefs[key]} onChange={(v) => togglePref(key, v)} label={t(`account.prefs.${key}.title`)} />
            </div>
          ))}

          {/* Language (spec 4f: segmented ID/EN as the last preference row) */}
          <div className="flex items-center gap-3.5 py-3.5">
            <span className={tileIcon}>
              <Translate size={18} weight="fill" className="text-brand-600" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-extrabold">{t('account.language')}</div>
              <div className="mt-0.5 text-xs text-muted">{t('account.languageBody')}</div>
            </div>
            <div className="flex gap-1 rounded-full border border-app bg-[color:var(--surface-muted)] p-[3px]">
              {(['id', 'en'] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => { if (locale !== lng) toggle(); }}
                  aria-pressed={locale === lng}
                  className={`rounded-full px-3.5 py-[5px] text-xs font-extrabold uppercase transition-colors ${locale === lng ? 'bg-brand-600 text-on-brand' : 'text-muted'}`}
                >
                  {lng}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Page ---------- */
export default function AccountPage() {
  const { customer, ready, signOut } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const { data: loyalty } = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));

  if (ready && !customer) {
    return (
      <CenterState
        icon={<Receipt size={40} weight="duotone" />}
        title={t('account.guestTitle')}
        action={<LinkButton href="/login">{t('nav.signIn')}</LinkButton>}
      >
        {t('account.guestBody')}
      </CenterState>
    );
  }
  if (!customer) return null;

  const initial = customer.fullName?.trim()?.[0]?.toUpperCase() ?? '?';
  const opsHref = canViewDashboard(customer.role) ? '/dashboard' : '/dashboard/orders';
  const showOps = isStaff(customer.role);
  const tier = loyalty?.tier;
  const memberSub = tier ? `${tier.charAt(0)}${tier.slice(1).toLowerCase()} member` : customer.phone;

  const navLinks = [
    { href: '#profile', label: t('account.nav.profile'), icon: User, active: true },
    { href: '#addresses', label: t('account.nav.addresses'), icon: MapPin, active: false },
    { href: '#payments', label: t('account.nav.payments'), icon: CreditCard, active: false },
    { href: '/orders', label: t('account.nav.orders'), icon: Receipt, active: false },
    { href: '/rewards', label: t('account.nav.rewards'), icon: Medal, active: false },
    { href: '/subscriptions', label: t('subscriptions.title'), icon: ArrowsClockwise, active: false },
    { href: '/referral', label: t('account.nav.referral'), icon: Gift, active: false },
    { href: '#prefs', label: t('account.nav.prefs'), icon: Bell, active: false },
    { href: '/help', label: t('help.title'), icon: Headset, active: false },
    ...(showOps ? [{ href: opsHref, label: t('account.ops'), icon: ChartLineUp, active: false }] : []),
  ];

  function logout() {
    signOut();
    router.push('/');
  }

  return (
    <div>
      <h1 className="mb-5 text-[28px] font-extrabold tracking-[-0.03em]">{t('account.title')}</h1>

      <div className="grid gap-5 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
        {/* desktop sidebar (spec 4f) */}
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <div className="surface flex flex-col gap-1.5 rounded-[20px] border border-app p-3.5">
            <div className="mb-1.5 flex items-center gap-3 border-b border-[color:var(--border-soft)] px-3 pb-3.5 pt-2.5">
              <span className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--text)] text-lg font-extrabold text-[color:var(--surface)]">
                {initial}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-extrabold">{customer.fullName ?? '—'}</div>
                <div className="truncate text-xs text-muted">{memberSub}</div>
              </div>
            </div>
            {navLinks.map(({ href, label, icon: Icon, active }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-[13px] py-[11px] text-[13.5px] transition-colors ${
                  active
                    ? 'bg-brand-50 font-extrabold text-brand-800'
                    : 'font-bold text-[#3d565e] hover:bg-[color:var(--surface-muted)] dark:text-[color:var(--text)]'
                }`}
              >
                <Icon size={18} weight="fill" className={active ? 'text-brand-800' : 'text-muted'} />
                {label}
              </Link>
            ))}
            <button
              type="button"
              onClick={logout}
              className="mt-1.5 flex items-center gap-3 rounded-xl border-t border-app px-[13px] pb-1 pt-3.5 text-[13.5px] font-bold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)]"
            >
              <SignOut size={18} />
              {t('account.logout')}
            </button>
          </div>
        </aside>

        {/* content column (spec 4f: gap 16px) */}
        <div className="flex flex-col gap-4">
          {/* mobile profile header (spec 4g) */}
          <div className="flex items-center gap-3.5 rounded-2xl bg-[color:var(--text)] p-4 text-[color:var(--surface)] lg:hidden">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-extrabold text-on-brand">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold">{customer.fullName ?? '—'}</div>
              <div className="truncate text-xs text-[color:var(--surface)]/70">{memberSub}</div>
            </div>
            <Link href="/rewards" className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold text-brand-300">
              <Medal size={14} weight="fill" />
              {t('account.nav.rewards')}
            </Link>
            <Link href="/vouchers" className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold text-brand-300">
              <Gift size={14} weight="fill" />
              {t('profile.rewards.wallet.title')}
            </Link>
          </div>

          <ProfileSection customer={customer} />
          <AddressesSection />
          <PaymentsSection />
          <PrefsSection />

          {/* mobile logout + version */}
          <button
            type="button"
            onClick={logout}
            className="flex items-center justify-center gap-2 rounded-2xl border border-[color:var(--danger-bg)] surface p-4 text-sm font-extrabold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)] lg:hidden"
          >
            <SignOut size={17} weight="fill" />
            {t('account.logout')}
          </button>
          <p className="text-center text-xs font-medium text-muted">{t('account.version', { v: APP_VERSION })}</p>
        </div>
      </div>
    </div>
  );
}
