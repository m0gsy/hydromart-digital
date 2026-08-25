'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowsClockwise,
  Bank,
  Bell,
  ChartLineUp,
  ClipboardText,
  CreditCard,
  DeviceMobile,
  FileText,
  Gift,
  Megaphone,
  Hash,
  Headset,
  Heart,
  MapPin,
  Medal,
  Money,
  Moon,
  PencilSimple,
  Plus,
  QrCode,
  Receipt,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  Storefront,
  Translate,
  TrashSimple,
} from '@phosphor-icons/react';

import { Sheet, ConfirmDialog } from '@/components/overlay';
import { GallonDepositCard } from '@/components/gallon-deposit-card';
import {
  Button,
  Chip,
  ErrorState,
  Field,
  Input,
  CenterState,
  LinkButton,
  ListRow,
  Segmented,
  Skeleton,
  Toggle,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { useTheme } from '@/lib/theme-context';
import { canViewDashboard, isStaff } from '@/lib/roles';
import { getPushState, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import type { PushState } from '@/lib/push';
import { useAsync } from '@/lib/use-async';
import { formatDateTime } from '@/lib/format';
import type {
  Customer,
  ConsentState,
  DataSubjectRequest,
  DataSubjectRequestType,
  LoyaltyAccount,
  NotificationPreferences,
  SavedPaymentMethod,
  SavedPaymentType,
} from '@/lib/types';

// Hardcoding this meant the number on the screen was whoever last remembered to bump
// it, and support has no way to tell which build a user is actually on. Baked at build
// time from the release tag (see apps/web/Dockerfile); `dev` on a local run.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

/** A group of rows reads as one card; the divider is what separates the rows inside it. */
const GROUP = 'surface divide-y divide-[color:var(--border-soft)] rounded-2xl border border-app px-4';

const ROW_ICON = 'text-brand-600';

const PAY_ICON: Record<SavedPaymentType, typeof Money> = {
  CASH: Money,
  TRANSFER: Bank,
  QRIS: QrCode,
  EWALLET: DeviceMobile,
  VA: Hash,
};

/* ---------- Payment methods (sheet body) ---------- */
const PAY_TYPES: SavedPaymentType[] = ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'];

function PaymentsBody() {
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
    <div className="flex flex-col gap-4">
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
                  <Icon size={18} weight="fill" className={ROW_ICON} />
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

      {/* The add form expands in place. It used to be a sheet of its own, and a sheet inside
          a sheet gives the hardware back button two things to close at once. */}
      {adding ? (
        <form onSubmit={add} className="flex flex-col gap-4 rounded-2xl border border-app p-4">
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
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={14} weight="bold" />
          {t('account.payments.add')}
        </Button>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('account.payments.delete')}
        message={removeTarget?.label ?? ''}
        confirmLabel={t('account.payments.delete')}
        loading={busy}
        onConfirm={remove}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

/* ---------- Personal data (sheet body) ---------- */
/**
 * UU PDP tahap 1 (item 13). The two rights that shipped first: ask for a copy, ask to be
 * deleted. Neither runs on the click — head office decides, so this is a request form
 * plus the state of what was asked, not a self-service delete button.
 */
function PrivacyDataBody() {
  const { t } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<DataSubjectRequest[]>(() =>
    api.get(endpoints.pdp.mine, true),
  );
  const [pending, setPending] = useState<DataSubjectRequestType | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function submit(type: DataSubjectRequestType) {
    setPending(type);
    try {
      await api.post(endpoints.pdp.request, { type }, true);
      toast(t('account.privacyData.submitted'), 'success');
      reload();
    } catch (err) {
      // A duplicate open request comes back with its own message; show it verbatim.
      toast(err instanceof ApiError ? err.message : t('account.privacyData.submitError'), 'error');
    } finally {
      setPending(null);
      setConfirmDelete(false);
    }
  }

  async function download() {
    try {
      const payload = await api.get<unknown>(endpoints.pdp.myExport, true);
      downloadBlob(
        'hydromart-data.json',
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      );
    } catch {
      toast(t('account.privacyData.downloadError'), 'error');
    }
  }

  const completedExport = (data ?? []).some((r) => r.type === 'EXPORT' && r.status === 'COMPLETED');

  return (
    <div>
      <p className="mb-3 text-sm text-muted">{t('account.privacyData.body')}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={pending === 'EXPORT'}
          onClick={() => submit('EXPORT')}
        >
          {t('account.privacyData.requestExport')}
        </Button>
        <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
          {t('account.privacyData.requestDelete')}
        </Button>
        {completedExport && (
          <Button variant="secondary" onClick={download}>
            {t('account.privacyData.download')}
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-16 w-full rounded-xl" />
      ) : error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : (data ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('account.privacyData.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[color:var(--border-soft)]">
          {(data ?? []).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="block font-semibold">{t(`account.privacyData.type.${row.type}`)}</span>
                <span className="block text-xs text-muted">{formatDateTime(row.requestedAt)}</span>
                {row.status === 'REJECTED' && row.reason && (
                  <span className="block text-xs text-[color:var(--danger)]">{row.reason}</span>
                )}
              </span>
              <Chip tone="outline">{t(`account.privacyData.status.${row.status}`)}</Chip>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('account.privacyData.requestDelete')}
        message={t('account.privacyData.deleteConfirm')}
        confirmLabel={t('account.privacyData.requestDelete')}
        loading={pending === 'DELETE'}
        onConfirm={() => submit('DELETE')}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/* ---------- Consents (sheet body) ---------- */
/**
 * UU PDP tahap 2 — the consent ledger. Mandatory purposes are shown but not switchable:
 * hiding them would leave the customer unable to see what they are held to, and offering
 * a switch the server refuses would be a lie in the UI.
 */
function ConsentBody() {
  const { t } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<ConsentState[]>(() =>
    api.get(endpoints.pdp.consents, true),
  );
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(row: ConsentState, granted: boolean) {
    setPending(row.purpose);
    try {
      await api.put(endpoints.pdp.consents, { purpose: row.purpose, granted }, true);
      toast(t('account.consents.saved'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('account.consents.saveError'), 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <p className="mb-1 text-sm text-muted">{t('account.consents.body')}</p>
      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="divide-y divide-[color:var(--border-soft)]">
          {(data ?? []).map((row) => (
            <ListRow
              key={row.purpose}
              title={t(`account.consents.purpose.${row.purpose}`)}
              subtitle={
                row.decidedAt
                  ? t('account.consents.since', {
                      date: formatDateTime(row.decidedAt).split(',')[0] ?? '',
                    })
                  : t('account.consents.never')
              }
              trailing={
                row.withdrawable ? (
                  <Toggle
                    on={row.granted}
                    disabled={pending === row.purpose}
                    onChange={(v) => toggle(row, v)}
                    label={t(`account.consents.purpose.${row.purpose}`)}
                  />
                ) : (
                  <Chip tone="tint">{t('account.consents.mandatory')}</Chip>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Preferences (sheet body): notifications + language + theme ---------- */
function PrefsBody() {
  const { t, locale, toggle } = useT();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<NotificationPreferences>(() =>
    api.get(endpoints.preferences.notifications, true),
  );
  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  const prefs = local ?? data;

  /*
   * F6. This switch wrote a preference row and did NOTHING else — it never asked the OS for
   * permission and never registered the device. The only place the app ever asks is
   * `requestPushOnce`, after a first order. So a customer who had not ordered yet could
   * turn this on, watch it stay on, and never receive a single notification for as long as
   * they kept the app.
   *
   * The switch is the device's real state now. The stored preference still matters — crm
   * reads it before every push — but it is the second half, not the whole thing, and when
   * the two disagree the device is the one telling the truth.
   */
  const [pushState, setPushState] = useState<PushState | null>(null);
  useEffect(() => {
    let alive = true;
    void getPushState().then((s) => alive && setPushState(s));
    return () => {
      alive = false;
    };
  }, []);
  const pushOn = pushState === 'subscribed';
  const pushImpossible = pushState === 'unsupported';

  async function togglePush(value: boolean) {
    if (!prefs) return;
    const before = pushState;
    setPushState(value ? 'subscribed' : 'unsubscribed'); // optimistic
    try {
      const next = value ? await subscribeToPush() : await unsubscribeFromPush();
      setPushState(next);
      if (value && next !== 'subscribed') {
        // Granted-and-registered is the only "on" there is. Anything else must not read as
        // on, and must say which wall was hit — the OS dialog is not coming back by itself.
        toast(t(next === 'denied' ? 'account.prefs.push.denied' : 'account.prefs.push.failed'), 'error');
        return;
      }
      // The preference row follows the device, so crm's own check agrees with what the
      // customer just did. A failure here costs the preference, never the subscription.
      setLocal({ ...prefs, push: value });
      await api.patch(endpoints.preferences.notifications, { push: value }, true);
    } catch {
      setPushState(before);
      setLocal(prefs);
      toast(t('account.prefs.saveError'), 'error');
    }
  }

  /**
   * F1b: the marketing opt-out.
   *
   * Promotional broadcasts go to existing customers who were never offered the checkbox at
   * signup, because the consent ledger writes no row for somebody never asked and filtering
   * to consent-granted-only would empty the audience rather than narrow it. That position
   * only holds up if leaving is one tap, and this is the tap.
   *
   * Stored under `categories` — the jsonb map already on the record — so there is no
   * migration. Absent means ON, which is the same "never asked is not a refusal" rule the
   * rest of the system runs on.
   */
  const marketingOn = prefs?.categories?.marketing !== false;

  async function toggleMarketing(value: boolean) {
    if (!prefs) return;
    const next = { ...prefs, categories: { ...prefs.categories, marketing: value } };
    setLocal(next); // optimistic
    try {
      await api.patch(endpoints.preferences.notifications, { categories: { marketing: value } }, true);
    } catch {
      setLocal(prefs); // revert
      toast(t('account.prefs.saveError'), 'error');
    }
  }

  // F1: `email` and `whatsapp` were switches for two channels that exist nowhere in this
  // repo — crm sends the in-app inbox row and Web Push, and nothing else. Turning one off
  // stopped nothing because nothing was being sent; turning it on promised a channel that
  // could never arrive. The stored fields are left alone: removing a column is a migration
  // for no gain, and a control nobody can see cannot mislead anybody.

  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!prefs) return null;

  return (
    <div className="divide-y divide-[color:var(--border-soft)]">
      <ListRow
        icon={<Bell size={18} weight="fill" className={ROW_ICON} />}
        title={t('account.prefs.push.title')}
        subtitle={t(pushImpossible ? 'account.prefs.push.unsupported' : 'account.prefs.push.body')}
        trailing={
          <Toggle
            on={pushOn}
            disabled={pushState === null || pushImpossible}
            onChange={togglePush}
            label={t('account.prefs.push.title')}
          />
        }
      />

      <ListRow
        icon={<Megaphone size={18} weight="fill" className={ROW_ICON} />}
        title={t('account.prefs.marketing.title')}
        subtitle={t('account.prefs.marketing.body')}
        trailing={
          <Toggle
            on={marketingOn}
            onChange={toggleMarketing}
            label={t('account.prefs.marketing.title')}
          />
        }
      />

      <ListRow
        icon={<Translate size={18} weight="fill" className={ROW_ICON} />}
        title={t('account.language')}
        subtitle={t('account.languageBody')}
        trailing={
          <Segmented
            value={locale}
            onChange={() => toggle()}
            className="uppercase"
            options={[
              { value: 'id', label: 'id' },
              { value: 'en', label: 'en' },
            ]}
          />
        }
      />

      {/* Theme (light / dark / follow system) — provider already app-wide, this is the customer toggle */}
      <ListRow
        icon={<Moon size={18} weight="fill" className={ROW_ICON} />}
        title={t('account.theme')}
        subtitle={t('account.themeBody')}
        trailing={
          <Segmented
            value={theme}
            onChange={setTheme}
            options={(['light', 'dark', 'system'] as const).map((th) => ({
              value: th,
              label: t(`account.theme_${th}`),
            }))}
          />
        }
      />
    </div>
  );
}

/* ---------- The four settings that have no route of their own ---------- */
type SheetKey = 'payments' | 'prefs' | 'privacyData' | 'consents';

const SHEETS = [
  { key: 'payments', titleKey: 'account.payments.title', icon: CreditCard, Body: PaymentsBody },
  { key: 'prefs', titleKey: 'account.prefs.title', icon: SlidersHorizontal, Body: PrefsBody },
  { key: 'privacyData', titleKey: 'account.privacyData.title', icon: ShieldCheck, Body: PrivacyDataBody },
  { key: 'consents', titleKey: 'account.consents.title', icon: ClipboardText, Body: ConsentBody },
] as const satisfies readonly { key: SheetKey; titleKey: string; icon: typeof Money; Body: () => React.ReactNode }[];

/* ---------- Profile card ---------- */
function ProfileCard({ customer, subtitle }: { customer: Customer; subtitle: string }) {
  const { t } = useT();
  const initial = customer.fullName?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex items-center gap-3.5 rounded-2xl bg-[color:var(--text)] p-4 text-[color:var(--surface)]">
      <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-extrabold text-on-brand">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold">{customer.fullName ?? '—'}</div>
        <div className="truncate text-xs text-[color:var(--surface)]/70">{subtitle}</div>
      </div>
      <Link
        href="/account/edit"
        className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-extrabold text-brand-300"
      >
        <PencilSimple size={14} weight="bold" />
        {t('account.profileCard.edit')}
      </Link>
    </div>
  );
}

/* ---------- Page ---------- */
export default function AccountPage() {
  const { customer, ready, signOut } = useAuth();
  const { t } = useT();
  const router = useRouter();
  /*
   * H15. This said "global on purpose: the customer's card across the network, not their
   * standing at one depot" — and the home teaser said the opposite, scoping the same read
   * to the shopper's depot. Two deliberate choices, one account, two answers.
   *
   * Resolved toward the depot: the tier badge on this screen sits next to a discount the
   * customer will be charged at checkout, and checkout prices at the depot. A card that
   * names a network tier the local depot does not honour is a promise the till breaks.
   */
  const { location } = useLocation();
  const depotId = location?.depotId ?? null;
  /*
   * K1.3: a staff account has no loyalty account — the read answered for nobody and its
   * tier decorated a screen that should not have been showing shop rows in the first
   * place. `null` keeps `useAsync` from firing at all rather than firing and discarding.
   */
  const staff = isStaff(customer?.role);
  const { data: loyalty } = useAsync<LoyaltyAccount>(
    () => (staff ? Promise.resolve(null as never) : api.get(endpoints.loyalty.me(depotId), true)),
    [depotId, staff],
  );
  const [sheet, setSheet] = useState<SheetKey | null>(null);

  if (ready && !customer) {
    return (
      <CenterState
        icon={<Receipt size={40} weight="duotone" />}
        title={t('account.guestTitle')}
        /*
         * H7. This was a bare `/login`, so signing in from the account screen landed the
         * customer in the CATALOGUE — the one screen they had just navigated away from.
         * Every other sign-in door in the app already carries `?next=`; this one did not.
         */
        action={
          <div className="flex flex-col items-center gap-2">
            <LinkButton href={`/login?next=${encodeURIComponent('/account')}`}>{t('nav.signIn')}</LinkButton>
            {/*
              H5 (absorbed by K1.5). `/help` is linked from exactly two places: this screen,
              which a guest never gets past, and the footer, which is `hidden ... sm:block`.
              So on a phone, a person who is not signed in has no route to the help page at
              all — and the help page is where the depot's number is. The one audience most
              likely to need it was the one audience that could not reach it.
            */}
            <LinkButton href="/help" variant="secondary">
              {t('help.title')}
            </LinkButton>
          </div>
        }
      >
        {t('account.guestBody')}
      </CenterState>
    );
  }
  /*
   * H6. This was `return null`, and it ran for the WHOLE window between mount and `ready`
   * — so /account was a blank page while auth settled. That window is not instant on the
   * device this ships to: a cold start waits on the biometric unlock, several seconds of
   * a screen saying nothing at all, which reads as a crash rather than as loading.
   *
   * Skeletons rather than a spinner, in the shape of what is about to arrive, so the
   * layout does not jump when it does.
   */
  if (!customer) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label={t('account.title')}>
        <Skeleton className="h-[76px] w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const opsHref = canViewDashboard(customer.role) ? '/dashboard' : '/dashboard/orders';
  const showOps = isStaff(customer.role);
  const tier = loyalty?.tier;
  const memberSub = tier ? `${tier.charAt(0)}${tier.slice(1).toLowerCase()} member` : customer.phone;

  // One list, two presentations: rows below `lg:`, the sidebar above it. Two arrays would
  // drift the first time a destination is added.
  /*
   * K1.3: two menus, not one. A courier or an operator was handed rewards, vouchers,
   * favourites, subscriptions, referral and the franchise application — none of which a
   * staff account can use — while the one row they came for sat at the bottom. Everything
   * in `shopLinks` belongs to a shopping account; everything below it belongs to anyone.
   */
  const shopLinks = [
    { href: '/orders', label: t('account.nav.orders'), icon: Receipt },
    { href: '/addresses', label: t('account.nav.addresses'), icon: MapPin },
    { href: '/rewards', label: t('account.nav.rewards'), icon: Medal },
    { href: '/vouchers', label: t('profile.rewards.wallet.title'), icon: Gift },
    { href: '/favorites', label: t('account.nav.favorites'), icon: Heart },
    { href: '/subscriptions', label: t('subscriptions.title'), icon: ArrowsClockwise },
    { href: '/referral', label: t('account.nav.referral'), icon: Gift },
    /*
     * H3. `/waralaba` is a real franchise application form whose only way in was the
     * desktop footer — `hidden ... sm:block` — so on a phone, and therefore inside both
     * APKs, the form did not exist. The privacy policy and the deletion page already
     * moved here for exactly this reason; this one was missed.
     */
    { href: '/waralaba', label: t('franchise.navLabel'), icon: Storefront },
  ];
  const links = [
    ...(showOps ? [] : shopLinks),
    // Both audiences keep these: a staff member needs the depot's number and their own
    // notification inbox exactly as much as a customer does.
    { href: '/notifications', label: t('notifications.title'), icon: Bell },
    { href: '/help', label: t('help.title'), icon: Headset },
    ...(showOps ? [{ href: opsHref, label: t('account.ops'), icon: ChartLineUp }] : []),
  ];

  function logout() {
    signOut();
    router.push('/');
  }

  return (
    <div>
      {/* Below `sm:` the app bar carries this title, so rendering it here as well would show
          it twice. Above `sm:` the app bar is gone and the page owns its heading again. */}
      <h1 className="mb-5 hidden text-[28px] font-extrabold tracking-[-0.03em] sm:block">{t('account.title')}</h1>

      <div className="grid gap-5 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
        {/* desktop sidebar (spec 4f) */}
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <div className="surface flex flex-col gap-1.5 rounded-[20px] border border-app p-3.5">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center gap-3 rounded-xl px-[13px] py-[11px] text-[13.5px] font-bold text-[#3d565e] transition-colors hover:bg-[color:var(--surface-muted)] dark:text-[color:var(--text)]"
              >
                <Icon size={18} weight="fill" className="text-muted" />
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

        <div className="flex flex-col gap-4">
          <ProfileCard customer={customer} subtitle={memberSub} />

          <GallonDepositCard />

          <div className={`${GROUP} lg:hidden`}>
            {links.map(({ href, label, icon: Icon }) => (
              <ListRow
                key={label}
                href={href}
                title={label}
                icon={<Icon size={18} weight="fill" className={ROW_ICON} />}
              />
            ))}
          </div>

          <div className={GROUP}>
            {SHEETS.map(({ key, titleKey, icon: Icon }) => (
              <ListRow
                key={key}
                title={t(titleKey)}
                icon={<Icon size={18} weight="fill" className={ROW_ICON} />}
                onClick={() => setSheet(key)}
              />
            ))}
          </div>

          {/* The footer is hidden below `sm:`, and these two links cannot go with it: Play
              requires the account-deletion page to be reachable from inside the app, and the
              privacy policy is the other half of the same obligation. */}
          <div className={GROUP}>
            <ListRow
              href="/kebijakan-privasi"
              title={t('privacy.title')}
              icon={<FileText size={18} weight="fill" className={ROW_ICON} />}
            />
            <ListRow
              href="/hapus-akun"
              tone="danger"
              title={t('deleteAccount.navLabel')}
              icon={<TrashSimple size={18} weight="fill" className="text-[color:var(--danger)]" />}
            />
          </div>

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

      {/* Bodies mount with their sheet, so opening /account is one request now, not five. */}
      {SHEETS.map(({ key, titleKey, Body }) => (
        <Sheet key={key} open={sheet === key} onClose={() => setSheet(null)} title={t(titleKey)}>
          <Body />
        </Sheet>
      ))}
    </div>
  );
}
