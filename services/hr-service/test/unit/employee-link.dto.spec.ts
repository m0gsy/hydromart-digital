import { ArgumentMetadata } from '@nestjs/common';
import { GlobalValidationPipe } from '@hydromart/platform';

import { CreateEmployeeDto } from '../../src/modules/dto/employee.dto';

// HR-27: `authSubjectId` was a public field of the create form, so an HR user could link a new
// employee to ANY existing login account (a customer, another staff member, the super admin)
// instead of the one provisioning mints. The link is made server-side only (provisionFromInvite
// over the internal key, or provisionFor on create).
describe('CreateEmployeeDto', () => {
  const pipe = new GlobalValidationPipe();
  const meta: ArgumentMetadata = { type: 'body', metatype: CreateEmployeeDto };
  const base = {
    fullName: 'Budi Santoso',
    phone: '+6281234567890',
    position: 'Operator',
    role: 'STAFF_DEPOT',
    depotId: '7d0f5ff1-0b8f-4e1a-9d63-0f4a0f2f9a11',
    employmentStatus: 'PERMANENT',
    joinDate: '2026-01-01',
    salaryType: 'MONTHLY',
  };

  it('rejects a client-supplied authSubjectId', async () => {
    await expect(
      pipe.transform(
        { ...base, authSubjectId: '11111111-1111-4111-8111-111111111111' },
        meta,
      ),
    ).rejects.toMatchObject({ response: { message: expect.arrayContaining([expect.stringMatching(/authSubjectId/)]) } });
  });

  it('control: the same body without it validates (so the rejection above is about that field)', async () => {
    await expect(pipe.transform({ ...base }, meta)).resolves.toBeInstanceOf(CreateEmployeeDto);
  });
});
