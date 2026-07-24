import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

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

  private tunableNum(key: string, envValue: number, depotId: string | null = null): number {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, envValue, depotId) as number;
  }

  private tunableStr(key: string, envValue: string, depotId: string | null = null): string {
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
    return this.tunableStr('workStartTime', this.config.get<string>('HR_WORK_START_TIME', '08:00'), depotId);
  }
  lateToleranceMinutes(depotId: string | null = null): number {
    return this.tunableNum('lateToleranceMinutes', this.num('HR_LATE_TOLERANCE_MINUTES'), depotId);
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
    return this.tunableNum('standardWorkingMinutes', this.num('HR_STANDARD_WORKING_MINUTES'), depotId);
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

  // --- Photo storage (attendance frames + enrolled face source photos). Same env var
  // names as auth-service; 's3' enables uploads, anything else = no-op (photoUrl null). ---
  get storageDriver(): string {
    return this.config.get<string>('STORAGE_DRIVER', 'disabled');
  }
  get storagePublicBaseUrl(): string {
    return this.config.get<string>('STORAGE_PUBLIC_BASE_URL', '');
  }
  get s3(): { region: string; endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } {
    return {
      region: this.config.get<string>('STORAGE_S3_REGION', 'auto'),
      endpoint: this.config.get<string>('STORAGE_S3_ENDPOINT', ''),
      bucket: this.config.get<string>('STORAGE_S3_BUCKET', ''),
      accessKeyId: this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID', ''),
      secretAccessKey: this.config.get<string>('STORAGE_S3_SECRET_ACCESS_KEY', ''),
    };
  }
}
