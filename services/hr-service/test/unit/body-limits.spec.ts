import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';

import { configureBodyLimits, DEFAULT_BODY_LIMIT } from '../../src/http/body-limits';
import { FACE_BODY_LIMIT, MAX_FRAME, MAX_FRAMES } from '../../src/modules/dto/attendance.dto';

/**
 * B-15: a real selfie used to be rejected with a bare 413 by Express's 100 KB default,
 * before validation — two limits that disagreed ~200×. These run the actual parsers.
 */
function appWithLimits(): express.Express {
  const app = express();
  configureBodyLimits(app as unknown as INestApplication);
  app.use((req, res) => {
    res.json({ frames: Array.isArray(req.body?.images) ? req.body.images.length : 0 });
  });
  return app;
}

const frame = (chars: number): string => 'a'.repeat(chars);

describe('hr-service body limits', () => {
  it('accepts a full ten-frame enrolment on the face routes', async () => {
    const res = await request(appWithLimits())
      .post('/api/v1/attendance/me/face/enroll')
      .send({ images: Array.from({ length: MAX_FRAMES }, () => frame(MAX_FRAME - 1)) });

    expect(res.status).toBe(200);
    expect(res.body.frames).toBe(MAX_FRAMES);
  });

  it('accepts an enrolment on the /employees/:id/face route too', async () => {
    const res = await request(appWithLimits())
      .post('/api/v1/employees/00000000-0000-4000-8000-000000000001/face/enroll')
      .send({ images: [frame(2_000_000 - 1)] });

    expect(res.status).toBe(200);
  });

  it('keeps every other route on the small limit', async () => {
    const res = await request(appWithLimits())
      .post('/api/v1/payroll/generate')
      .send({ note: frame(DEFAULT_BODY_LIMIT + 1) });

    expect(res.status).toBe(413);
  });

  it('budgets the face routes from the DTO limits, so the two cannot drift apart', () => {
    expect(FACE_BODY_LIMIT).toBeGreaterThanOrEqual(MAX_FRAME * MAX_FRAMES);
  });
});
