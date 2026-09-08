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
import { Role, TaskStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestId } from '../../common/decorators/request-id.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TasksService } from './tasks.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';

@Controller()
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('projects/:projectId/tasks') @Roles(Role.ADMIN) create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(projectId, dto);
  }

  @Get('tasks') list(@CurrentUser() actor: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.tasks.list(actor, query.page, query.limit);
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
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasks.assign(actor, id, dto.expertId);
  }

  @Post('tasks/:id/start') @Roles(Role.EXPERT) start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestId() requestId: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.IN_PROGRESS, requestId);
  }

  @Post('tasks/:id/submit') @Roles(Role.EXPERT) submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestId() requestId: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.SUBMITTED, requestId);
  }

  @Post('tasks/:id/request-rework') @Roles(Role.REVIEWER) rework(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestId() requestId: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.REWORK, requestId);
  }

  @Post('tasks/:id/approve') @Roles(Role.REVIEWER) approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestId() requestId: string,
  ) {
    return this.tasks.transition(actor, id, TaskStatus.APPROVED, requestId);
  }
}
