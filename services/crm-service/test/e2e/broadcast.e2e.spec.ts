import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { CampaignModule } from '../../src/modules/campaign.module';
import { CRM_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeCustomerDirectory,
  FakeWhatsappBroadcast,
  InMemoryBroadcastRepository,
  InMemoryCampaignRepository,
  InMemoryNotificationRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Broadcast HTTP flows (e2e)', () => {
  let app: INestApplication;
  let operatorToken: string;
  let driverToken: string;
  const depotId = 'depot-1';

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
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
              CRM_SERVICE_PORT: 3012,
              CRM_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              WHATSAPP_API_URL: '',
              WHATSAPP_API_TOKEN: '',
              INTERNAL_SERVICE_KEY: 'test-internal-key',
            }),
          ],
        }),
        CampaignModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(CRM_TOKENS.CampaignRepository)
      .useValue(new InMemoryCampaignRepository())
      .overrideProvider(CRM_TOKENS.NotificationRepository)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(CRM_TOKENS.BroadcastRepository)
      .useValue(new InMemoryBroadcastRepository())
      .overrideProvider(CRM_TOKENS.WhatsappBroadcast)
      .useValue(new FakeWhatsappBroadcast())
      .overrideProvider(CRM_TOKENS.CustomerDirectory)
      .useValue(new FakeCustomerDirectory())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    // DEPOT_OPERATOR is depot-locked by the platform DepotScopeGuard: its token must carry the
    // depotId it acts on, or broadcasts scoped to `depot-1` get 403.
    operatorToken = jwt.sign({ sub: randomUUID(), role: Role.DEPOT_OPERATOR, phone: '+62', depotId }, { secret });
    driverToken = jwt.sign({ sub: randomUUID(), role: Role.DRIVER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const body = () => ({ depotId, title: 'Jalan ditutup', body: 'Pakai jalur alternatif.', level: 'URGENT' });

  let broadcastId: string;

  it('rejects a DRIVER posting a broadcast with 403', async () => {
    await request(server()).post('/api/v1/broadcasts').set(auth(driverToken)).send(body()).expect(403);
  });

  it('lets a DEPOT_OPERATOR post a broadcast (201)', async () => {
    const res = await request(server())
      .post('/api/v1/broadcasts')
      .set(auth(operatorToken))
      .send(body())
      .expect(201);
    expect(res.body).toMatchObject({ depotId, level: 'URGENT', read: false });
    broadcastId = res.body.id;
  });

  it('lets a courier list the depot broadcasts (unread)', async () => {
    const res = await request(server())
      .get(`/api/v1/broadcasts?depotId=${depotId}`)
      .set(auth(driverToken))
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: broadcastId, read: false });
  });

  it('marks a broadcast read (204) and reflects it in the list', async () => {
    await request(server())
      .post(`/api/v1/broadcasts/${broadcastId}/read`)
      .set(auth(driverToken))
      .expect(204);
    const res = await request(server())
      .get(`/api/v1/broadcasts?depotId=${depotId}`)
      .set(auth(driverToken))
      .expect(200);
    expect(res.body[0]).toMatchObject({ id: broadcastId, read: true });
  });

  it('404s marking an unknown broadcast read', async () => {
    await request(server())
      .post(`/api/v1/broadcasts/${randomUUID()}/read`)
      .set(auth(driverToken))
      .expect(404);
  });

  it('rejects an anonymous list with 401', async () => {
    await request(server()).get(`/api/v1/broadcasts?depotId=${depotId}`).expect(401);
  });
});
