import { ValidationOptions, registerDecorator } from 'class-validator';

import { Role } from '../../domain/customer/role.enum';

const BUILT_IN = new Set<string>(Object.values(Role));
/** Same alphabet `customRoleKeyFor` produces, so nothing else can reach a column. */
const CUSTOM_KEY = /^C_[a-z0-9_]{1,40}$/;

/**
 * A built-in role or a well-formed custom key. SHAPE only: whether a custom role exists and
 * is active is a database fact, checked by the service that writes the account.
 */
export function IsRoleKey(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isRoleKey',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'Peran tidak valid.', ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && (BUILT_IN.has(value) || CUSTOM_KEY.test(value)),
      },
    });
}
