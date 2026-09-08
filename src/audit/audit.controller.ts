import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import { AuditService } from './audit.service';
import { PaginationDto } from '../common/http/dto/pagination.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@Controller('audit-logs')
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get() list(@Query() query: PaginationDto) {
    return this.audit.list(query.page, query.limit);
  }
}
