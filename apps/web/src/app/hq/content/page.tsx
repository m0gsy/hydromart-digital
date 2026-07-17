'use client';

import { useMemo, useState } from 'react';
import { Translate } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Chip, Input, Toggle } from '@/components/ui';
import { id as idDict } from '@/lib/dictionaries/id';
import { en as enDict } from '@/lib/dictionaries/en';
import { useT } from '@/lib/locale-context';

// Design 24c — bilingual dictionary editor. Real-read: flattens the live id/en dictionaries
// and flags any EN leaf that is missing or identical to ID as "untranslated". Editing is
// LOCAL state only — it never writes files; the "diff" produces paste-ready lines (same
// pattern as the RBAC matrix). Capped to a page of rows so the (large) dictionary stays fast.
const PAGE_CAP = 250;

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

export default function HqContentPage() {
  const { t } = useT();
  const flatId = useMemo(() => flatten(idDict), []);
  const flatEn = useMemo(() => flatten(enDict), []);
  const keys = useMemo(() => Object.keys(flatId), [flatId]);

  const [query, setQuery] = useState('');
  const [onlyUntranslated, setOnlyUntranslated] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  const enValue = (key: string) => edits[key] ?? flatEn[key] ?? '';
  const isUntranslated = (key: string) => {
    const e = flatEn[key];
    return e === undefined || e === flatId[key];
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys.filter((k) => {
      if (onlyUntranslated && !isUntranslated(k)) return false;
      if (!q) return true;
      return k.toLowerCase().includes(q) || (flatId[k] ?? '').toLowerCase().includes(q) || (flatEn[k] ?? '').toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, query, onlyUntranslated, flatId, flatEn]);

  const shown = filtered.slice(0, PAGE_CAP);

  const changed = useMemo(
    () => Object.keys(edits).filter((k) => edits[k] !== (flatEn[k] ?? '')),
    [edits, flatEn],
  );
  const diffText = changed.map((k) => `${k}: ${JSON.stringify(edits[k])}`).join('\n');

  function setEn(key: string, value: string) {
    setCopied(false);
    setEdits((prev) => ({ ...prev, [key]: value }));
  }
  function reset() {
    setEdits({});
    setShowDiff(false);
    setCopied(false);
  }
  async function copyDiff() {
    try {
      await navigator.clipboard.writeText(diffText);
      setCopied(true);
    } catch {
      /* clipboard blocked — the block is still selectable */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <HqPageHeader
        icon={Translate}
        title={t('hq.content.title')}
        subtitle={t('hq.content.subtitle')}
        action={<span className="text-sm font-semibold text-muted">{t('hq.content.count', { shown: shown.length, total: keys.length })}</span>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('hq.content.search')} aria-label={t('hq.content.search')} />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Toggle on={onlyUntranslated} onChange={setOnlyUntranslated} label={t('hq.content.untranslatedOnly')} />
          {t('hq.content.untranslatedOnly')}
        </label>
      </div>

      {changed.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-400 bg-brand-50 p-4">
          <p className="font-semibold text-brand-800">{t('hq.content.changed', { n: changed.length })}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset}>{t('hq.content.reset')}</Button>
            <Button variant="secondary" onClick={() => setShowDiff((v) => !v)}>{t('hq.content.diff')}</Button>
          </div>
        </Card>
      )}

      {changed.length > 0 && showDiff && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{t('hq.content.diffTitle')}</p>
            <Button variant="ghost" onClick={copyDiff}>{copied ? t('hq.content.copied') : t('hq.content.copy')}</Button>
          </div>
          <p className="text-xs text-muted">{t('hq.content.diffHint')}</p>
          <pre className="overflow-x-auto rounded-lg bg-[color:var(--surface-soft)] p-3 text-xs">
            <code>{diffText}</code>
          </pre>
        </Card>
      )}

      {shown.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.content.empty')}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{t('hq.content.key')}</th>
                <th className="px-4 py-2.5">{t('hq.content.idCol')}</th>
                <th className="px-4 py-2.5">{t('hq.content.enCol')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((k) => (
                <tr key={k} className="border-b border-app last:border-0 align-top">
                  <td className="px-4 py-2.5">
                    <code className="text-xs">{k}</code>
                    {isUntranslated(k) && (
                      <div className="mt-1">
                        <Chip tone="amber">{t('hq.content.untranslated')}</Chip>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{flatId[k]}</td>
                  <td className="px-4 py-2.5">
                    <Input value={enValue(k)} onChange={(e) => setEn(k, e.target.value)} aria-label={k} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
