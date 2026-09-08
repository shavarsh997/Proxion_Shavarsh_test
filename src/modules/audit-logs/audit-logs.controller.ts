import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogsService } from './audit-logs.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@Controller('audit-logs')
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get() list(@Query() query: PaginationDto) {
    return this.auditLogs.list(query.page, query.limit);
  }
}
