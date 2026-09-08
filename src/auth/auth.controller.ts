import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login') @ApiOperation({ summary: 'Issue a JWT access token' }) login(
    @Body() body: LoginDto,
  ) {
    return this.auth.login(body.email, body.password);
  }
}
