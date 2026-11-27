// The B2B prospect Excel export (AREA-2b): pure builders from the export response to the five sheets.
// The server already prefixes `'` on the free-text cells it returns; `toWorkbookBlob` neutralises only
// what still starts with a formula character, so nothing is prefixed twice.
import { B2B_CATEGORIES, B2B_STATUSES } from '@hydromart/access';

import { labelKey } from './prospect-labels';
import type { WorkbookSheet } from './xlsx';
import { todayWib } from './wib';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface ExportRowDto {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  kecamatanCode: string | null;
  kecamatan: string | null;
  kelurahanCode: string | null;
  kelurahan: string | null;
  status: string;
  ownerDepotId: string | null;
  assignedToId: string | null;
  source: string;
  licence: string | null;
  sourceId: string | null;
  sourceDate: string | null;
}

export interface ExportVisitDto {
  rowIndex: number;
  visitorId: string;
  visitedAt: string;
  outcome: string;
  distanceM: number;
}

export interface ExportResponse {
  rows: ExportRowDto[];
  truncated: boolean;
  rowCount: number;
  visits: ExportVisitDto[];
}

export interface ExportDepot {
  id: string;
  code: string;
  name: string;
  serviceRadiusKm?: number;
  serviceArea?: unknown[] | null;
}

export interface ExportInput {
  response: ExportResponse;
  depots: readonly ExportDepot[];
  /** Staff id to name, from the assignees route; an id missing here shows as "Staf" + last 4. */
  names: ReadonlyMap<string, string>;
  /** Marked prospects per depot in scope (from coverage); counts only. */
  dnc: readonly { depotId: string; count: number }[];
  t: Translate;
}

const ATTRIBUTED = ['OSM', 'OVERTURE'];

/** File name `prospek-{depot code|jaringan}[-sebagian]-{YYYY-MM-DD WIB}.xlsx`. */
export function exportFileName(depotCode: string | null, partial: boolean, t: Translate, at = new Date()): string {
  // i18n-ok: download filename.
  return `prospek-${depotCode ?? t('opsFix.prospectsIo.export.fileNetwork')}${partial ? `-${t('opsFix.prospectsIo.export.filePartial')}` : ''}-${todayWib(at)}.xlsx`;
}

export function buildExportSheets({ response, depots, names, dnc, t }: ExportInput): WorkbookSheet[] {
  const x = (k: string, v?: Record<string, string | number>) => t(`opsFix.prospectsIo.export.${k}`, v);
  const depotOf = (id: string | null) => depots.find((d) => d.id === id);
  const depotCode = (id: string | null) => (id ? (depotOf(id)?.code ?? '-') : '-');
  const person = (id: string | null) =>
    id ? (names.get(id) ?? x('staffTail', { tail: id.slice(-4) })) : x('unassigned');
  const category = (v: string) => t(labelKey('category', v));
  const status = (v: string) => t(labelKey('status', v));
  const { rows, visits } = response;

  // 1. Ringkasan depot: one row per depot present in the file (no depot = the opportunity map).
  const depotIds = [...new Set(rows.map((r) => r.ownerDepotId))];
  const summary: WorkbookSheet = {
    name: x('sheets.summary'),
    headers: [
      x('cols.code'),
      x('cols.depot'),
      x('cols.area'),
      x('cols.total'),
      ...B2B_CATEGORIES.map(category),
      x('cols.withPhonePct'),
      ...B2B_STATUSES.map(status),
    ],
    rows: depotIds.map((id) => {
      const mine = rows.filter((r) => r.ownerDepotId === id);
      const d = depotOf(id);
      const area = d?.serviceArea?.length ? x('drawn') : d?.serviceRadiusKm ? x('radius', { km: d.serviceRadiusKm }) : '';
      return [
        depotCode(id),
        d?.name ?? t('opsFix.prospects.noDepot'),
        area,
        mine.length,
        ...B2B_CATEGORIES.map((c) => mine.filter((r) => r.category === c).length),
        Math.round((100 * mine.filter((r) => r.phone).length) / mine.length),
        ...B2B_STATUSES.map((s) => mine.filter((r) => r.status === s).length),
      ];
    }),
  };

  // 2. Prospek.
  const phoneH = x('cols.phone');
  const sources = [...new Set(rows.map((r) => r.source))];
  const prospects: WorkbookSheet = {
    name: x('sheets.prospects'),
    headers: [
      x('cols.name'),
      x('cols.category'),
      x('cols.address'),
      phoneH,
      x('cols.lat'),
      x('cols.lng'),
      x('cols.kecamatanCode'),
      x('cols.kecamatan'),
      x('cols.kelurahanCode'),
      x('cols.kelurahan'),
      x('cols.code'),
      x('cols.source'),
      x('cols.licence'),
      x('cols.sourceId'),
      x('cols.sourceDate'),
      x('cols.stage'),
      x('cols.pic'),
    ],
    raw: [phoneH, x('cols.lat'), x('cols.lng')],
    text: [phoneH, x('cols.kecamatanCode'), x('cols.kelurahanCode'), x('cols.sourceId')],
    rows: rows.map((r) => [
      r.name,
      category(r.category),
      r.address,
      r.phone,
      r.latitude,
      r.longitude,
      r.kecamatanCode,
      r.kecamatan,
      r.kelurahanCode,
      r.kelurahan,
      depotCode(r.ownerDepotId),
      r.source,
      r.licence,
      r.sourceId,
      r.sourceDate ? r.sourceDate.slice(0, 10) : '',
      status(r.status),
      r.assignedToId ? person(r.assignedToId) : '',
    ]),
    footer: [x('footerTechnical'), ...sources.filter((s) => ATTRIBUTED.includes(s)).map((s) => x(`attribution.${s}`))],
  };

  // 3. Kunjungan: the visits joined to their prospect by row index.
  const visitSheet: WorkbookSheet = {
    name: x('sheets.visits'),
    headers: [x('cols.name'), x('cols.pic'), x('cols.date'), x('cols.gpsOk'), x('cols.outcome'), x('cols.distance')],
    rows: visits.map((v) => [
      rows[v.rowIndex]?.name ?? '',
      person(v.visitorId),
      todayWib(new Date(v.visitedAt)),
      x('yes'), // every stored visit passed the server's GPS rules
      t(labelKey('outcome', v.outcome)),
      v.distanceM,
    ]),
  };

  // 4. Tahap per PIC.
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.assignedToId ?? ''}|${r.status}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const perPic: WorkbookSheet = {
    name: x('sheets.perPic'),
    headers: [x('cols.pic'), x('cols.stage'), x('cols.count')],
    rows: [...groups]
      .map(([k, n]) => {
        const [id, s] = k.split('|') as [string, string];
        return [person(id || null), status(s), n] as [string, string, number];
      })
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
  };

  // 5. Jangan hubungi: counts per depot, never a name or number.
  const dncSheet: WorkbookSheet = {
    name: x('sheets.dnc'),
    headers: [x('cols.code'), x('cols.depot'), x('cols.count')],
    rows: dnc.map((d) => [depotCode(d.depotId), depotOf(d.depotId)?.name ?? '', d.count]),
    footer: [x('dncNote')],
  };

  return [summary, prospects, visitSheet, perPic, dncSheet];
}
