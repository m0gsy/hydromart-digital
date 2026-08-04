import {
  AssignRoleInput,
  IdentityPort,
  ProvisionManagedStaffInput,
  ProvisionStaffInput,
} from '../../../src/application/ports/identity.port';

/**
 * Stub auth-service. Records what it was asked to provision so the import specs can
 * assert the role/depot that travelled; `fail()` makes it reject like a down service.
 */
export class FakeIdentity implements IdentityPort {
  readonly calls: ProvisionStaffInput[] = [];
  /** Re-role calls from an employee edit, so a spec can assert the login moved too. */
  readonly roleCalls: AssignRoleInput[] = [];
  private error: Error | null = null;
  private seq = 0;

  fail(error: Error): this {
    this.error = error;
    return this;
  }

  async provisionStaff(input: ProvisionStaffInput): Promise<{ customerId: string }> {
    return this.record(input);
  }

  async provisionManagedStaff(input: ProvisionManagedStaffInput): Promise<{ customerId: string }> {
    return this.record(input as ProvisionStaffInput);
  }

  private async record(input: ProvisionStaffInput): Promise<{ customerId: string }> {
    this.calls.push(input);
    if (this.error) throw this.error;
    this.seq += 1;
    return { customerId: `00000000-0000-4000-8000-00000000000${this.seq}` };
  }

  async assignRole(input: AssignRoleInput): Promise<void> {
    this.roleCalls.push(input);
    if (this.error) throw this.error;
  }
}

export function fakeIdentity(): FakeIdentity {
  return new FakeIdentity();
}
