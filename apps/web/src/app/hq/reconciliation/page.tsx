'use client';

import { useMemo, useState } from 'react';
import { Scales, DownloadSimple } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { fetchSettingsSchema, type SettingsSchema } from '@/lib/settings';
import { useAsync } from '@/lib/use-async';
import { downloadXlsx } from '@/lib/xlsx';
import type { CommissionScheme, GallonOutstanding, NetworkDashboard } from '@/lib/types';

interface ShippingByDepot {
  items: { depotId: string; shippingBilled: number }[];
}

interface RefundsByDepot {
  items: { depotId: string; refunded: number }[];
}

/**
 * A money row's label with its own rate appended — "Komisi waralaba (25%)".
 *
 * Both dictionary strings used to CARRY a percent of their own ("Komisi waralaba (20%)",
 * "Biaya platform (5%)") while the code appended the real one, so the screen read
 * "Komisi waralaba (20%) (25%)" — the hardcoded 20% a code comment three lines away
 * claimed to have removed, still printed, right beside the rate actually being billed.
 * The percent belongs to the number, not to the translation.
 *
 * A null rate prints the bare label: the row beside it is already showing "—", and
 * "(null%)" would be worse than saying nothing about a rate nobody could read.
 */
const pctLabel = (label: string, pct: number | null) =>
  pct == null ? label : `${label} (${pct}%)`;

const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

