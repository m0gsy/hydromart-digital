import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request } from 'express';

import { AccountController } from '../../src/modules/auth/account.controller';
import { AuditController } from '../../src/modules/auth/audit.controller';
import { AvatarController } from '../../src/modules/auth/avatar.controller';
import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { PublicCustomer } from '../../src/application/results';

const publicCustomer = (overrides: Partial<PublicCustomer> = {}): PublicCustomer => ({
  id: 'cust-1',
  phone: '+6281234567890',
  email: null,
  fullName: 'Budi',
  role: Role.CUSTOMER,
  status: CustomerStatus.ACTIVE,
  avatarUrl: null,
  assignedDepotId: null,
  vehicleType: null,
  plateNumber: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const req = { headers: {}, ip: '127.0.0.1', socket: {} } as unknown as Request;

describe('AccountController delegation', () => {
  const account = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    lookupByPhone: jest.fn(),
    listDrivers: jest.fn(),
    countNewCustomers: jest.fn(),
    inviteStaff: jest.fn(),
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    logoutAll: jest.fn(),
  };
  const tokens = { logout: jest.fn() };
  const controller = new AccountController(account as never, tokens as never);
  const user = { sub: 'cust-1', role: Role.CUSTOMER, phone: '+6281234567890' };

  beforeEach(() => jest.clearAllMocks());

  it('returns the current account profile', async () => {
    account.getProfile.mockResolvedValue(publicCustomer());
    const dto = await controller.me(user);
    expect(dto.id).toBe('cust-1');
    expect(account.getProfile).toHaveBeenCalledWith('cust-1');
  });

  it('updates the profile via the service', async () => {
    account.updateProfile.mockResolvedValue(publicCustomer({ fullName: 'Budi S' }));
    const dto = await controller.updateProfile(user, { fullName: 'Budi S', email: 'x@y.com' });
    expect(dto.fullName).toBe('Budi S');
    expect(account.updateProfile).toHaveBeenCalledWith('cust-1', { fullName: 'Budi S', email: 'x@y.com' });
  });

  it('looks up a customer by phone', async () => {
    account.lookupByPhone.mockResolvedValue(publicCustomer());
    await controller.lookupByPhone({ phone: '081234567890' });
    expect(account.lookupByPhone).toHaveBeenCalledWith('081234567890');
  });

  it('lists drivers for dispatch', async () => {
    account.listDrivers.mockResolvedValue([publicCustomer({ role: Role.DRIVER })]);
    const drivers = await controller.listDrivers();
    expect(drivers).toHaveLength(1);
  });

  it('counts customers with a valid ISO window', async () => {
    account.countNewCustomers.mockResolvedValue(3);
    const result = await controller.countCustomers('2026-01-01', '2026-02-01');
    expect(result).toEqual({ count: 3, from: '2026-01-01', to: '2026-02-01' });
    const [fromArg, toArg] = account.countNewCustomers.mock.calls[0];
    expect(fromArg).toBeInstanceOf(Date);
    expect(toArg).toBeInstanceOf(Date);
  });

  it('ignores an invalid date and defaults an absent window', async () => {
    account.countNewCustomers.mockResolvedValue(0);
    const result = await controller.countCustomers('not-a-date', undefined);
    expect(result).toEqual({ count: 0, from: 'not-a-date', to: null });
    expect(account.countNewCustomers).toHaveBeenCalledWith(undefined, undefined);
  });

  it('invites a staff member', async () => {
    account.inviteStaff.mockResolvedValue(publicCustomer({ role: Role.DRIVER }));
    await controller.inviteStaff({
      phone: '+628990001111',
      role: Role.DRIVER,
      fullName: 'Joko',
      depotId: 'depot-1',
      vehicleType: 'MOTOR',
      plateNumber: 'B 1 A',
    });
    expect(account.inviteStaff).toHaveBeenCalledWith('+628990001111', Role.DRIVER, 'Joko', 'depot-1', {
      vehicleType: 'MOTOR',
      plateNumber: 'B 1 A',
    });
  });

  it('lists active device sessions', async () => {
    account.listSessions.mockResolvedValue([
      { id: 's1', createdAt: new Date(), expiresAt: new Date(), ipAddress: null, userAgent: null },
    ]);
    const sessions = await controller.sessions(user);
    expect(sessions).toHaveLength(1);
    expect(account.listSessions).toHaveBeenCalledWith('cust-1');
  });

  it('revokes an owned session', async () => {
    account.revokeSession.mockResolvedValue(true);
    const result = await controller.revokeSession('s1', user);
    expect(result).toEqual({ message: 'Session revoked.' });
  });

  it('404s revoking an unknown session', async () => {
    account.revokeSession.mockResolvedValue(false);
    await expect(controller.revokeSession('missing', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('logs out the current session', async () => {
    tokens.logout.mockResolvedValue(undefined);
    const result = await controller.logout({ refreshToken: 'rt' }, user, req);
    expect(result).toEqual({ message: 'Signed out.' });
    expect(tokens.logout).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'rt', actorCustomerId: 'cust-1' }),
    );
  });

  it('logs out of every device', async () => {
    account.logoutAll.mockResolvedValue(undefined);
    const result = await controller.logoutAll(user, req);
    expect(result).toEqual({ message: 'Signed out of all devices.' });
    expect(account.logoutAll).toHaveBeenCalled();
  });
});

describe('AuditController delegation', () => {
  const auditItem = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    customerId: 'cust-1',
    action: 'depot.suspend',
    success: true,
    ipAddress: null,
    userAgent: null,
    metadata: { target: 'Depot A' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    actorEmail: 'x@y.com',
    actorName: 'Admin',
    actorRole: Role.SUPER_ADMIN,
    ...overrides,
  });
  const audit = { list: jest.fn(), ingest: jest.fn() };
  const controller = new AuditController(audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists HQ audit entries with defaulted pagination', async () => {
    audit.list.mockResolvedValue({ items: [auditItem()], total: 1, page: 1, limit: 20 });
    const result = await controller.list({});
    expect(result.items[0].target).toBe('Depot A');
    expect(audit.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('honours explicit HQ pagination + filters', async () => {
    audit.list.mockResolvedValue({ items: [], total: 0, page: 2, limit: 5 });
    await controller.list({ page: 2, limit: 5, action: 'depot.suspend', actorId: 'cust-1' });
    expect(audit.list).toHaveBeenCalledWith({ page: 2, limit: 5, action: 'depot.suspend', customerId: 'cust-1' });
  });

  it('lists a depot-scoped trail with defaults', async () => {
    audit.list.mockResolvedValue({ items: [auditItem({ metadata: null })], total: 1, page: 1, limit: 50 });
    const result = await controller.listForDepot({ depotId: 'depot-1' });
    expect(result.items[0].target).toBeNull();
    expect(audit.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 50, depotId: 'depot-1' }),
    );
  });

  it('honours explicit depot pagination + type', async () => {
    audit.list.mockResolvedValue({ items: [], total: 0, page: 3, limit: 10 });
    await controller.listForDepot({ depotId: 'depot-1', type: 'depot', page: 3, limit: 10 });
    expect(audit.list).toHaveBeenCalledWith({ page: 3, limit: 10, depotId: 'depot-1', type: 'depot' });
  });

  it('ingests a cross-service event with an actor', async () => {
    audit.ingest.mockResolvedValue(undefined);
    const result = await controller.ingest({
      actorId: 'cust-1',
      action: 'depot.suspend',
      target: 'Depot A',
      success: true,
      metadata: { foo: 'bar' },
    });
    expect(result).toEqual({ recorded: true });
    expect(audit.ingest).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'cust-1' }));
  });

  it('defaults a null actor for a system event', async () => {
    audit.ingest.mockResolvedValue(undefined);
    await controller.ingest({ action: 'system.rotate', success: true });
    expect(audit.ingest).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });
});

