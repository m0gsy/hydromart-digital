'use client';

import { useState } from 'react';

import { Button, Field, Input, LoadError } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page, SavedSegment, SegmentConditions } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

export type Preset = 'all' | 'loyalty' | 'atRisk' | 'new';
const PRESETS: Preset[] = ['all', 'loyalty', 'atRisk', 'new'];

// Each preset maps to activity conditions the order-service segment-estimate endpoint
// honours (frequency / lapsed-recency / first-order recency). `all` = every reachable
// customer. Tier isn't joinable here, so "loyalty" is a frequency proxy (≥5 orders).
const PRESET_CONDITIONS: Record<Preset, SegmentConditions> = {
  all: {},
  loyalty: { minOrders: 5 },
  atRisk: { lapsedDays: 60 },
  new: { newWithinDays: 30 },
};

/** Conditions typed by hand: the raw field text, parsed by `audienceConditions`. */
export interface Custom {
  recencyDays: string;
  minOrders: string;
  depotId: string;
}

/** Who a campaign goes to: a preset, a saved segment, or conditions set by hand. */
export type Audience =
  | { kind: 'preset'; preset: Preset }
  | { kind: 'saved'; segment: SavedSegment }
  | { kind: 'custom'; custom: Custom };

export const EMPTY_CUSTOM: Custom = { recencyDays: '', minOrders: '', depotId: '' };

const positive = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** The segment the estimate is sized from AND the campaign is created with: one value, never two. */
export function audienceConditions(a: Audience): SegmentConditions {
  if (a.kind === 'preset') return PRESET_CONDITIONS[a.preset];
  if (a.kind === 'saved') return a.segment.conditions;
  const q: SegmentConditions = {};
  const recencyDays = positive(a.custom.recencyDays);
  const minOrders = positive(a.custom.minOrders);
  if (recencyDays) q.recencyDays = recencyDays;
  if (minOrders) q.minOrders = minOrders;
  if (a.custom.depotId) q.depotId = a.custom.depotId;
  return q;
}

/**
 * Flow plan 5c: the audience step of the /hq/campaigns builder. Saved and hand-built
 * audiences used to live on the segment form, and a depot's own customers on the broadcast
 * screen — two more screens that each created and sent a campaign their own way. Both now
 * redirect here. Their audiences that never sent (loyalty members, staff: refused at send)
 * and the tier condition (never applied) are not carried over.
 */
