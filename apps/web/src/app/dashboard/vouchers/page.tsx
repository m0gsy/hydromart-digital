'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import { Lock, Ticket } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canManageVouchers, canViewVouchers } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, DiscountType, Page, Voucher, VoucherPayload } from '@/lib/types';

const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

interface VoucherForm {
  code: string;
  description: string;
  discountType: DiscountType;
  value: string;
  minSpend: string;
  maxDiscount: string;
  validFrom: string; // yyyy-mm-dd
  validUntil: string;
  usageLimit: string;
  perCustomerLimit: string;
  active: boolean;
}

const EMPTY: VoucherForm = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  value: '',
  minSpend: '',
  maxDiscount: '',
  validFrom: '',
  validUntil: '',
  usageLimit: '',
  perCustomerLimit: '1',
  active: true,
};

function formFrom(v: Voucher): VoucherForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  const num = (n: number | null) => (n == null ? '' : String(n));
  return {
    code: v.code,
    description: v.description ?? '',
    discountType: v.discountType,
    value: String(v.value),
    minSpend: v.minSpend ? String(v.minSpend) : '',
    maxDiscount: num(v.maxDiscount),
    validFrom: day(v.validFrom),
    validUntil: day(v.validUntil),
    usageLimit: num(v.usageLimit),
    perCustomerLimit: String(v.perCustomerLimit),
    active: v.active,
  };
}

// `mode: create` omits `active` (CreateVoucherDto rejects it) and includes `code`;
// `mode: edit` sends `active` and drops `code` (the backend never patches a code).
function toPayload(f: VoucherForm, mode: 'create' | 'edit'): VoucherPayload {
  const int = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  const payload: VoucherPayload = {
    description: f.description.trim() ? f.description.trim() : null,
    discountType: f.discountType,
    value: Number(f.value),
    minSpend: int(f.minSpend) ?? 0,
    maxDiscount: f.discountType === 'PERCENTAGE' ? int(f.maxDiscount) ?? null : null,
    validFrom: dateOrNull(f.validFrom),
    validUntil: dateOrNull(f.validUntil),
    usageLimit: int(f.usageLimit) ?? null,
    perCustomerLimit: int(f.perCustomerLimit) ?? 1,
  };
  if (mode === 'create') payload.code = f.code.trim().toUpperCase();
  else payload.active = f.active;
  return payload;
}

function discountLabel(v: Voucher): string {
  if (v.discountType === 'FREE_SHIPPING') {
    const cap = v.maxDiscount ? ` (maks Rp ${v.maxDiscount.toLocaleString('id-ID')})` : '';
    return `Gratis ongkir${cap}`;
  }
  if (v.discountType === 'PERCENTAGE') {
    const cap = v.maxDiscount ? ` (maks Rp ${v.maxDiscount.toLocaleString('id-ID')})` : '';
    return `${v.value}%${cap}`;
  }
  return `Rp ${v.value.toLocaleString('id-ID')}`;
}

