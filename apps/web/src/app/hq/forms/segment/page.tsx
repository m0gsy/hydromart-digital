'use client';

import { useRef, useState } from 'react';
import { UsersThree, Plus, Trash } from '@phosphor-icons/react';

import { Button, Card, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubSegmentEstimate } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

type ConditionField = 'recency' | 'frequency' | 'tier' | 'depot';
interface Condition {
  id: number;
  field: ConditionField;
  value: string;
}

const SELECT_CLASS =
  'surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';
const FIELDS: ConditionField[] = ['recency', 'frequency', 'tier', 'depot'];

// Design 21d — Buat segment. There is no segment/audience endpoint, so the whole screen
// is a stub: the size estimate is a deterministic sample calc from the condition count,
// and Save / Use-in-campaign persist via toast only.
export default function HqSegmentFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [conditions, setConditions] = useState<Condition[]>([]);
  const nextId = useRef(1);

  function addCondition() {
    setConditions((c) => [...c, { id: nextId.current++, field: 'recency', value: '' }]);
  }
  function update(id: number, patch: Partial<Condition>) {
    setConditions((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function remove(id: number) {
    setConditions((c) => c.filter((x) => x.id !== id));
  }

  const estimate = stubSegmentEstimate(conditions.length);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <UsersThree size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {t('hq.forms.segment.title')}
            <StubBadge />
          </h1>
          <p className="text-sm text-muted">{t('hq.forms.segment.subtitle')}</p>
        </div>
      </div>

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
                  placeholder={t('hq.forms.segment.value')}
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
      </Card>

      {/* Live size estimate — STUB calc. */}
      <Card className="flex items-center justify-between gap-3 p-5">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
          {t('hq.forms.segment.estimate')}
          <StubBadge />
        </span>
        <span className="text-2xl font-bold tabular-nums text-brand-700">
          {t('hq.forms.segment.people', { n: estimate.toLocaleString('id-ID') })}
        </span>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => toast(t('hq.forms.segment.saved'), 'success')}>
          {t('hq.forms.segment.save')}
        </Button>
        <Button onClick={() => toast(t('hq.forms.segment.used'), 'success')}>
          {t('hq.forms.segment.use')}
        </Button>
      </div>
    </div>
  );
}
