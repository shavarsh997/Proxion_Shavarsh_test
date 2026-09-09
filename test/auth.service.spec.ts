import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';
import type { UsersService } from '../src/modules/users/users.service';
import type { JwtService } from '@nestjs/jwt';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

const compare = bcrypt.compare as unknown as jest.Mock;

describe('AuthService', () => {
  const users = { findByEmail: jest.fn() } as unknown as UsersService;
  const jwt = { signAsync: jest.fn() } as unknown as JwtService;
  const service = new AuthService(users, jwt);

  beforeEach(() => jest.resetAllMocks());

  it('performs a bcrypt comparison even when the account does not exist', async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(null);
    compare.mockResolvedValue(false);

    await expect(service.login('unknown@example.test', 'not-the-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(compare).toHaveBeenCalledWith('not-the-password', expect.any(String));
  });

  it('does not authenticate an inactive account with a valid password', async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue({
      id: 'user-id',
      email: 'disabled@example.test',
      role: Role.EXPERT,
      isActive: false,
      passwordHash: 'hash',
    });
    compare.mockResolvedValue(true);

    await expect(service.login('disabled@example.test', 'valid-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
