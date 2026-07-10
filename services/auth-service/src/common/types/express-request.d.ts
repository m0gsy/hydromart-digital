import { AuthenticatedUser } from '../interfaces/authenticated-user';

// Augment Express's Request so guards can attach the authenticated identity.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
