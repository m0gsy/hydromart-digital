'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UsersThree, Plus, Trash } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Input, LoadError } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { SavedSegment } from '@/lib/types';

type ConditionField = 'recency' | 'frequency' | 'tier' | 'depot';
interface Condition {
  id: number;
  field: ConditionField;
  value: string;
}

const SELECT_CLASS =
  'surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';
const FIELDS: ConditionField[] = ['recency', 'frequency', 'tier', 'depot'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Design 21d — Buat segment. The size estimate is REAL: order-service /reports/segment-estimate
// counts distinct customers by activity (recency = last order within N days, frequency = >= N
// orders, depot = ordered at a depot id). Loyalty TIER lives in loyalty-service and is not
// joinable here, so a tier condition is honestly badged as "not applied" rather than faked.
// "Pakai di campaign" carries the resolved conditions to the 17c builder via the query
// string — which that builder now reads (it used to drop them and start from "all" again).
//
// Saving is an upsert BY NAME: the same label saved twice is one person refining one
// audience, and two rows sharing a name is how two people message different lists while
// believing they picked the same one.
export default function HqSegmentFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const nextId = useRef(1);
  const saved = useAsync<SavedSegment[]>(() => api.get(endpoints.crm.savedSegments, true));

  function addCondition() {
    setConditions((c) => [...c, { id: nextId.current++, field: 'recency', value: '' }]);
  }
  function update(id: number, patch: Partial<Condition>) {
    setConditions((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function remove(id: number) {
    setConditions((c) => c.filter((x) => x.id !== id));
  }

  // Resolve conditions the backend can honour; track any that can't be applied.
  const resolved = useMemo(() => {
    const q: { recencyDays?: number; minOrders?: number; depotId?: string } = {};
    let tierUsed = false;
    for (const c of conditions) {
      const v = c.value.trim();
      if (c.field === 'recency') {
        const n = Number.parseInt(v, 10);
        if (n > 0) q.recencyDays = n;
      } else if (c.field === 'frequency') {
        const n = Number.parseInt(v, 10);
        if (n > 0) q.minOrders = n;
      } else if (c.field === 'depot') {
        if (UUID_RE.test(v)) q.depotId = v;
      } else if (c.field === 'tier') {
        tierUsed = true;
      }
    }
    return { q, tierUsed };
  }, [conditions]);

  const estimate = useAsync<{ count: number }>(
    () => api.get<{ count: number }>(endpoints.segments.estimate(resolved.q), true),
    [JSON.stringify(resolved.q)],
  );

  async function save() {
    if (!name.trim()) return toast(t('hq.forms.segment.needName'), 'error');
    // An audience with no conditions is "everyone", which the campaign builder already
    // offers as a chip. Saving it under a name only makes the list harder to read.
    if (Object.keys(resolved.q).length === 0) return toast(t('hq.forms.segment.needCondition'), 'error');
    setSaving(true);
    try {
      await api.post(endpoints.crm.savedSegments, { name: name.trim(), conditions: resolved.q }, true);
      toast(t('hq.forms.segment.saved'), 'success');
      setName('');
      saved.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.forms.segment.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeSaved(id: string) {
    try {
      await api.del(endpoints.crm.savedSegment(id), true);
      saved.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.forms.segment.saveError'), 'error');
    }
  }

  /** Reopen a saved audience as editable conditions — the point of saving one. */
  function load(segment: SavedSegment) {
    const next: Condition[] = [];
    const add = (field: ConditionField, value: unknown) => {
      if (value != null) next.push({ id: nextId.current++, field, value: String(value) });
    };
    add('recency', segment.conditions.recencyDays);
    add('frequency', segment.conditions.minOrders);
    add('depot', segment.conditions.depotId);
    setConditions(next);
    setName(segment.name);
  }

  function useInCampaign() {
    const p = new URLSearchParams();
    if (resolved.q.recencyDays != null) p.set('recencyDays', String(resolved.q.recencyDays));
    if (resolved.q.minOrders != null) p.set('minOrders', String(resolved.q.minOrders));
    if (resolved.q.depotId) p.set('depotId', resolved.q.depotId);
    const qs = p.toString();
    router.push(`/hq/campaigns${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <HqPageHeader icon={UsersThree} title={t('hq.forms.segment.title')} subtitle={t('hq.forms.segment.subtitle')} />

      <Card className="flex flex-col gap-3 p-5">
        {conditions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.forms.segment.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conditions.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-app p-3">
                <select
                  className={SELECT_CLASS}
                  value={c.field}
                  onChange={(e) => update(c.id, { field: e.target.value as ConditionField })}
                >
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`hq.forms.segment.fields.${f}`)}
                    </option>
                  ))}
                </select>
                <Input
                  className="min-w-0 flex-1"
                  value={c.value}
                  onChange={(e) => update(c.id, { value: e.target.value })}
                  placeholder={t(`hq.forms.segment.valuePh.${c.field}`)}
                />
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label={t('hq.forms.segment.remove')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50"
                >
                  <Trash size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button variant="secondary" onClick={addCondition}>
            <Plus size={16} weight="bold" />
            {t('hq.forms.segment.addCondition')}
          </Button>
        </div>

        {resolved.tierUsed && (
          <p className="text-xs text-amber-700">{t('hq.forms.segment.tierUnsupported')}</p>
        )}
      </Card>

      {/* Live size estimate — REAL (order-service). */}
      <Card className="flex items-center justify-between gap-3 p-5">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          {t('hq.forms.segment.estimate')}
        </span>
        <span className="text-2xl font-bold tabular-nums text-brand-700">
          {estimate.loading
            ? '…'
            : estimate.error
              ? t('hq.common.dash')
              : t('hq.forms.segment.people', { n: (estimate.data?.count ?? 0).toLocaleString('id-ID') })}
        </span>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <span className="text-sm font-medium">{t('hq.forms.segment.saveTitle')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('hq.forms.segment.namePh')}
            aria-label={t('hq.forms.segment.saveTitle')}
          />
          <Button variant="secondary" onClick={save} loading={saving}>
            {t('hq.forms.segment.save')}
          </Button>
        </div>
        {/* The saved list hides itself when empty, so an unread one looks like a console
            where nobody ever saved a segment — and the same audience gets rebuilt by hand. */}
        {saved.error && <LoadError onRetry={saved.reload} />}
        {(saved.data ?? []).length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-app pt-3">
            {(saved.data ?? []).map((sg) => (
              <li key={sg.id} className="flex items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => load(sg)}
                  className="min-w-0 flex-1 truncate text-left font-medium text-brand-700 hover:underline"
                >
                  {sg.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeSaved(sg.id)}
                  aria-label={t('hq.forms.segment.remove')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50"
                >
                  <Trash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={useInCampaign}>{t('hq.forms.segment.use')}</Button>
      </div>
    </div>
  );
}
