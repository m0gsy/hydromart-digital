import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../prisma/generated/client';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { AttendanceController } from '../../src/modules/attendance.controller';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const token = (depotId: string | null): AuthenticatedUser =>
  ({ sub: 'acct-1', role: 'STAFF_DEPOT' as never, phone: null, depotId }) as AuthenticatedUser;

function service(employee: Partial<Employee> | null) {
  return new AttendanceService(
    {} as never,
    {} as never,
    {} as never,
    { findByAuthSubjectId: async () => employee } as never,
    {} as never,
  );
}

describe('AttendanceService.depotDrift', () => {
  it('names the depot the person works at now when the token still says another', async () => {
    await expect(service({ depotId: B }).depotDrift(token(A))).resolves.toBe(B);
  });

  it('says nothing when they agree, or when either side has no single depot', async () => {
    await expect(service({ depotId: A }).depotDrift(token(A))).resolves.toBeNull();
    await expect(service({ depotId: null }).depotDrift(token(A))).resolves.toBeNull();
    await expect(service({ depotId: B }).depotDrift(token(null))).resolves.toBeNull();
    await expect(service(null).depotDrift(token(A))).resolves.toBeNull();
  });
});

describe('the self-service punch routes flag a stale token', () => {
  function controller(drift: string | null) {
    const att = {
      checkIn: jest.fn(async () => ({ id: 'a1' })),
      checkOut: jest.fn(async () => ({ id: 'a1' })),
      depotDrift: jest.fn(async () => drift),
    };
    return { att, c: new AttendanceController(att as never) };
  }
  const dto = { image: Buffer.from('x').toString('base64'), lat: 1, lng: 2 } as never;

  it('sets x-hm-depot-changed on check-in and check-out when the token is out of date', async () => {
    const { c } = controller(B);
    const res = { setHeader: jest.fn() };
    await c.checkIn(dto, token(A), res as never);
    await c.checkOut(dto, token(A), res as never);
    expect(res.setHeader).toHaveBeenCalledTimes(2);
    expect(res.setHeader).toHaveBeenCalledWith('x-hm-depot-changed', B);
  });

  it('sets nothing when the token is current, and works without a response object', async () => {
    const { c } = controller(null);
    const res = { setHeader: jest.fn() };
    await expect(c.checkIn(dto, token(A), res as never)).resolves.toEqual({ id: 'a1' });
    expect(res.setHeader).not.toHaveBeenCalled();
    await expect(c.checkOut(dto, token(A))).resolves.toEqual({ id: 'a1' });
  });
});
