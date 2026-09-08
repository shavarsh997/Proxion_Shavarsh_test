import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, _host: ArgumentsHost) {
    if (exception.code === 'P2002' || exception.code === 'P2034')
      throw new ConflictException({
        code: 'CONCURRENT_MODIFICATION',
        message: 'The resource changed concurrently; retry the request',
      });
    if (exception.code === 'P2025')
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Resource not found' });
    throw new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected persistence error',
    });
  }
}
