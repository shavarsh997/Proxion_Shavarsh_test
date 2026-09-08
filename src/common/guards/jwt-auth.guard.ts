import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

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
      const tokenUser = this.jwt.verify<AuthenticatedUser>(authorization.slice(7));
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
