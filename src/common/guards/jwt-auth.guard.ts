import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTokenUser(value: unknown): value is AuthenticatedUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    UUID_PATTERN.test(user.id) &&
    typeof user.email === 'string' &&
    (user.role === 'ADMIN' || user.role === 'EXPERT' || user.role === 'REVIEWER')
  );
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bearer token is required',
      });
    }

    try {
      const tokenUser = this.jwt.verify<Record<string, unknown>>(authorization.slice(7), {
        algorithms: ['HS256'],
      });
      if (!isValidTokenUser(tokenUser)) throw new Error('Malformed token claims');
      const user = await this.prisma.user.findFirst({
        where: { id: tokenUser.id, isActive: true },
        select: { id: true, email: true, role: true },
      });
      if (!user) throw new Error('Inactive or deleted user');
      // Reloading the user makes deactivation and role changes effective immediately.
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });
    }
  }
}