// Trailing-30-day window, computed once per mount (client-only, no module-scope Date).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22a — Rekonsiliasi keuangan per depot. Total penjualan (network roll-up, per depot),
// ongkir (order shipping-by-depot), refunds (order refunds-by-depot, fed by payment-service
// coordination) and gallon deposit (depot gallon-outstanding netDeposit) are all real;
// the franchise commission comes from the depot's own scheme, and the platform fee now comes
// from payout-service's settings slice. No number on this statement is invented any more.
export default function HqReconciliationPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const range = useMemo(defaultRange, []);

  /*
   * CA-2-10. Two ceilings stacked on one screen, and the second one was the money.
   *
   * The depot picker listed 100 depots, so past the hundredth there was no statement to
   * open at all. Worse, `sales` came from `dashboard.executive`, whose `topDepots` is a
   * TOP-TEN report (`DashboardService.TOP_LIMIT = 10`): every depot outside the ten highest-
   * earning in the network found itself with `sales = null`, so its commission, its platform
   * fee and its net payout were all "—". A franchise owner outside the top ten could not be
   * reconciled — not "was reconciled slowly", could not be reconciled — and nothing on the
   * page named the reason.
   *
   * `dashboard.network` is the same service, same capability (`@Can('dashboard')` covers the
   * whole controller), answering per depot for EVERY depot, and it already distinguishes a
   * depot that sold nothing from a depot the revenue report could not account for: the
   * latter comes back `revenue: null` (audit E-3), which is exactly the "—" this statement
   * already knows how to print. It also carries each depot's name and code, so the separate
   * directory read is gone rather than paged.
   */
  const rollup = useAsync<NetworkDashboard>(() => api.getCached(endpoints.hq.rollup(range), true));
  const shipping = useAsync<ShippingByDepot>(() =>
    api.get(endpoints.reports.shippingByDepot(range), true),
  );
  const refundsByDepot = useAsync<RefundsByDepot>(() =>
    api.get(endpoints.reports.refundsByDepot(range), true),
  );
  const gallon = useAsync<GallonOutstanding[]>(() =>
    api.get(endpoints.gallonNetwork.outstanding, true),
  );
  // The agreed franchise cut per depot — the row this statement must bill against.
  const schemes = useAsync<CommissionScheme[]>(() => api.get(endpoints.commission.schemes, true));

  const [depotId, setDepotId] = useState('');

  // Resolved BEFORE the loading guard so the settings read below can be a hook keyed on the
  // depot actually on screen. Hooks may not sit after an early return, and reading the
  // GLOBAL value instead would quietly ignore a per-depot override — another wrong number.
  const items = rollup.data?.depots ?? [];
  const selected = depotId || items[0]?.depotId || '';
  const depot = items.find((d) => d.depotId === selected) ?? null;

  /*
   * Payout's settings slice, scoped to this depot: GLOBAL value unless the depot overrides.
   *
   * `depotAdmin` is MANAGER + SUPER_ADMIN — a WRITE capability over depot settings — so a
   * DIREKTUR reaching this page 403'd here and lost the whole statement over a fee editor
   * they were never meant to touch. The reports are theirs; the settings are not. Asking
   * for what you may not have and calling the refusal a failure is the same lie this page
   * was rewritten to stop telling.
   */
  const maySeeSettings = can('depotAdmin', customer?.role);
  const payoutSettings = useAsync<SettingsSchema>(
    () =>
      maySeeSettings
        ? fetchSettingsSchema('/payout/api/v1', selected || null)
        : Promise.resolve({} as SettingsSchema),
    [selected, maySeeSettings],
  );

  if (rollup.loading) return <Skeleton className="h-96 w-full" />;
  if (rollup.error) return <ErrorState message={rollup.error} onRetry={rollup.reload} />;

  // Real: this depot revenue in the window. Still null when the source report could not
  // account for this depot — the roll-up says so itself rather than folding it to Rp 0, and
  // every row below propagates that null rather than settling against a made-up figure.
  //
  // CA-2-10/CA-2-25: read from the WHOLE depot list, not the top-ten slice. A depot outside
  // the top ten used to reconcile against nothing at all.
  const sales = depot?.revenue ?? null;
  /*
   * CA-2-09 — the base HQ actually bills, not a second one derived on screen.
   *
   * `sales` is `SUM(order.total)`, and `total` is `subtotal + ongkir − discount`. What
   * payout-service charges the franchise percentage against is `order.subtotal`, pushed as
   * `commissionBaseIdr` on every completed order, for a reason written there: ongkir is
   * money the depot pays a courier, not margin HQ has a claim on, and a voucher HQ funded
   * must not shrink HQ's own cut.
   *
   * So the two sides disagreed by (ongkir - discount) on every statement, and the CHARGED
   * side is the correct one — it is the invoice. This screen was moved to follow it: the
   * server was not touched, because the bill is not a display bug.
   */
  const commissionBase = depot?.commissionBase ?? null;

  /**
   * The franchise cut comes from the depot's own commission scheme — the same row
   * `hq/franchise` shows and `payout-service` charges against. It used to be `sales * 0.2`,
   * an inline literal, on a statement an owner reads as what they are owed: every depot was
   * billed 20% whatever HQ had actually agreed with them, and the number carried no stub
   * badge to say otherwise. `null` when no scheme exists, so the row reads "—" instead of
   * inventing a rate.
   */
  const scheme = schemes.data?.find((s) => s.depotId === selected) ?? null;
  const commission =
    commissionBase != null && scheme ? Math.round(commissionBase * (scheme.pct / 100)) : null;
  /**
   * The platform fee now comes from payout-service's own settings slice, GLOBAL with a
   * per-depot override — the same store the settings screen already edits.
   *
   * It used to be `const PLATFORM_FEE_PCT = 0.05`: a rate nobody had agreed, applied to
   * REAL revenue, on a statement a franchise owner reads as what they are owed. Being
   * labelled "(estimasi 5%)" did not make it true. Its default is 0, so a network that has
   * never set one reads `—` — the same refusal to guess the commission row already makes.
   *
   * A fee that is CONFIGURED as zero is zero, not unknown — only a settings read that
   * failed or has not landed is unknown, and that is what turns the row (and the net
   * below it) into `—`. HEAD_OFFICE currently cannot read this endpoint at all, which is
   * a capability gap tracked separately; until it is closed they see `—` here rather than
   * a number nobody agreed.
   */
  /*
   * CA-2-11. The paragraph above already says what should happen to a role that cannot read
   * the settings: they see `—`. The code did something else. When `maySeeSettings` is false
   * the fetcher resolves to `{}` — not an error, not loading — so `?? 0` made the fee read
   * **0%**, and the NET below it was computed as though the platform took nothing. Every
   * role but SUPER_ADMIN and MANAGER read a statement that was wrong by the whole fee.
   *
   * Unknown is not zero. A fee CONFIGURED as zero is still zero; a fee nobody was allowed
   * to ask about is `—`, and so is the net that depends on it.
   */
  const platformFeePct =
    !maySeeSettings || payoutSettings.error || payoutSettings.loading
      ? null
      : Number(payoutSettings.data?.effective?.platformFeePct ?? 0);
  const platformFee =
    sales != null && platformFeePct != null ? Math.round(sales * (platformFeePct / 100)) : null;

  /*
   * Real lines — and NULL when their source could not be read.
   *
   * These used to fall to `?? 0` on failure and go straight into the settlement below, so
   * an unreachable order-service produced a statement claiming a depot billed no ongkir and
   * was owed no refunds. A zero is a claim about the month; only null says "not measured".
   * Same rule the monthly review already follows: no half number.
   */
  const line = (err: string | null, value: number | undefined): number | null =>
    err ? null : (value ?? 0);
  const shippingBilled = line(
    shipping.error,
    shipping.data?.items.find((r) => r.depotId === selected)?.shippingBilled,
  );
  const gallonDeposit = line(
    gallon.error,
    gallon.data?.find((r) => r.depotId === selected)?.netDeposit,
  );
  // Real: refunds settled on this depot's orders in the window (payment-service → order-service).
  const refunds = line(
    refundsByDepot.error,
    refundsByDepot.data?.items.find((r) => r.depotId === selected)?.refunded,
  );

  /*
   * ponytail: illustrative payout formula — the owner keeps sales, less platform fee,
   * franchise commission, refunds and the deposit held. Server is authority later.
   *
   * CA-2-08 — ongkir is NOT added here, and adding it was money.
   *
   * `sales` is `SUM(order.total)` and `order.total` is `money(subtotal + deliveryFee −
   * discount)` (order.service.ts:522/791/2013), so the ongkir is already inside it. The
   * line `+ shippingBilled` paid every depot its delivery fee a second time — a statement
   * an owner reads as what they are owed, overstated by the whole ongkir of the window,
   * every window, silently, because both terms are real numbers from real endpoints.
   *
   * The ongkir row stays ON the statement: an owner has to see what the delivery fees came
   * to. It is labelled as a component of the sales line above it rather than an addend, so
   * the column no longer looks like it should sum.
   *
   * Null the moment ANY term is: a settlement figure computed from a term nobody could
   * fetch is not a small error, it is the wrong number with a confident face. `shippingBilled`
   * stays in the guard — it is displayed, and a statement missing a line it shows is not one
   * to settle on.
   */
  const net =
    sales != null &&
    platformFee != null &&
    commission != null &&
    shippingBilled != null &&
    refunds != null &&
    gallonDeposit != null
      ? sales - platformFee - commission - refunds - gallonDeposit
      : null;

  const dash20 = t('hq.common.dash');
  const money = (n: number | null) =>
    n == null ? <span className="text-muted">{dash20}</span> : <Money amount={n} />;

  /**
   * The statement as a spreadsheet, built from the rows on screen.
   *
   * This used to be a success toast and nothing else (`// STUB: no reconciliation-PDF
   * endpoint`) — a franchise owner pressed "Unduh" and got a green pill and no file. No server
   * renderer is needed for what is six labelled numbers: the same XLSX path `hq/reports/export`
   * uses. A PDF still has no renderer anywhere in the repo, so this is XLSX, honestly labelled.
   */
  async function download() {
    if (!depot) return;
    const rows: (string | number)[][] = [
      [t('hq.reconciliation.lines.sales'), sales ?? ''],
      [
        pctLabel(t('hq.reconciliation.lines.platformFee'), platformFeePct),
        platformFee == null ? '' : -platformFee,
      ],
      // Memo rows, both of them: the ongkir is inside the sales line and the commission base
      // is what the percentage below is taken of. Neither is added into the net.
      [t('hqFix.recon.shippingIncluded'), shippingBilled ?? ''],
      [t('hq.reconciliation.lines.refunds'), refunds == null ? '' : -refunds],
      [t('hqFix.recon.commissionBase'), commissionBase ?? ''],
      [
        scheme
          ? pctLabel(t('hq.reconciliation.lines.commission'), scheme.pct)
          : schemes.error
            ? t('hqFix.recon.schemeUnreadable')
            : t('hqFix.recon.schemeMissing'),
        // Every other unknown cell on this sheet is BLANK. This one alone wrote 0, which is
        // a number finance adds up — the same fix the screen's other rows already had.
        commission == null ? '' : -commission,
      ],
      [t('hq.reconciliation.lines.deposit'), gallonDeposit == null ? '' : -gallonDeposit],
      // Blank, not 0. A spreadsheet cell reading 0 is a number somebody adds up.
      [t('hq.reconciliation.lines.net'), net ?? ''],
    ];
    try {
      await downloadXlsx(
        `rekonsiliasi-${depot.code}.xlsx`,
        ['Komponen', t('hrFix.reconciliation.amountIdr')],
        rows,
        'Rekonsiliasi',
      );
      toast(t('hq.reconciliation.downloaded'), 'success');
    } catch {
      toast(t('hrFix.reconciliation.fileFailed'), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Scales}
        title={t('hq.reconciliation.title')}
        subtitle={t('hq.reconciliation.subtitle')}
      />

      <div className="max-w-sm">
        <label htmlFor="recon-depot" className="mb-1.5 block text-sm font-medium">
          {t('hq.reconciliation.pickDepot')}
        </label>
        <select
          id="recon-depot"
          className={SELECT_CLASS}
          value={selected}
          onChange={(e) => setDepotId(e.target.value)}
        >
          {items.map((d) => (
            <option key={d.depotId} value={d.depotId}>
              {d.name} · {d.code}
            </option>
          ))}
        </select>
      </div>

      {!depot ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.reconciliation.selectPrompt')}</p>
        </Card>
      ) : (
        <Card className="flex min-w-0 flex-col p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {t('hq.reconciliation.statement', { depot: depot.name })}
            </h2>
            <Button variant="secondary" onClick={download}>
              <DownloadSimple size={16} weight="bold" />
              {t('hq.reconciliation.download')}
            </Button>
          </div>
          <p className="mb-4 text-xs text-muted">{t('hq.reconciliation.period')}</p>

          {sales == null && (
            <p className="mb-4 rounded-xl bg-[color:var(--warning-bg)] px-4 py-3 text-sm text-[color:var(--warning)]">
              {t('hq.reconciliation.noData')}
            </p>
          )}

          <dl className="flex flex-col divide-y divide-[color:var(--border)]">
            <Line label={t('hq.reconciliation.lines.sales')} value={money(sales)} />
            {/* Labelled as an estimate: it is the one line with no configured source. */}
            <Line
              label={pctLabel(t('hq.reconciliation.lines.platformFee'), platformFeePct)}
              value={money(platformFee == null ? null : -platformFee)}
            />
            {/* Memo, not an addend: `order.total` already carries the ongkir, so the net
                below must not add it a second time (CA-2-08). */}
            <Line label={t('hqFix.recon.shippingIncluded')} value={money(shippingBilled)} />
            <Line
              label={t('hq.reconciliation.lines.refunds')}
              value={money(refunds == null ? null : -refunds)}
            />
            {/* Memo: what the percentage below is taken OF. Without it the commission row is
                a number that reconciles against nothing else on the statement (CA-2-09). */}
            <Line label={t('hqFix.recon.commissionBase')} value={money(commissionBase)} />
            {/* The agreed rate, named. "—" when this depot has no scheme, never a guess. */}
            <Line
              label={
                scheme
                  ? pctLabel(t('hq.reconciliation.lines.commission'), scheme.pct)
                  : schemes.error
                    ? // "Belum ada skema" is a statement about the contract. An unread
                      // scheme list is a statement about the read, and finance settles on
                      // this row.
                      t('hqFix.recon.schemeUnreadable')
                    : t('hqFix.recon.schemeMissing')
              }
              value={money(commission == null ? null : -commission)}
            />
            <Line
              label={t('hq.reconciliation.lines.deposit')}
              value={money(gallonDeposit == null ? null : -gallonDeposit)}
            />
          </dl>

          <div className="mt-4 flex min-h-11 items-center justify-between rounded-xl bg-deep-teal px-4 py-4 text-white">
            <span className="font-semibold">{t('hq.reconciliation.lines.net')}</span>
            <span className="text-xl font-bold tabular-nums">
              {net == null ? dash20 : <Money amount={net} />}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <dt className="flex items-center gap-2 text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
