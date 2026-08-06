import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { StatutoryRates } from '../domain/statutory';
import { SETTING_DEF_BY_KEY } from './setting-defs';

/**
 * Typed config for hr-service. Business tunables (attendance/payroll) resolve through the
 * SettingsCache: depot override ?? global override ?? this getter's own ENV read.
 */
@Injectable()
export class HrConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  private tunableNum(key: string, envValue: number, depotId: string | null): number {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, envValue, depotId) as number;
  }

  private tunableStr(key: string, envValue: string, depotId: string | null): string {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, envValue, depotId) as string;
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('HR_SERVICE_PORT');
  }
  get corsOrigins(): string[] {
    return this.config
      .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
  get rateLimit(): { ttlSeconds: number; limit: number } {
    return { ttlSeconds: this.num('RATE_LIMIT_TTL_SECONDS'), limit: this.num('RATE_LIMIT_MAX') };
  }
  get timeZone(): string {
    return this.config.get<string>('PRICING_TZ', 'Asia/Jakarta');
  }

  // --- Attendance / payroll effective business values (per depot) ---
  workStartTime(depotId: string | null = null): string {
    return this.tunableStr(
      'workStartTime',
      this.config.get<string>('HR_WORK_START_TIME', '08:00'),
      depotId,
    );
  }
  lateToleranceMinutes(depotId: string | null = null): number {
    return this.tunableNum('lateToleranceMinutes', this.num('HR_LATE_TOLERANCE_MINUTES'), depotId);
  }
  /** Sync delay a device-timestamped punch may have before HR has to approve it (0 = never auto-accept). */
  offlineAutoAcceptMinutes(depotId: string | null = null): number {
    return this.tunableNum('offlineAutoAcceptMinutes', 10, depotId);
  }
  /** Oldest device timestamp still accepted; past this the punch needs a manual HR entry. */
  offlineMaxAgeHours(depotId: string | null = null): number {
    return this.tunableNum('offlineMaxAgeHours', 24, depotId);
  }
  lateDeductionAmount(depotId: string | null = null): number {
    return this.tunableNum('lateDeductionAmount', this.num('HR_LATE_DEDUCTION_IDR'), depotId);
  }
  dailyRateTraining(depotId: string | null = null): number {
    return this.tunableNum('dailyRateTraining', this.num('HR_DAILY_RATE_TRAINING_IDR'), depotId);
  }
  absenceDeductionAmount(depotId: string | null = null): number {
    return this.tunableNum('absenceDeductionAmount', this.num('HR_ABSENCE_DEDUCTION_IDR'), depotId);
  }
  standardWorkingMinutes(depotId: string | null = null): number {
    return this.tunableNum(
      'standardWorkingMinutes',
      this.num('HR_STANDARD_WORKING_MINUTES'),
      depotId,
    );
  }
  /** Weekly non-working weekdays as a CSV ("0,6"); '' = every day is a working day. */
  /** M24-17: ×100 so the settings store stays integer-only (150 = 1.5×). */
  overtimeMultiplierPct(depotId: string | null = null): number {
    return this.tunableNum(
      'overtimeMultiplierPct',
      Number(this.config.get<string>('HR_OVERTIME_MULTIPLIER_PCT', '150')),
      depotId,
    );
  }

  /**
   * The statutory deduction rates (Q-13): BPJS employee shares, their wage ceilings,
   * biaya jabatan and the no-NPWP surcharge.
   *
   * Percentages are stored ×100 in the settings store (integer-only) and divided back
   * here, so callers deal in real percentages. Every value is per-depot tunable for the
   * same reason the rest are: a rate changes by regulation, not by release.
   */
  statutoryRates(depotId: string | null = null): StatutoryRates {
    const pct = (key: string, env: string, fallback: string): number =>
      this.tunableNum(key, Number(this.config.get<string>(env, fallback)), depotId) / 100;
    const idr = (key: string, env: string, fallback: string): number =>
      this.tunableNum(key, Number(this.config.get<string>(env, fallback)), depotId);
    return {
      healthEmployeePct: pct('bpjsHealthEmployeePctX100', 'HR_BPJS_HEALTH_EMPLOYEE_PCT_X100', '100'),
      healthCeilingIdr: idr('bpjsHealthCeilingIdr', 'HR_BPJS_HEALTH_CEILING_IDR', '12000000'),
      jhtEmployeePct: pct('bpjsJhtEmployeePctX100', 'HR_BPJS_JHT_EMPLOYEE_PCT_X100', '200'),
      jpEmployeePct: pct('bpjsJpEmployeePctX100', 'HR_BPJS_JP_EMPLOYEE_PCT_X100', '100'),
      jpCeilingIdr: idr('bpjsJpCeilingIdr', 'HR_BPJS_JP_CEILING_IDR', '10547400'),
      occupationalCostPct: pct('occupationalCostPctX100', 'HR_OCCUPATIONAL_COST_PCT_X100', '500'),
      occupationalCostCapIdr: idr('occupationalCostCapIdr', 'HR_OCCUPATIONAL_COST_CAP_IDR', '500000'),
      noNpwpSurchargePct: idr('noNpwpSurchargePct', 'HR_NO_NPWP_SURCHARGE_PCT', '20'),
    };
  }

  /** Weekly-off days and national holidays share this rate (M24-17). */
  overtimeOffDayMultiplierPct(depotId: string | null = null): number {
    return this.tunableNum(
      'overtimeOffDayMultiplierPct',
      Number(this.config.get<string>('HR_OVERTIME_OFF_DAY_MULTIPLIER_PCT', '200')),
      depotId,
    );
  }

  /** Working days of ANNUAL/PERMISSION leave an employee gets per calendar year. */
  annualLeaveQuotaDays(depotId: string | null = null): number {
    return this.tunableNum(
      'annualLeaveQuotaDays',
      Number(this.config.get<string>('HR_ANNUAL_LEAVE_QUOTA_DAYS', '12')),
      depotId,
    );
  }
  weeklyOffDays(depotId: string | null = null): string {
    return this.tunableStr(
      'weeklyOffDays',
      this.config.get<string>('HR_WEEKLY_OFF_DAYS', ''),
      depotId,
    );
  }
  /** Component weights for the performance score. They need not add to 100 (C2). */
  performanceWeights(depotId: string | null = null): {
    attendance: number;
    discipline: number;
    sales: number;
  } {
    return {
      attendance: this.tunableNum('perfWeightAttendance', 40, depotId),
      discipline: this.tunableNum('perfWeightDiscipline', 30, depotId),
      sales: this.tunableNum('perfWeightSales', 30, depotId),
    };
  }
  /** Monthly depot sales target the sales component scores against; 0 = no target set. */
  performanceSalesTarget(depotId: string | null = null): number {
    return this.tunableNum('perfSalesTargetMonthly', 0, depotId);
  }
  /** Attendance geofence for a depot: centre (lat/lng, '' = unset) + radius (0 = disabled). */
  geofence(depotId: string | null = null): {
    lat: number | null;
    lng: number | null;
    radiusM: number;
  } {
    const parse = (s: string): number | null => {
      const n = Number(s);
      return s.trim() !== '' && Number.isFinite(n) ? n : null;
    };
    return {
      lat: parse(this.tunableStr('geofenceLat', '', depotId)),
      lng: parse(this.tunableStr('geofenceLng', '', depotId)),
      radiusM: this.tunableNum('geofenceRadiusM', 0, depotId),
    };
  }
  /** Depot-head tenure raise ladder as CSV ("1:5,2:10"); '' = no automatic raise (Rule-E). */
  tenureRaiseLadder(depotId: string | null = null): string {
    return this.tunableStr(
      'tenureRaiseLadder',
      this.config.get<string>('HR_TENURE_RAISE_LADDER', ''),
      depotId,
    );
  }

  // --- Face recognition (read straight from ENV; not per-depot user-facing) ---
  get faceVerifierDriver(): string {
    return this.config.get<string>('FACE_VERIFIER_DRIVER', 'onnx');
  }
  get faceMatchThreshold(): number {
    return this.num('HR_FACE_MATCH_THRESHOLD');
  }
  get faceDuplicateThreshold(): number {
    return this.num('HR_FACE_DUPLICATE_THRESHOLD');
  }
  get faceModelPath(): string {
    return this.config.get<string>('HR_FACE_MODEL_PATH', './models/arcface.onnx');
  }
  get faceServiceUrl(): string {
    return this.config.get<string>('FACE_SERVICE_URL', '');
  }
  /**
   * Key the enrolled embeddings are encrypted with at rest (B-19). Required in production
   * by env validation; the dev fallback keeps a local box and CI running on throwaway data.
   */
  get faceEncryptionKey(): string {
    return this.config.get<string>('HR_FACE_ENCRYPTION_KEY', 'hydromart-dev-face-key');
  }
  /** order-service base URL + internal key for the SALES_TOTAL bonus aggregate. */
  get orderService(): { url: string; internalKey: string } {
    return {
      url: this.config.get<string>('ORDER_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }
  /** auth-service base URL + internal key for provisioning staff logins on import. */
  get authService(): { url: string; internalKey: string } {
    return {
      url: this.config.get<string>('AUTH_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }
  /** crm-service base URL + internal key for HR notifications (in-app feed + WhatsApp). */
  get crmService(): { url: string; internalKey: string } {
    return {
      url: this.config.get<string>('CRM_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }
  /** BiznetGio NEO Face Recognition (FACE_VERIFIER_DRIVER=neo). Token is box-`.env` only. */
  get neoFr(): { endpoint: string; token: string; galleryId: string } {
    return {
      endpoint: this.config.get<string>('NEO_FR_ENDPOINT', 'https://fr.neoapi.id'),
      token: this.config.get<string>('NEO_FR_TOKEN', ''),
      galleryId: this.config.get<string>('NEO_FR_GALLERY_ID', 'hydromart-hr'),
    };
  }

  // --- Photo storage (attendance frames + enrolled face source photos). Same env var
  // names as auth-service; 's3' enables uploads, anything else = no-op (photoUrl null). ---
  get storageDriver(): string {
    return this.config.get<string>('STORAGE_DRIVER', 'disabled');
  }
  get storagePublicBaseUrl(): string {
    return this.config.get<string>('STORAGE_PUBLIC_BASE_URL', '');
  }
  get s3(): {
    region: string;
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } {
    return {
      region: this.config.get<string>('STORAGE_S3_REGION', 'auto'),
      endpoint: this.config.get<string>('STORAGE_S3_ENDPOINT', ''),
      bucket: this.config.get<string>('STORAGE_S3_BUCKET', ''),
      accessKeyId: this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID', ''),
      secretAccessKey: this.config.get<string>('STORAGE_S3_SECRET_ACCESS_KEY', ''),
    };
  }
}
