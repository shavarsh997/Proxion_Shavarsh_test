import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

export type RequestWithContext = Request & {
  requestId: string;
  user?: AuthenticatedUser;
};
