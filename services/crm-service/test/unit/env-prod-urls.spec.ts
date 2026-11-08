import { envValidationSchema } from '../../src/config/env.validation';

// CRM-08: these URLs are what lets a campaign resolve its audience. Blank was ACCEPTED in production,
// where the service then booted "healthy" and every call to the missing peer failed, quietly.
// docker-compose.prod.yml sets all of them for this service, so requiring them costs nothing.
describe('production env: peer service URLs', () => {
  const complained = (env: Record<string, string>): string[] =>
    (envValidationSchema.validate(env, { abortEarly: false, allowUnknown: true }).error?.details ?? []).map(
      (d) => String(d.path[0]),
    );

  it.each(['CUSTOMER_SERVICE_URL'])('requires %s in production', (key) => {
    expect(complained({ NODE_ENV: 'production' })).toContain(key);
    expect(complained({ NODE_ENV: 'production', [key]: '' })).toContain(key);
  });

  it.each(['CUSTOMER_SERVICE_URL'])('accepts %s when it is set in production', (key) => {
    expect(complained({ NODE_ENV: 'production', [key]: 'http://peer:3000' })).not.toContain(key);
  });

  it.each(['CUSTOMER_SERVICE_URL'])('%s may stay blank outside production (a laptop runs one service)', (key) => {
    expect(complained({ NODE_ENV: 'development', [key]: '' })).not.toContain(key);
  });
});