describe('AvatarController', () => {
  const storage = { put: jest.fn() };
  const account = { setAvatar: jest.fn() };
  const controller = new AvatarController(storage as never, account as never);
  const user = { sub: 'cust-1', role: Role.CUSTOMER, phone: '+62' };
  const file = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({ mimetype: 'image/png', size: 1024, buffer: Buffer.from('img'), ...overrides } as Express.Multer.File);

  beforeEach(() => jest.clearAllMocks());

  it('rejects a request with no file', async () => {
    await expect(controller.upload(user, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unsupported mime type', async () => {
    await expect(
      controller.upload(user, file({ mimetype: 'application/pdf' }) as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file larger than the limit', async () => {
    await expect(
      controller.upload(user, file({ size: 6 * 1024 * 1024 }) as Express.Multer.File),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('stores the file and persists the avatar url', async () => {
    storage.put.mockResolvedValue({ url: 'https://cdn/x.png', key: 'avatars/x.png' });
    account.setAvatar.mockResolvedValue(publicCustomer({ avatarUrl: 'https://cdn/x.png' }));

    const dto = await controller.upload(user, file());
    expect(dto.avatarUrl).toBe('https://cdn/x.png');
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png', ext: 'png' }),
    );
    expect(account.setAvatar).toHaveBeenCalledWith('cust-1', 'https://cdn/x.png');
  });
});
