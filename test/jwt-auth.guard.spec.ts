import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import type { PrismaService } from '../src/database/prisma.service';

function contextFor(request: { headers: { authorization?: string }; user?: unknown }) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('rejects malformed claims before querying the database', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ id: 'not-a-uuid', role: Role.ADMIN }) };
    const prisma = { user: { findFirst: jest.fn() } };
    const guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer malformed-token' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(jwt.verify).toHaveBeenCalledWith('malformed-token', { algorithms: ['HS256'] });
  });
});
