import {
  Catch,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { RequestWithContext } from '../interfaces/request-with-context.interface';

type ErrorBody = { code?: string; message?: string | string[] };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const response = context.getResponse<Response>();
    const { statusCode, code, message } = this.describe(exception);
    response.status(statusCode).json({ statusCode, code, message, requestId: request.requestId });
  }

  private describe(exception: unknown) {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002' || exception.code === 'P2034') {
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'CONCURRENT_MODIFICATION',
          message: 'The resource changed concurrently; retry the request',
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Resource not found',
        };
      }
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Unexpected persistence error',
      };
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const details: ErrorBody = typeof body === 'string' ? { message: body } : body;
      return {
        statusCode: exception.getStatus(),
        code: details.code ?? 'HTTP_ERROR',
        message: details.message ?? exception.message,
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
    };
  }
}
