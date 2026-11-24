import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import {
  LeavePendingFilter,
  PENDING_APPROVALS_READER,
  PendingSummary,
} from '../../src/application/ports/pending-approvals.reader';
import { EmployeeService } from '../../src/application/services/employee.service';
import { LoanRequestService } from '../../src/application/services/loan-request.service';
import { PendingApprovalsPrismaReader } from '../../src/infrastructure/prisma/pending-approvals.prisma.reader';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PendingApprovalsController } from '../../src/modules/pending-approvals.controller';

const INTERNAL_KEY = 'test-internal-service-key-01';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const OLDEST = new Date('2026-11-20T01:02:03.000Z');

/**
 * HD-11 over HTTP, with the real internal-key guard and validation pipe: leave at the stage the
 * person decides (never their own), and kasbon by the K1/K2 rule the decision inbox already uses.
 */
describe('Pending approvals, internal (HTTP)', () => {
  let app: INestApplication;
  const leave = jest.fn<Promise<PendingSummary>, [LeavePendingFilter]>(async () => ({
    count: 2,
    oldestAt: OLDEST,
  }));
  const decidableSummary = jest.fn<Promise<PendingSummary>, [string, readonly string[] | undefined]>(
    async () => ({ count: 1, oldestAt: null }),
  );
  let employee: { id: string } | null = { id: 'emp-me' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ INTERNAL_SERVICE_KEY: INTERNAL_KEY })],
        }),
      ],
      controllers: [PendingApprovalsController],
      providers: [
        { provide: PENDING_APPROVALS_READER, useValue: { leave } },
        { provide: EmployeeService, useValue: { findByAuthSubjectId: async () => employee } },
        { provide: LoanRequestService, useValue: { decidableSummary } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, key: string | null = INTERNAL_KEY) => {
    const req = request(app.getHttpServer()).get(`/api/v1/pending-approvals/internal/${path}`);
    return key ? req.set('x-internal-key', key) : req;
  };

  it("counts stage 1 for a manager, within their depots, never their own application", async () => {
    const res = await get(`leave?actorId=${ACTOR}&role=MANAGER&depotIds=${D1}`).expect(200);
    expect(res.body).toEqual({ count: 2, oldestAt: OLDEST.toISOString() });
    expect(leave).toHaveBeenLastCalledWith({
      status: 'PENDING_MANAGER',
      depotIds: [D1],
      notEmployeeId: 'emp-me',
      notManagerDecidedBy: null,
    });
  });

  it('counts stage 2 for HR, never one they signed at stage 1, an account with no record too', async () => {
    employee = null;
    await get(`leave?actorId=${ACTOR}&role=HR`).expect(200);
    employee = { id: 'emp-me' };
    expect(leave).toHaveBeenLastCalledWith({
      status: 'PENDING_HR',
      depotIds: undefined,
      notEmployeeId: null,
      notManagerDecidedBy: ACTOR,
    });
  });

  it('answers kasbon with the decision inbox rule, for the depots given', async () => {
    const res = await get(`kasbon?actorId=${ACTOR}&role=ASSISTANT_SUPERVISOR&depotIds=${D1}&depotIds=${D1}`).expect(200);
    expect(res.body).toEqual({ count: 1, oldestAt: null });
    expect(decidableSummary).toHaveBeenLastCalledWith(ACTOR, [D1, D1]);
  });

  it('turns away a call without the internal key, and a query of the wrong shape', async () => {
    await get(`kasbon?actorId=${ACTOR}&role=MANAGER`, null).expect(401);
    await get(`kasbon?actorId=${ACTOR}&role=MANAGER`, 'wrong-key').expect(401);
    await get(`leave?role=MANAGER`).expect(400);
    await get(`leave?actorId=${ACTOR}&role=MANAGER&depotIds=`).expect(400);
    await get(`leave?actorId=${ACTOR}&role=MANAGER&depotIds=nope`).expect(400);
  });
});

describe('PendingApprovalsPrismaReader', () => {
  const aggregate = jest.fn(async () => ({ _count: { _all: 6 }, _min: { createdAt: OLDEST } }));
  const reader = new PendingApprovalsPrismaReader({ leaveRequest: { aggregate } } as unknown as PrismaService);

  it('counts one stage, held to the depots given, without the asker and their stage-1 signature', async () => {
    await expect(
      reader.leave({ status: 'PENDING_HR', depotIds: [D1], notEmployeeId: 'emp-me', notManagerDecidedBy: ACTOR }),
    ).resolves.toEqual({ count: 6, oldestAt: OLDEST });
    expect(aggregate).toHaveBeenLastCalledWith({
      where: {
        status: 'PENDING_HR',
        depotId: { in: [D1] },
        employeeId: { not: 'emp-me' },
        OR: [{ managerDecidedBy: null }, { managerDecidedBy: { not: ACTOR } }],
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    await reader.leave({ status: 'PENDING_MANAGER', depotIds: undefined, notEmployeeId: null, notManagerDecidedBy: null });
    expect(aggregate).toHaveBeenLastCalledWith({
      where: { status: 'PENDING_MANAGER' },
      _count: { _all: true },
      _min: { createdAt: true },
    });
  });
});
