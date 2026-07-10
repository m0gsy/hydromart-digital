import { Customer, CustomerProps } from '../../src/domain/customer/customer.entity';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { AccountNotActiveError } from '../../src/domain/errors/auth.errors';

const baseProps = (overrides: Partial<CustomerProps> = {}): CustomerProps => ({
  id: 'cust-1',
  phone: '+6281234567890',
  email: null,
  fullName: null,
  role: Role.CUSTOMER,
  status: CustomerStatus.PENDING_VERIFICATION,
  googleSub: null,
  phoneVerifiedAt: null,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('Customer entity', () => {
  const now = new Date('2026-02-01T00:00:00Z');

  it('activates a pending account on phone verification', () => {
    const customer = Customer.fromPersistence(baseProps());
    expect(customer.isPendingVerification()).toBe(true);

    customer.markPhoneVerified(now);

    expect(customer.isActive()).toBe(true);
    expect(customer.phoneVerifiedAt).toEqual(now);
  });

  it('does not downgrade an already-active account when re-verifying', () => {
    const customer = Customer.fromPersistence(
      baseProps({ status: CustomerStatus.ACTIVE, phoneVerifiedAt: new Date('2026-01-15Z') }),
    );
    customer.markPhoneVerified(now);
    expect(customer.isActive()).toBe(true);
    expect(customer.phoneVerifiedAt).toEqual(new Date('2026-01-15Z'));
  });

  it('allows authentication only when active', () => {
    expect(() =>
      Customer.fromPersistence(baseProps({ status: CustomerStatus.ACTIVE })).ensureCanAuthenticate(),
    ).not.toThrow();
  });

  it.each([
    [CustomerStatus.PENDING_VERIFICATION],
    [CustomerStatus.SUSPENDED],
    [CustomerStatus.DELETED],
  ])('blocks authentication for %s accounts', (status) => {
    const customer = Customer.fromPersistence(baseProps({ status }));
    expect(() => customer.ensureCanAuthenticate()).toThrow(AccountNotActiveError);
  });

  it('links Google identity and fills missing profile fields only', () => {
    const customer = Customer.fromPersistence(
      baseProps({ status: CustomerStatus.ACTIVE, email: 'existing@x.com' }),
    );
    customer.linkGoogle('google-sub-1', 'new@x.com', 'Budi');
    expect(customer.googleSub).toBe('google-sub-1');
    expect(customer.email).toBe('existing@x.com'); // not overwritten
    expect(customer.fullName).toBe('Budi'); // filled because it was null
  });

  it('records the last login timestamp', () => {
    const customer = Customer.fromPersistence(baseProps({ status: CustomerStatus.ACTIVE }));
    customer.recordLogin(now);
    expect(customer.lastLoginAt).toEqual(now);
  });
});
