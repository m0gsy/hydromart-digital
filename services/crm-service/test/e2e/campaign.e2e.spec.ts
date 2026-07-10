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
import { FakeWhatsappBroadcast, InMemoryCampaignRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Campaign HTTP flows (e2e)', () => {
  let app: INestApplication;
  let marketingToken: string;
  let customerToken: string;

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
              CRM_SERVICE_PORT: 3012,
              CRM_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              WHATSAPP_API_URL: '',
              WHATSAPP_API_TOKEN: '',
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
      .overrideProvider(CRM_TOKENS.WhatsappBroadcast)
      .useValue(new FakeWhatsappBroadcast())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    marketingToken = jwt.sign({ sub: randomUUID(), role: Role.MARKETING, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const campaignBody = () => ({
    name: 'Launch Blast',
    messageTemplate: 'Hi {{name}}!',
    recipients: [{ phone: '+6281234567890', name: 'Andi' }],
  });

  let campaignId: string;

  it('rejects anonymous create with 401', async () => {
    await request(server()).post('/api/v1/campaigns').send(campaignBody()).expect(401);
  });

  it('rejects a CUSTOMER creating a campaign with 403', async () => {
    await request(server())
      .post('/api/v1/campaigns')
      .set(auth(customerToken))
      .send(campaignBody())
      .expect(403);
  });

  it('lets MARKETING create a draft campaign (201)', async () => {
    const res = await request(server())
      .post('/api/v1/campaigns')
      .set(auth(marketingToken))
      .send(campaignBody())
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', totalRecipients: 1 });
    expect(res.body.recipients).toHaveLength(1);
    campaignId = res.body.id;
  });

  it('sends the campaign: DRAFT -> SENT and returns counts', async () => {
    const res = await request(server())
      .post(`/api/v1/campaigns/${campaignId}/send`)
      .set(auth(marketingToken))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'SENT', sentCount: 1, failedCount: 0 });
  });

  it('restricts list to staff (403 customer, 200 marketing)', async () => {
    await request(server()).get('/api/v1/campaigns').set(auth(customerToken)).expect(403);
    const res = await request(server())
      .get('/api/v1/campaigns')
      .set(auth(marketingToken))
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});
