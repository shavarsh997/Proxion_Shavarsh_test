import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user.interface';

export type RequestWithContext = Request & {
  requestId: string;
  user?: AuthenticatedUser;
};
