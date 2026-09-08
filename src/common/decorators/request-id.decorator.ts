import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithContext } from '../interfaces/request-with-context.interface';

export const RequestId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<RequestWithContext>().requestId;
});
