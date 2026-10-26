import {
  enumCell,
  intCell,
  numberCell,
  phoneCell,
  type ImportColumn,
} from '@/components/csv-import';
import { areaCell, hhmmCell, holidaysCell, plainDigitsCell } from '@/lib/depot-import-cells';

const DAYS = [
  ['sen', 'mon'],
  ['sel', 'tue'],
  ['rab', 'wed'],
  ['kam', 'thu'],
  ['jum', 'fri'],
  ['sab', 'sat'],
  ['min', 'sun'],
] as const;

// Business tunables a depot may override; the server is the authority on which keys exist.
const SETTINGS = [
  ['gallonDepositIdr', '20000'],
  ['gallonMaxHoldDays', '14'],
  ['gallonReminderEveryDays', '7'],
  ['approvalAutoPassIdr', '100000'],
] as const;

const OWNERSHIP = ['HKP', 'WARALABA'];

// A blank cell is skipped by the wizard, so a column that is not filled never reaches the
// server — which is what lets "update" leave a value alone instead of clearing it.
export const DEPOT_IMPORT_COLUMNS: ImportColumn[] = [
  // i18n-ok: sample cell values in the column guide, shown verbatim as the file must contain them.
  { key: 'code', required: true, example: 'JKT-01', text: true },
  { key: 'name', example: 'Depot Cikini' },
  { key: 'ownershipType', example: 'HKP', options: OWNERSHIP, parse: enumCell(OWNERSHIP) },
  { key: 'ownerId', example: '', text: true },
  { key: 'address', example: 'Jl. Cikini Raya No. 1' },
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'city', example: 'Jakarta Pusat' },
  { key: 'province', example: 'DKI Jakarta' },
  { key: 'lat', example: '-6.1944', text: true, parse: numberCell },
  { key: 'lng', example: '106.8412', text: true, parse: numberCell },
  { key: 'serviceRadiusKm', example: '5', parse: numberCell },
  { key: 'deliveryFee', example: '5000', parse: intCell },
  { key: 'minOrderAmount', example: '20000', parse: intCell },
  { key: 'contactPhone', example: '081234567890', text: true, parse: phoneCell },
  { key: 'paymentBankName', example: 'BCA' },
  { key: 'paymentBankAccountNumber', example: '1234567890', text: true, parse: plainDigitsCell },
  { key: 'paymentBankAccountHolder', example: 'PT Hydromart' },
  { key: 'paymentQrisImageUrl', example: '', text: true },
  ...DAYS.flatMap(([id, en]) => [
    {
      key: `${id}Buka`,
      field: `operatingHours.${en}.open`,
      example: '08:00',
      text: true,
      parse: hhmmCell,
    },
    {
      // i18n-ok: column header the person fills in, not interface copy.
      key: `${id}Tutup`,
      field: `operatingHours.${en}.close`,
      example: '20:00',
      text: true,
      parse: hhmmCell,
    },
    {
      key: `${id}IstirahatMulai`,
      field: `operatingHours.${en}.breakStart`,
      example: '',
      text: true,
      parse: hhmmCell,
    },
    {
      key: `${id}IstirahatSelesai`,
      field: `operatingHours.${en}.breakEnd`,
      example: '',
      text: true,
      parse: hhmmCell,
    },
  ]),
  {
    key: 'hariLibur',
    field: 'holidays',
    // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
    example: '2026-08-17:Hari Kemerdekaan|2026-12-25',
    text: true,
    parse: holidaysCell,
  },
  ...SETTINGS.map(([key, example]) => ({
    key,
    field: `settings.${key}`,
    example,
    parse: intCell,
  })),
  {
    key: 'areaLayanan',
    field: 'serviceArea',
    example: '-6.2,106.8|-6.2,107.0|-6.0,107.0|-6.0,106.8',
    text: true,
    parse: areaCell,
  },
];