export function AudiencePicker({
  value,
  onChange,
  locked,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
  /** Conditions arrived in the URL and win; the controls show but do not apply. */
  locked: boolean;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { customer } = useAuth();
  // The depot LIST is `depotDirectoryFinance`; MARKETING does not hold it, and asking anyway
  // 403'd on every open (found by the full-stack pass on the old broadcast screen). Without
  // the list a depot cannot be picked, so the condition is not offered.
  const mayListDepots = can('depotDirectoryFinance', customer?.role);
  const depots = useAsync<Page<DepotAdmin> | null>(() =>
    mayListDepots
      ? api.getCached(endpoints.depots.manage({ limit: 100 }), true)
      : Promise.resolve(null),
  );
  const saved = useAsync<SavedSegment[]>(() => api.get(endpoints.crm.savedSegments, true));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const custom = value.kind === 'custom' ? value.custom : null;
  const setCustom = (patch: Partial<Custom>) =>
    onChange({ kind: 'custom', custom: { ...(custom ?? EMPTY_CUSTOM), ...patch } });

  async function save() {
    if (!name.trim()) return toast(t('hq.campaigns.audience.needName'), 'error');
    const conditions = audienceConditions(value);
    // No conditions is "everyone", which is already the first chip.
    if (Object.keys(conditions).length === 0)
      return toast(t('hq.campaigns.audience.needCondition'), 'error');
    setBusy(true);
    try {
      // Upsert by name on the server: the same label saved twice is one audience refined.
      const segment = await api.post<SavedSegment>(
        endpoints.crm.savedSegments,
        { name: name.trim(), conditions },
        true,
      );
      toast(t('hq.campaigns.audience.saved'), 'success');
      setName('');
      saved.reload();
      onChange({ kind: 'saved', segment });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.campaigns.audience.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(segment: SavedSegment) {
    setBusy(true);
    try {
      await api.del(endpoints.crm.savedSegment(segment.id), true);
      saved.reload();
      onChange({ kind: 'preset', preset: 'all' });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.campaigns.audience.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const chip = (key: string, label: string, pressed: boolean, pick: () => void) => (
    <button
      key={key}
      type="button"
      disabled={locked}
      onClick={pick}
      aria-pressed={!locked && pressed}
      className={`min-h-11 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        pressed
          ? 'border-brand-600 bg-brand-50 text-brand-800'
          : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex flex-col gap-3 ${locked ? 'opacity-40' : ''}`}>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) =>
          chip(p, t(`hq.campaigns.chips.${p}`), value.kind === 'preset' && value.preset === p, () =>
            onChange({ kind: 'preset', preset: p }),
          ),
        )}
        {chip('custom', t('hq.campaigns.audience.custom'), value.kind === 'custom', () =>
          onChange({ kind: 'custom', custom: custom ?? EMPTY_CUSTOM }),
        )}
      </div>

      {/* A list that hides itself when empty must not hide a failed read too: that looks like
          a console where nobody ever saved a segment, and the audience gets rebuilt by hand. */}
      {saved.error && <LoadError onRetry={saved.reload} />}
      {(saved.data ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('hq.campaigns.audience.savedTitle')}
          </span>
          <div className="flex flex-wrap gap-2">
            {(saved.data ?? []).map((sg) =>
              chip(sg.id, sg.name, value.kind === 'saved' && value.segment.id === sg.id, () =>
                onChange({ kind: 'saved', segment: sg }),
              ),
            )}
          </div>
        </div>
      )}
      {value.kind === 'saved' && !locked && (
        <div>
          <Button variant="ghost" onClick={() => remove(value.segment)} disabled={busy}>
            {t('hq.campaigns.audience.remove')}
          </Button>
        </div>
      )}

      {custom && !locked && (
        <div className="flex flex-col gap-3 rounded-xl border border-app p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('hq.campaigns.audience.recency')} htmlFor="a-recency">
              <Input
                id="a-recency"
                inputMode="numeric"
                value={custom.recencyDays}
                onChange={(e) => setCustom({ recencyDays: e.target.value })}
                placeholder="30"
              />
            </Field>
            <Field label={t('hq.campaigns.audience.minOrders')} htmlFor="a-min">
              <Input
                id="a-min"
                inputMode="numeric"
                value={custom.minOrders}
                onChange={(e) => setCustom({ minOrders: e.target.value })}
                placeholder="3"
              />
            </Field>
          </div>
          {mayListDepots && (
            <Field label={t('hq.campaigns.audience.depot')} htmlFor="a-depot">
              <select
                id="a-depot"
                value={custom.depotId}
                onChange={(e) => setCustom({ depotId: e.target.value })}
                className={inputClass}
              >
                <option value="">{t('hq.campaigns.audience.anyDepot')}</option>
                {(depots.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {depots.error && <LoadError onRetry={depots.reload} />}
          <div className="flex flex-wrap items-center gap-2 border-t border-app pt-3">
            <Input
              className="min-w-0 flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('hq.campaigns.audience.namePh')}
              aria-label={t('hq.campaigns.audience.saveTitle')}
            />
            <Button variant="secondary" onClick={save} loading={busy}>
              {t('hq.campaigns.audience.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the summary step calls the audience. */
export function audienceLabel(a: Audience, t: (key: string) => string): string {
  if (a.kind === 'preset') return t(`hq.campaigns.chips.${a.preset}`);
  if (a.kind === 'saved') return a.segment.name;
  return t('hq.campaigns.audience.custom');
}
