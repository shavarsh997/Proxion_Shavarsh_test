import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../../types/request-with-context';

const MAX_REQUEST_ID_LENGTH = 128;

export function requestIdMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
) {
  const supplied = request.header('x-request-id')?.trim();
  request.requestId = supplied?.slice(0, MAX_REQUEST_ID_LENGTH) || randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
