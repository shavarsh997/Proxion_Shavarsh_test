import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestId } from '../../common/decorators/request-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ProjectsService } from './projects.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post() create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
    @RequestId() requestId: string,
  ) {
    return this.projects.create(actor, dto, requestId);
  }

  @Get() list(@Query() query: PaginationDto) {
    return this.projects.list(query.page, query.limit);
  }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }
}
