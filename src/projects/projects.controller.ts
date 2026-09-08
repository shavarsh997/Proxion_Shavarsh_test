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
import { CurrentUser } from '../common/auth/decorators/current-user.decorator';
import { Roles } from '../common/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PaginationDto } from '../common/http/dto/pagination.dto';
import { ProjectsService } from './projects.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post() @Roles(Role.ADMIN) create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(actor, dto);
  }

  @Get() list(@Query() query: PaginationDto) {
    return this.projects.list(query.page, query.limit);
  }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }
}
