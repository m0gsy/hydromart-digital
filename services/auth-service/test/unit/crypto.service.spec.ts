import { CryptoService } from '../../src/infrastructure/security/crypto.service';
import { buildTestConfig } from '../support/fakes';

describe('CryptoService', () => {
  const service = new CryptoService(buildTestConfig());

  it('generates numeric codes of the requested length', () => {
    const code = service.generateNumericCode(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('hashes and verifies a secret with bcrypt', async () => {
    const hash = await service.hashSecret('123456');
    expect(hash).not.toBe('123456');
    expect(await service.verifySecret('123456', hash)).toBe(true);
    expect(await service.verifySecret('654321', hash)).toBe(false);
  });

  it('produces a deterministic keyed hash for tokens', () => {
    const a = service.hashToken('opaque-token');
    const b = service.hashToken('opaque-token');
    const c = service.hashToken('different');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique high-entropy opaque tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => service.generateOpaqueToken()));
    expect(tokens.size).toBe(50);
  });

  it('generates valid UUIDs', () => {
    expect(service.uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
