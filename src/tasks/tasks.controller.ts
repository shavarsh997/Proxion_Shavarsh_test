import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsUUID, MinLength } from 'class-validator';
import { Role, TaskStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/authenticated-user';
import { TasksService } from './tasks.service';

class CreateTaskDto {
  @IsString() @MinLength(1) title!: string;

  @IsString() @MinLength(1) instructions!: string;
}

class AssignDto {
  @IsUUID() expertId!: string;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('projects/:projectId/tasks') @Roles(Role.ADMIN) create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(projectId, dto);
  }

  @Get('tasks') list(@CurrentUser() actor: AuthenticatedUser) {
    return this.tasks.list(actor);
  }

  @Get('tasks/:id') get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.get(actor, id);
  }

  @Post('tasks/:id/assign') @Roles(Role.ADMIN) assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.tasks.assign(actor, id, dto.expertId);
  }

  @Post('tasks/:id/start') @Roles(Role.EXPERT) start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.IN_PROGRESS, requestId);
  }

  @Post('tasks/:id/submit') @Roles(Role.EXPERT) submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.SUBMITTED, requestId);
  }

  @Post('tasks/:id/request-rework') @Roles(Role.REVIEWER) rework(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.REWORK, requestId);
  }

  @Post('tasks/:id/approve') @Roles(Role.REVIEWER) approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.APPROVED, requestId);
  }
}
