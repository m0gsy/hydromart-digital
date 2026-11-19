import { TEST_KEY as KEY } from './http-env';

import { BadRequestException, type INestApplication, PayloadTooLargeException, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { EmbedService } from '../../src/application/embed.service';
import { EngineBusyError, NoFaceError } from '../../src/domain/errors';
import { configureBodyLimits, MAX_JPEG_BYTES } from '../../src/http/body-limits';
import { FACE_ENGINE, type FaceEngine } from '../../src/infrastructure/onnx-face.engine';
import { EmbedController } from '../../src/modules/embed.controller';

const JPEG = readFileSync(join(__dirname, '../fixtures/same_a.jpg'));

describe('face-service over HTTP', () => {
  let app: INestApplication;
  const engine: jest.Mocked<FaceEngine> = {
    embed: jest.fn(),
    selfCheck: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FACE_ENGINE)
      .useValue(engine)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    configureBodyLimits(app);
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    engine.embed.mockReset().mockResolvedValue({ vector: new Array(128).fill(0.088), detScore: 0.93 });
  });

  const embed = () => request(app.getHttpServer()).post('/api/v1/internal/embed');

  it('answers /health', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'face-service' });
  });

  it('refuses a call without the service key', async () => {
    const res = await embed().set('Content-Type', 'image/jpeg').send(JPEG);
    expect(res.status).toBe(401);
    expect(engine.embed).not.toHaveBeenCalled();
  });

  it('embeds a JPEG sent as the raw body', async () => {
    const res = await embed().set('x-internal-key', KEY).set('Content-Type', 'image/jpeg').send(JPEG);
    expect(res.status).toBe(200);
    expect(res.body.vector).toHaveLength(128);
    expect(res.body.detScore).toBeCloseTo(0.93);
    expect(engine.embed.mock.calls[0][0].equals(JPEG)).toBe(true);
  });

  it('says NO_FACE (422) when there is no face, and ENGINE_BUSY (503) when the queue is full', async () => {
    engine.embed.mockRejectedValueOnce(new NoFaceError());
    const none = await embed().set('x-internal-key', KEY).set('Content-Type', 'image/jpeg').send(JPEG);
    expect([none.status, none.body.code]).toEqual([422, 'NO_FACE']);
    engine.embed.mockRejectedValueOnce(new EngineBusyError());
    const busy = await embed().set('x-internal-key', KEY).set('Content-Type', 'image/jpeg').send(JPEG);
    expect([busy.status, busy.body.code]).toEqual([503, 'ENGINE_BUSY']);
  });

  it('refuses what is not a JPEG before anything decodes it', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const res = await embed().set('x-internal-key', KEY).set('Content-Type', 'image/jpeg').send(png);
    expect([res.status, res.body.code]).toEqual([422, 'UNREADABLE_IMAGE']);
    expect(engine.embed).not.toHaveBeenCalled();
  });

  it('wants the image as the body, not JSON', async () => {
    const res = await embed().set('x-internal-key', KEY).send({ image: 'data:image/jpeg;base64,AAA' });
    expect(res.status).toBe(400);
  });

  it('refuses a body over 2 MB at the parser', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_JPEG_BYTES)]);
    const res = await embed().set('x-internal-key', KEY).set('Content-Type', 'image/jpeg').send(big);
    expect(res.status).toBe(413);
    expect(engine.embed).not.toHaveBeenCalled();
  });
});

describe('EmbedController, called directly', () => {
  const svc = { embed: jest.fn() } as unknown as EmbedService;
  const controller = new EmbedController(svc);
  const req = (body: unknown) => ({ body }) as never;

  it('refuses an empty or missing body', async () => {
    await expect(controller.embed(req(Buffer.alloc(0)))).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.embed(req(undefined))).rejects.toBeInstanceOf(BadRequestException);
  });
  it('holds the 2 MB cap even without the parser in front of it', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_JPEG_BYTES)]);
    await expect(controller.embed(req(big))).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
