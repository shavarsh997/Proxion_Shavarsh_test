import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

// Comparing against a real bcrypt hash even for an unknown account prevents the
// login endpoint from becoming an email-enumeration oracle through response time.
const DUMMY_PASSWORD_HASH = '$2b$12$T7P6JUz1nyfopRwdv1lQ6eJQ9WA6lNPItouFuTz8.yDAAHdAgO.3e';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    return {
      accessToken: await this.jwt.signAsync({ id: user.id, email: user.email, role: user.role }),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
