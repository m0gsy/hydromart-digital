import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AllExceptionsFilter,
  DepotScopeGuard,
  GlobalValidationPipe,
  JwtAuthGuard,
  Role,
  RolesGuard,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from '@hydromart/platform';

import { EmployeeLegalEntityService } from '../../src/application/services/employee-legal-entity.service';
import { EmployeeLegalEntityController } from '../../src/modules/employee-legal-entity.controller';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const ID = '11111111-1111-4111-8111-111111111111';

/**
 * HD-5 over HTTP, with the guards hr-service installs globally: the employee half of
 * /hq/legal-entities is head office's (`legalEntityAdmin`). HR holds `hrAdmin`, which is not it.
 */
describe('/employee-legal-entities over HTTP', () => {
  let app: INestApplication;
  let sign: (role: Role) => string;
  const service = {
    histories: jest.fn().mockResolvedValue([]),
    assign: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: SECRET })] }),
        JwtModule.register({}),
      ],
      controllers: [EmployeeLegalEntityController],
      providers: [
        { provide: EmployeeLegalEntityService, useValue: service },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: DepotScopeGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = app.get(JwtService);
    sign = (role) =>
      jwt.sign(
        { sub: ID, role, phone: '+62', depotId: null },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const as = (role: Role) => ({ Authorization: `Bearer ${sign(role)}` });
  const body = { employeeIds: [ID], legalEntityId: ID, effectiveFrom: '2026-12-01', seen: [] };

  it('refuses anonymous, HR, a manager and finance', async () => {
    await request(server()).get('/api/v1/employee-legal-entities').expect(401);
    for (const role of [Role.HR, Role.MANAGER, Role.FINANCE, Role.KEPALA_DEPOT]) {
      await request(server()).get('/api/v1/employee-legal-entities').set(as(role)).expect(403);
      await request(server()).post('/api/v1/employee-legal-entities').set(as(role)).send(body).expect(403);
      await request(server()).delete(`/api/v1/employee-legal-entities/${ID}`).set(as(role)).expect(403);
    }
    expect(service.assign).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('lets head office and the director in, and wants what the screen saw', async () => {
    await request(server()).get('/api/v1/employee-legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    await request(server()).get('/api/v1/employee-legal-entities').set(as(Role.DIREKTUR)).expect(200);
    const withoutSeen = { employeeIds: body.employeeIds, legalEntityId: body.legalEntityId, effectiveFrom: body.effectiveFrom };
    await request(server()).post('/api/v1/employee-legal-entities').set(as(Role.HEAD_OFFICE)).send(withoutSeen).expect(400);
    await request(server()).post('/api/v1/employee-legal-entities').set(as(Role.HEAD_OFFICE)).send(body).expect(201);
    await request(server()).delete(`/api/v1/employee-legal-entities/${ID}`).set(as(Role.DIREKTUR)).expect(204);
    expect(service.assign).toHaveBeenCalledWith(expect.objectContaining({ seen: [] }), ID);
    expect(service.remove).toHaveBeenCalledWith(ID, ID);
  });
});
