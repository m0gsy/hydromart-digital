import { Role } from '../../domain/customer/role.enum';

/** Shape attached to the request after a valid access token is verified. */
export interface AuthenticatedUser {
  sub: string;
  role: Role;
  phone: string;
}
