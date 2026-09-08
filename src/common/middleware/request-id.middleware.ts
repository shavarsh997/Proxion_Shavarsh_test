import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../interfaces/request-with-context.interface';

const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function requestIdMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
) {
  const supplied = request.header('x-request-id')?.trim();
  request.requestId =
    supplied && supplied.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(supplied)
      ? supplied
      : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
