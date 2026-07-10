import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { CustomerModule } from '../../src/modules/customer.module';
import { CUSTOMER_TOKENS } from '../../src/application/tokens';
import { MembershipTier } from '../../src/domain/membership-tier.enum';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeLoyaltyReward,
  InMemoryAddressRepository,
  InMemoryNotificationRepository,
  InMemoryProfileRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Customer HTTP flows (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let adminToken: string;
  const loyalty = new FakeLoyaltyReward();
  const addresses = new InMemoryAddressRepository();
  const profiles = new InMemoryProfileRepository(addresses);

  beforeAll(async () => {
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [
            () => ({
              NODE_ENV: 'test',
              CUSTOMER_SERVICE_PORT: 3002,
              CUSTOMER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              MAX_ADDRESSES_PER_CUSTOMER: 20,
              LOYALTY_SERVICE_URL: 'http://loyalty.test',
              BIRTHDAY_REWARD_POINTS: 250,
            }),
          ],
        }),
        CustomerModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(CUSTOMER_TOKENS.ProfileRepository)
      .useValue(profiles)
      .overrideProvider(CUSTOMER_TOKENS.AddressRepository)
      .useValue(addresses)
      .overrideProvider(CUSTOMER_TOKENS.NotificationPreferenceRepository)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(CUSTOMER_TOKENS.LoyaltyRewardPort)
      .useValue(loyalty)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Sign with the secret the app actually resolves, so the guard verifies it.
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    token = jwt.sign({ sub: 'cust-1', role: Role.CUSTOMER, phone: '+6281234567890' }, { secret });
    adminToken = jwt.sign({ sub: 'admin-1', role: Role.SUPER_ADMIN }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  it('rejects requests without a token', async () => {
    await request(server()).get('/api/v1/profile').expect(401);
  });

  it('lazily returns a default profile', async () => {
    const res = await auth(request(server()).get('/api/v1/profile')).expect(200);
    expect(res.body).toMatchObject({ membershipTier: 'BASIC', pointBalance: 0 });
  });

  it('runs the address journey: create → list → set primary → delete', async () => {
    const a = await auth(
      request(server()).post('/api/v1/addresses').send({
        label: 'Rumah',
        recipientName: 'Budi',
        phone: '081234567890',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        province: 'Jawa Barat',
      }),
    ).expect(201);
    expect(a.body.isPrimary).toBe(true);

    const b = await auth(
      request(server()).post('/api/v1/addresses').send({
        label: 'Kantor',
        recipientName: 'Budi',
        phone: '081234567890',
        addressLine: 'Jl. Asia Afrika 1',
        city: 'Bandung',
        province: 'Jawa Barat',
      }),
    ).expect(201);

    await auth(request(server()).post(`/api/v1/addresses/${b.body.id}/primary`)).expect(200);
    const list = await auth(request(server()).get('/api/v1/addresses')).expect(200);
    expect(list.body.find((x: { id: string }) => x.id === b.body.id).isPrimary).toBe(true);

    await auth(request(server()).delete(`/api/v1/addresses/${a.body.id}`)).expect(204);
    const after = await auth(request(server()).get('/api/v1/addresses')).expect(200);
    expect(after.body).toHaveLength(1);
  });

  it('validates the payload (400) and rejects a bad uuid param (400)', async () => {
    await auth(request(server()).post('/api/v1/addresses').send({ label: '' })).expect(400);
    await auth(request(server()).get('/api/v1/addresses/not-a-uuid')).expect(400);
  });

  it('updates notification preferences', async () => {
    const res = await auth(
      request(server()).patch('/api/v1/profile/notifications').send({ whatsapp: false }),
    ).expect(200);
    expect(res.body).toMatchObject({ push: true, whatsapp: false });
  });

  it('sets DOB and runs the birthday sweep (admin grants points, customer forbidden)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const set = await auth(
      request(server()).patch('/api/v1/profile').send({ birthdate: today }),
    ).expect(200);
    expect(set.body.birthdate).toBe(today);

    // Customer cannot trigger the sweep.
    await auth(request(server()).post('/api/v1/profile/birthday-rewards')).expect(403);

    // Admin sweeps: cust-1 has a birthday today → one grant.
    const res = await request(server())
      .post('/api/v1/profile/birthday-rewards')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(res.body).toMatchObject({ granted: 1, failed: 0, disabled: false });
    expect(loyalty.calls.some((c) => c.customerId === 'cust-1' && c.points === 250)).toBe(true);
  });

  it('rejects a malformed birthdate (400)', async () => {
    await auth(request(server()).patch('/api/v1/profile').send({ birthdate: '17-05-1990' })).expect(400);
  });

  it('resolves the CRM broadcast segment by tier + city, staff-only (FR-087)', async () => {
    // Seed a SILVER customer in Depok and a BASIC customer in Bogor, each with a primary address.
    const nullGeo = { postalCode: null, latitude: null, longitude: null };
    await profiles.setTier('seg-silver', MembershipTier.SILVER);
    await addresses.create({
      customerId: 'seg-silver',
      label: 'Rumah',
      recipientName: 'Sinta',
      phone: '+628111',
      addressLine: 'Jl. A',
      city: 'Depok',
      province: 'Jawa Barat',
      isPrimary: true,
      ...nullGeo,
    });
    await profiles.create('seg-basic');
    await addresses.create({
      customerId: 'seg-basic',
      label: 'Rumah',
      recipientName: 'Bima',
      phone: '+628222',
      addressLine: 'Jl. B',
      city: 'Bogor',
      province: 'Jawa Barat',
      isPrimary: true,
      ...nullGeo,
    });

    // Customer cannot read the directory.
    await auth(request(server()).get('/api/v1/profile/directory')).expect(403);

    const admin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
    const res = await admin(
      request(server()).get('/api/v1/profile/directory').query({ tier: 'SILVER', city: 'depok' }),
    ).expect(200);
    expect(res.body).toEqual([{ customerId: 'seg-silver', name: 'Sinta', phone: '+628111' }]);
  });

  it('rejects an invalid tier filter (400)', async () => {
    await request(server())
      .get('/api/v1/profile/directory')
      .query({ tier: 'PLATINUM' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
