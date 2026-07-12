'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bank,
  Bell,
  ChartLineUp,
  CreditCard,
  DeviceMobile,
  Gift,
  Hash,
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
import { Button, Card, Chip, ErrorState, Field, Input, CenterState, LinkButton, Skeleton } from '@/components/ui';
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
  NotificationPreferences,
  SavedPaymentMethod,
  SavedPaymentType,
} from '@/lib/types';

const APP_VERSION = '3.0.1';

const PAY_ICON: Record<SavedPaymentType, typeof Money> = {
  CASH: Money,
  TRANSFER: Bank,
  QRIS: QrCode,
  EWALLET: DeviceMobile,
  VA: Hash,
};

/* ---------- Toggle (accessible switch) ---------- */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex h-7 w-12 flex-shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        on ? 'justify-end bg-brand-600' : 'justify-start bg-[color:var(--surface-soft)]'
      }`}
    >
      <span className="h-6 w-6 rounded-full bg-white shadow-card" />
    </button>
  );
}

/* ---------- Profile ---------- */
function ProfileSection({ customer }: { customer: Customer }) {
  const { t } = useT();
  const { session, signIn } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.fullName ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<Customer>(
        endpoints.auth.updateProfile,
        { fullName: name.trim(), email: email.trim() || undefined },
        true,
      );
      if (session) signIn({ ...session, customer: updated });
      toast(t('account.profileCard.saved'), 'success');
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('account.profileCard.saveError'));
    } finally {
      setSaving(false);
    }
  }

  const rows = [
    { label: t('account.profileCard.name'), value: customer.fullName ?? '—' },
    { label: t('account.profileCard.phone'), value: customer.phone },
    { label: t('account.profileCard.email'), value: customer.email ?? t('account.profileCard.emailEmpty') },
  ];

  return (
    <Card className="p-6" >
      <div className="mb-4 flex items-center justify-between">
        <span id="profile" className="scroll-mt-20 text-lg font-extrabold">{t('account.profileCard.title')}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-full border border-app px-4 py-1.5 text-xs font-extrabold transition-colors hover:border-brand-600 hover:text-brand-700"
          >
            <PencilSimple size={14} weight="bold" />
            {t('account.profileCard.edit')}
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label={t('account.profileCard.name')} htmlFor="acc-name">
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label={`${t('account.profileCard.email')} ${t('account.profileCard.emailOptional')}`} htmlFor="acc-email" error={error ?? undefined}>
            <Input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nama@email.com" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={saving}>{t('account.profileCard.save')}</Button>
            <Button type="button" variant="secondary" onClick={() => { setEditing(false); setError(null); }} disabled={saving}>
              {t('account.profileCard.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">{r.label}</div>
              <div className="mt-1 font-bold">{r.value}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- Saved addresses (compact read + manage link) ---------- */
function AddressesSection() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Address[]>(() => api.get(endpoints.addresses.list, true));

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <span id="addresses" className="scroll-mt-20 text-lg font-extrabold">{t('account.addressesCard.title')}</span>
        <Link href="/addresses" className="text-xs font-extrabold text-brand-700 hover:underline">
          {t('account.addressesCard.manage')} →
        </Link>
      </div>
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
        <div className="grid gap-3 sm:grid-cols-2">
          {data.slice(0, 4).map((a) => (
            <div key={a.id} className="flex gap-3 rounded-xl border border-app p-3.5">
              <House size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-600" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-extrabold">
                  {a.label}
                  {a.isPrimary && <Chip tone="tint">{t('account.addressesCard.primary')}</Chip>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{a.addressLine}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
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
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <span id="payments" className="scroll-mt-20 text-lg font-extrabold">{t('account.payments.title')}</span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:underline"
        >
          <Plus size={14} weight="bold" />
          {t('account.payments.add')}
        </button>
      </div>

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
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-app p-3.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Icon size={17} weight="fill" className="text-brand-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold">
                    {m.label}
                    {m.maskedIdentifier ? ` ${m.maskedIdentifier}` : ''}
                  </div>
                </div>
                {m.isDefault ? (
                  <Chip tone="tint">{t('account.payments.default')}</Chip>
                ) : (
                  <button type="button" onClick={() => setDefault(m.id)} className="text-xs font-extrabold text-brand-700 hover:underline">
                    {t('account.payments.makeDefault')}
                  </button>
                )}
                <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs font-bold text-muted hover:text-[color:var(--danger)]">
                  {t('account.payments.delete')}
                </button>
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
    </Card>
  );
}

/* ---------- Preferences ---------- */
function PrefsSection() {
  const { t } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<NotificationPreferences>(() =>
    api.get(endpoints.preferences.notifications, true),
  );
  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  const prefs = local ?? data;

  async function toggle(key: 'push' | 'email' | 'whatsapp', value: boolean) {
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
    { key: 'email' as const, icon: Bell },
    { key: 'whatsapp' as const, icon: DeviceMobile },
  ];

  return (
    <Card className="p-6">
      <div id="prefs" className="mb-2 scroll-mt-20 text-lg font-extrabold">{t('account.prefs.title')}</div>
      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : prefs ? (
        <div className="divide-y divide-[color:var(--border)]">
          {rows.map(({ key, icon: Icon }) => (
            <div key={key} className="flex items-center gap-3.5 py-3.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <Icon size={18} weight="fill" className="text-brand-600" />
              </span>
              <div className="flex-1">
                <div className="text-sm font-extrabold">{t(`account.prefs.${key}.title`)}</div>
                <div className="mt-0.5 text-xs text-muted">{t(`account.prefs.${key}.body`)}</div>
              </div>
              <Toggle on={prefs[key]} onChange={(v) => toggle(key, v)} label={t(`account.prefs.${key}.title`)} />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/* ---------- Language ---------- */
function LanguageSection() {
  const { t, locale, toggle } = useT();
  return (
    <Card className="flex items-center gap-3.5 p-6">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
        <Translate size={18} weight="fill" className="text-brand-600" />
      </span>
      <div className="flex-1">
        <div className="text-sm font-extrabold">{t('account.language')}</div>
        <div className="mt-0.5 text-xs text-muted">{t('account.languageBody')}</div>
      </div>
      <div className="flex gap-1 rounded-full border border-app bg-[color:var(--surface-soft)] p-1">
        {(['id', 'en'] as const).map((lng) => (
          <button
            key={lng}
            type="button"
            onClick={() => { if (locale !== lng) toggle(); }}
            aria-pressed={locale === lng}
            className={`rounded-full px-3.5 py-1 text-xs font-extrabold uppercase transition-colors ${locale === lng ? 'bg-brand-600 text-on-brand' : 'text-muted'}`}
          >
            {lng}
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Page ---------- */
export default function AccountPage() {
  const { customer, ready, signOut } = useAuth();
  const { t } = useT();
  const router = useRouter();

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

  const navLinks = [
    { href: '#profile', label: t('account.nav.profile'), icon: User },
    { href: '#addresses', label: t('account.nav.addresses'), icon: MapPin },
    { href: '#payments', label: t('account.nav.payments'), icon: CreditCard },
    { href: '/orders', label: t('account.nav.orders'), icon: Receipt },
    { href: '/rewards', label: t('account.nav.rewards'), icon: Gift },
    { href: '#prefs', label: t('account.nav.prefs'), icon: Bell },
    ...(showOps ? [{ href: opsHref, label: t('account.ops'), icon: ChartLineUp }] : []),
  ];

  function logout() {
    signOut();
    router.push('/');
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('account.title')}</h1>

      {/* mobile profile header (spec 4g) */}
      <div className="flex items-center gap-3.5 rounded-2xl bg-[color:var(--text)] p-4 text-[color:var(--surface)] lg:hidden">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-extrabold text-on-brand">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{customer.fullName ?? '—'}</div>
          <div className="truncate text-xs text-[color:var(--surface)]/70">{customer.phone}</div>
        </div>
        <Link href="/rewards" className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold text-brand-300">
          <Medal size={14} weight="fill" />
          {t('account.nav.rewards')}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
        {/* desktop sidebar (spec 4f) */}
        <aside className="hidden lg:sticky lg:top-20 lg:flex lg:flex-col">
          <Card className="flex flex-col gap-1.5 p-3.5">
            <div className="mb-1.5 flex items-center gap-3 border-b border-app px-3 pb-3.5 pt-2.5">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--text)] text-lg font-extrabold text-[color:var(--surface)]">
                {initial}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold">{customer.fullName ?? '—'}</div>
                <div className="truncate text-xs text-muted">{customer.phone}</div>
              </div>
            </div>
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-[color:var(--text)] transition-colors hover:bg-[color:var(--surface-soft)]"
              >
                <Icon size={18} weight="fill" className="text-muted" />
                {label}
              </Link>
            ))}
            <button
              type="button"
              onClick={logout}
              className="mt-1.5 flex items-center gap-3 rounded-xl border-t border-app px-3 pb-1 pt-3.5 text-sm font-bold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)]"
            >
              <SignOut size={18} weight="fill" />
              {t('account.logout')}
            </button>
          </Card>
        </aside>

        {/* content */}
        <div className="flex flex-col gap-5">
          <ProfileSection customer={customer} />
          <AddressesSection />
          <PaymentsSection />
          <PrefsSection />
          <LanguageSection />

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
