import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/authenticated-user';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsString() @MinLength(1) name!: string;

  @IsOptional() @IsString() description?: string;
}

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post() @Roles(Role.ADMIN) create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(actor, dto);
  }

  @Get() list() {
    return this.projects.list();
  }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }
}
