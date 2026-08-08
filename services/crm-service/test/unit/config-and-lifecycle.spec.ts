import { ConfigService } from '@nestjs/config';

import { CrmConfigService } from '../../src/config/crm-config.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { SegmentUnavailableError } from '../../src/domain/errors';

// Config getters (each maps env → typed value, incl. defaults / split / trim / filter),
// the SegmentUnavailableError no-detail branch, and the PrismaService connect/disconnect
// lifecycle (spied so no real Postgres is touched).

function cfg(values: Record<string, string>): CrmConfigService {
  const config = {
    get: <T>(key: string, def?: T): T =>
      key in values ? (values[key] as unknown as T) : (def as T),
    getOrThrow: (key: string): string => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
  return new CrmConfigService(config);
}

describe('CrmConfigService', () => {
  it('defaults nodeEnv to development and isProduction to false', () => {
    const c = cfg({});
    expect(c.nodeEnv).toBe('development');
    expect(c.isProduction).toBe(false);
  });

  it('reports production when NODE_ENV=production', () => {
    expect(cfg({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('coerces the numeric port via getOrThrow', () => {
    expect(cfg({ CRM_SERVICE_PORT: '3012' }).port).toBe(3012);
  });

  it('splits, trims and drops blank CORS origins', () => {
    expect(cfg({ CORS_ALLOWED_ORIGINS: 'http://a , http://b ,' }).corsOrigins).toEqual([
      'http://a',
      'http://b',
    ]);
  });

  it('defaults CORS origins to localhost:3000', () => {
    expect(cfg({}).corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('reads the rate-limit pair', () => {
    expect(cfg({ RATE_LIMIT_TTL_SECONDS: '60', RATE_LIMIT_MAX: '100' }).rateLimit).toEqual({
      ttlSeconds: 60,
      limit: 100,
    });
  });

  it('reads WhatsApp config (blank defaults)', () => {
    expect(cfg({}).whatsapp).toEqual({ baseUrl: '', token: '' });
    expect(cfg({ WHATSAPP_API_URL: 'http://wa', WHATSAPP_API_TOKEN: 'tok' }).whatsapp).toEqual({
      baseUrl: 'http://wa',
      token: 'tok',
    });
  });

  it('trims the customer-service URL', () => {
    expect(cfg({ CUSTOMER_SERVICE_URL: '  http://cust  ' }).customerServiceUrl).toBe('http://cust');
  });

  it('reads and trims the VAPID keypair, defaulting the subject', () => {
    expect(cfg({ VAPID_PUBLIC_KEY: ' pub ', VAPID_PRIVATE_KEY: ' priv ' }).vapid).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:ops@hydromart.id',
    });
  });

  /**
   * F4. The PEM is the whole point of this test: env files and docker-compose
   * `environment:` blocks cannot carry a real newline, so the key arrives with them
   * escaped. Leave them escaped and `createSign` rejects the key, which surfaces as
   * "every Android push fails" long after anyone is still looking at config.
   */
  it('turns the escaped newlines in the FCM private key back into real ones', () => {
    const config = cfg({
      FCM_PROJECT_ID: ' hydromart ',
      FCM_CLIENT_EMAIL: ' push@hydromart.iam.gserviceaccount.com ',
      FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n',
    }).fcm;

    expect(config.projectId).toBe('hydromart');
    expect(config.clientEmail).toBe('push@hydromart.iam.gserviceaccount.com');
    // Trailing newline kept: `trim()` runs before the unescape, so the final `\n` of a
    // PEM survives — which is what OpenSSL expects to see.
    expect(config.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
    );
  });

  it('reports blank FCM credentials as blank, so the adapter can disable itself', () => {
    expect(cfg({}).fcm).toEqual({ projectId: '', clientEmail: '', privateKey: '' });
  });
});

describe('SegmentUnavailableError', () => {
  it('omits the detail suffix when no detail is given', () => {
    expect(new SegmentUnavailableError().message).toBe('Could not resolve the audience segment.');
  });

  it('appends the detail when provided', () => {
    expect(new SegmentUnavailableError('down').message).toBe(
      'Could not resolve the audience segment: down.',
    );
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on module init and disconnects on destroy', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