function VoucherEditor({
  voucher,
  onDone,
  onCancel,
}: {
  voucher: Voucher | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<VoucherForm>(voucher ? formFrom(voucher) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set =
    (k: keyof VoucherForm) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!voucher && !form.code.trim()) {
      setError(t('hrFix.vouchers.codeRequired'));
      return;
    }
    if (!form.value.trim() || Number(form.value) <= 0) {
      setError(t('hrFix.vouchers.valuePositive'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (voucher) {
        await api.patch(endpoints.vouchers.detail(voucher.id), toPayload(form, 'edit'), true);
      } else {
        await api.post(endpoints.vouchers.create, toPayload(form, 'create'), true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.vouchers.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{voucher ? `Edit ${voucher.code}` : 'Voucher baru'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {!voucher && (
          <Field label={t('hrFix.vouchers.code')} hint={t('hrFix.vouchers.codeHint')}>
            <Input value={form.code} onChange={set('code')} placeholder="HEMAT10" />
          </Field>
        )}
        <Field label={t('hrFix.vouchers.description')}>
          <Input value={form.description} onChange={set('description')} placeholder={t('hrFix.vouchers.descriptionHint')} />
        </Field>
        <Field label={t('hrFix.vouchers.discountType')}>
          <select value={form.discountType} onChange={set('discountType')} className={SELECT_CLASS}>
            <option value="PERCENTAGE">{t('hrFix.vouchers.percentage')}</option>
            <option value="FIXED">{t('hrFix.vouchers.fixedAmount')}</option>
          </select>
        </Field>
        <Field
          label={form.discountType === 'PERCENTAGE' ? t('hrFix.vouchers.valuePercent') : t('hrFix.vouchers.valueRupiah')}
          hint={form.discountType === 'PERCENTAGE' ? '1–100' : t('hrFix.vouchers.rupiahOff')}
        >
          <Input type="number" value={form.value} onChange={set('value')} placeholder="10" />
        </Field>
        {form.discountType === 'PERCENTAGE' && (
          <Field label={t('hrFix.vouchers.maxDiscount')} hint={t('hrFix.vouchers.maxDiscountHint')}>
            <Input type="number" value={form.maxDiscount} onChange={set('maxDiscount')} placeholder="20000" />
          </Field>
        )}
        <Field label={t('hrFix.vouchers.minSpend')} hint={t('hrFix.vouchers.minSpendHint')}>
          <Input type="number" value={form.minSpend} onChange={set('minSpend')} placeholder="50000" />
        </Field>
        <Field label={t('hrFix.vouchers.totalQuota')} hint={t('hrFix.vouchers.totalQuotaHint')}>
          <Input type="number" value={form.usageLimit} onChange={set('usageLimit')} placeholder="1000" />
        </Field>
        <Field label={t('hrFix.vouchers.perCustomerQuota')}>
          <Input type="number" value={form.perCustomerLimit} onChange={set('perCustomerLimit')} placeholder="1" />
        </Field>
        <Field label={t('hrFix.vouchers.validFrom')} hint={t('hrFix.vouchers.validFromHint')}>
          <Input type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('hrFix.vouchers.validUntil')} hint={t('hrFix.vouchers.validUntilHint')}>
          <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
        {voucher && (
          <Field label={t('hrFix.vouchers.active')} hint={t('hrFix.vouchers.activeHint')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              {t('hrFix.vouchers.activeVouchers')}
            </label>
          </Field>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {voucher ? t('hrFix.vouchers.save') : t('hrFix.vouchers.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('hrFix.vouchers.cancel2')}
        </Button>
      </div>
    </Card>
  );
}

function GrantPanel({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Customer | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean | null>(null); // true = granted, false = already had it

  async function search() {
    if (!phone.trim()) {
      setError(t('hrFix.vouchers.phoneRequired'));
      return;
    }
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const customer = await api.get<Customer>(endpoints.auth.customerLookup(phone.trim()), true);
      setFound(customer);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? t('hrFix.vouchers.customerNotFound')
            : err.message
          : t('hrFix.vouchers.searchFailed'),
      );
    } finally {
      setSearching(false);
    }
  }

  async function grant() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ granted: boolean }>(
        endpoints.vouchers.grant(voucher.id),
        { customerId: found.id },
        true,
      );
      setDone(res.granted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.vouchers.grantFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-brand-200 p-4">
      <h3 className="font-semibold">Beri {voucher.code} ke pelanggan</h3>
      {done !== null ? (
        <>
          <p className="text-sm text-muted">
            {done
              ? t('opsFix.vouchers.landedInWallet', { who: found?.fullName ?? found?.phone ?? t('opsFix.vouchers.aCustomer') })
              : t('hrFix.vouchers.alreadyHas')}
          </p>
          <div>
            <Button variant="ghost" onClick={onClose}>
              {t('hrFix.vouchers.close2')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field label={t('hrFix.vouchers.customerPhone')} hint={t('hrFix.vouchers.phoneHint')}>
            <div className="flex gap-2">
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFound(null);
                }}
                placeholder="081234567890"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              <Button variant="ghost" onClick={search} loading={searching}>
                {t('hrFix.vouchers.search2')}
              </Button>
            </div>
          </Field>
          {found && (
            <p className="text-sm">
              Ditemukan: <span className="font-semibold">{found.fullName ?? t('hrFix.vouchers.noName')}</span>{' '}
              <span className="text-muted">{found.phone}</span>
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={grant} loading={busy} disabled={!found}>
              Beri voucher
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('hrFix.vouchers.cancel3')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function VouchersAdmin() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const canWrite = canManageVouchers(customer?.role);
  const [editing, setEditing] = useState<Voucher | null | undefined>(undefined); // undefined closed, null new
  const [granting, setGranting] = useState<Voucher | null>(null);
  const { data, error, loading, reload } = useAsync<Page<Voucher>>(
    () => api.get<Page<Voucher>>(endpoints.vouchers.browse(), true),
    [],
  );

  if (customer && !canViewVouchers(customer.role)) {
    return (
      <CenterState icon={<Lock size={48} weight="thin" />} title={t('hrFix.vouchers.denied')}>
        {t('hrFix.vouchers.gateBody2')}
      </CenterState>
    );
  }

  // Audit F-14: a rejected deactivation used to be swallowed — the voucher stayed
  // live and the list redrew as if the click had worked.
  async function deactivate(v: Voucher) {
    try {
      await api.del(endpoints.vouchers.detail(v.id), true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.vouchers.deactivateFailed'), 'error');
    }
    reload();
  }

  const vouchers = data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Ticket size={24} weight="fill" className="text-brand-600" /> Voucher
        </h1>
        {canWrite && editing === undefined && <Button onClick={() => setEditing(null)}>{t('hrFix.vouchers.newVoucher')}</Button>}
      </div>

      {editing !== undefined && (
        <VoucherEditor
          voucher={editing}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : vouchers.length === 0 ? (
        <CenterState icon={<Ticket size={48} weight="thin" />} title={t('hrFix.vouchers.emptyTitle')}>
          {canWrite ? t('hrFix.vouchers.emptyBody') : t('hrFix.vouchers.noneCreated')}
        </CenterState>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--border)]">
          {vouchers.map((v) => (
            <div key={v.id} className="flex flex-col gap-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 font-semibold">
                    {v.code}
                    <Badge tone={v.active ? 'success' : 'neutral'}>{v.active ? 'Aktif' : t('hrFix.vouchers.inactive')}</Badge>
                  </span>
                  <span className="truncate text-sm text-muted">
                    {discountLabel(v)}
                    {v.minSpend > 0 && ` · min Rp ${v.minSpend.toLocaleString('id-ID')}`}
                    {' · '}
                    {v.usedCount}
                    {v.usageLimit != null ? `/${v.usageLimit}` : ''} terpakai
                  </span>
                </div>
                {canWrite && (
                  <>
                    <Button variant="ghost" onClick={() => setGranting(granting?.id === v.id ? null : v)}>
                      Beri
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(v)}>
                      Edit
                    </Button>
                    {v.active && (
                      <Button variant="danger" onClick={() => deactivate(v)}>
                        Nonaktifkan
                      </Button>
                    )}
                  </>
                )}
              </div>
              {granting?.id === v.id && <GrantPanel voucher={v} onClose={() => setGranting(null)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VouchersPage() {
  return (
    <RequireAuth>
      <VouchersAdmin />
    </RequireAuth>
  );
}
