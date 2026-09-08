import { Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../interfaces/request-with-context.interface';

const logger = new Logger('Http');

/** Emits one safe, structured diagnostic record per completed HTTP request. */
export function httpLoggingMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
) {
  const startedAt = performance.now();
  response.on('finish', () => {
    const record = {
      level: response.statusCode >= 500 ? 'error' : 'info',
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      userId: request.user?.id,
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    };
    const message = JSON.stringify(record);
    if (response.statusCode >= 500) logger.error(message);
    else logger.log(message);
  });
  next();
}
