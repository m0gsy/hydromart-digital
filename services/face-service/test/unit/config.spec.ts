import { ConfigService } from '@nestjs/config';

import { envValidationSchema } from '../../src/config/env.validation';
import { FaceConfigService } from '../../src/config/face-config.service';

describe('env validation', () => {
  it('fills the defaults: port 3019, models under /app/models, eight waiting', () => {
    const { value, error } = envValidationSchema.validate({});
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      FACE_SERVICE_PORT: 3019,
      FACE_MODEL_DIR: '/app/models',
      FACE_QUEUE_MAX: 8,
      FACE_INFER_TIMEOUT_MS: 10000,
    });
  });
  it('requires the service key in production', () => {
    expect(envValidationSchema.validate({ NODE_ENV: 'production' }).error).toBeDefined();
    expect(
      envValidationSchema.validate({ NODE_ENV: 'production', INTERNAL_SERVICE_KEY: 'k'.repeat(32) }).error,
    ).toBeUndefined();
  });
  it('bounds the queue', () => {
    expect(envValidationSchema.validate({ FACE_QUEUE_MAX: 0 }).error).toBeDefined();
    expect(envValidationSchema.validate({ FACE_QUEUE_MAX: 65 }).error).toBeDefined();
  });
});

describe('FaceConfigService', () => {
  it('reads the validated values', () => {
    const values: Record<string, unknown> = {
      FACE_SERVICE_PORT: '3019',
      FACE_MODEL_DIR: '/m',
      FACE_QUEUE_MAX: '4',
      FACE_INFER_TIMEOUT_MS: '5000',
    };
    const cfg = new FaceConfigService({ getOrThrow: (k: string) => values[k] } as unknown as ConfigService);
    expect([cfg.port, cfg.modelDir, cfg.queueMax, cfg.inferTimeoutMs]).toEqual([3019, '/m', 4, 5000]);
  });
});
