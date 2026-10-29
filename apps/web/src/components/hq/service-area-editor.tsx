'use client';

import { useMemo } from 'react';

import { Field } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { areaPreview, parseAreaText } from '@/lib/service-area-text';

/**
 * Edits a depot's drawn service area as plain coordinates, with a drawing of the result.
 *
 * No map: the app ships none (it was removed on purpose), so the person pastes corners from
 * wherever they drew them (Google Maps, a survey) and the preview shows whether the shape is
 * what they meant before it is saved. The depot's own position and, while nothing is drawn, its
 * radius are shown for scale.
 */
export function ServiceAreaEditor({
  value,
  onChange,
  depotLat,
  depotLng,
  radiusKm,
}: {
  value: string;
  onChange: (text: string) => void;
  depotLat: string;
  depotLng: string;
  radiusKm: string;
}) {
  const { t } = useT();
  const parsed = useMemo(() => parseAreaText(value, t), [value, t]);

  const preview = useMemo(() => {
    const lat = Number(depotLat);
    const lng = Number(depotLng);
    const depot =
      depotLat.trim() !== '' &&
      depotLng.trim() !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
        ? { lat, lng }
        : null;
    const radius = radiusKm.trim() !== '' && Number(radiusKm) > 0 ? Number(radiusKm) : null;
    return areaPreview(parsed.ok ? parsed.value : null, depot, radius);
  }, [parsed, depotLat, depotLng, radiusKm]);

  const summary = parsed.ok
    ? parsed.value
      ? t('hrFix.depotArea.summary', {
          rings: parsed.value.length,
          points: parsed.value.reduce((n, ring) => n + ring.length, 0),
        })
      : t('hrFix.depotArea.none')
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={t('hrFix.depotArea.label')}
        htmlFor="d-area"
        hint={t('hrFix.depotArea.hint')}
        error={parsed.ok ? undefined : parsed.error}
      >
        <textarea
          id="d-area"
          rows={7}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'-6.2, 106.8\n-6.2, 107.0\n-6.0, 107.0\n-6.0, 106.8'}
          aria-invalid={!parsed.ok}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm"
        />
      </Field>
      {summary && <p className="text-xs text-muted">{summary}</p>}
      {preview && (
        <svg
          viewBox={preview.viewBox}
          role="img"
          aria-label={t('hrFix.depotArea.previewLabel')}
          className="h-56 w-full max-w-sm rounded-xl border border-border bg-surface"
        >
          {preview.circle && (
            <circle
              cx={preview.circle.cx}
              cy={preview.circle.cy}
              r={preview.circle.r}
              fill="none"
              stroke="currentColor"
              strokeDasharray="2 2"
              strokeWidth={0.6}
              className="text-muted"
            />
          )}
          {preview.polygons.map((points) => (
            <polygon
              key={points}
              points={points}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="currentColor"
              strokeWidth={0.8}
              className="text-brand-600"
            />
          ))}
          {preview.depot && (
            <circle
              cx={preview.depot.x}
              cy={preview.depot.y}
              r={1.8}
              className="fill-current text-brand-600"
            />
          )}
        </svg>
      )}
    </div>
  );
}
