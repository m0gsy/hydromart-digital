import { envValidationSchema } from '../../src/config/env.validation';

// The minimum a deploy must supply; every other key carries a schema default.
const BASE = {
  HR_DATABASE_URL: 'postgresql://u:p@localhost:5432/hr?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
};

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });
}

describe('hr env validation', () => {
  it('accepts a minimal valid env and applies defaults', () => {
    const { error, value } = validate({ ...BASE });
    expect(error).toBeUndefined();
    expect(value.HR_SERVICE_PORT).toBe(3018);
    expect(value.FACE_VERIFIER_DRIVER).toBe('onnx');
    expect(value.HR_FACE_MATCH_THRESHOLD).toBeCloseTo(0.62);
    expect(value.STORAGE_DRIVER).toBe('local');
    expect(value.PRICING_TZ).toBe('Asia/Jakarta');
  });

  it('requires HR_DATABASE_URL', () => {
    const { error } = validate({ JWT_ACCESS_SECRET: BASE.JWT_ACCESS_SECRET });
    expect(error?.message).toContain('HR_DATABASE_URL');
  });

  it('rejects a non-postgres database scheme', () => {
    const { error } = validate({ ...BASE, HR_DATABASE_URL: 'mysql://u:p@localhost:3306/hr' });
    expect(error?.message).toContain('HR_DATABASE_URL');
  });

  it('rejects a JWT secret shorter than 32 chars', () => {
    const { error } = validate({ ...BASE, JWT_ACCESS_SECRET: 'too-short' });
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects an unknown face verifier driver', () => {
    const { error } = validate({ ...BASE, FACE_VERIFIER_DRIVER: 'magic' });
    expect(error?.message).toContain('FACE_VERIFIER_DRIVER');
  });

  it('rejects an out-of-range face match threshold', () => {
    const { error } = validate({ ...BASE, HR_FACE_MATCH_THRESHOLD: '2' });
    expect(error?.message).toContain('HR_FACE_MATCH_THRESHOLD');
  });

  it('rejects a malformed work-start time', () => {
    const { error } = validate({ ...BASE, HR_WORK_START_TIME: '8am' });
    expect(error?.message).toContain('HR_WORK_START_TIME');
  });

  it('rejects an unknown storage driver', () => {
    const { error } = validate({ ...BASE, STORAGE_DRIVER: 'ftp' });
    expect(error?.message).toContain('STORAGE_DRIVER');
  });
});
