import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/authenticated-user';
import { SubmissionsService } from './submissions.service';
class CreateSubmissionDto {
  @IsString() @MinLength(1) content!: string;
}
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}
  @Post('tasks/:taskId/submissions') @Roles(Role.EXPERT) create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.submissions.create(actor, taskId, dto.content);
  }
  @Get('tasks/:taskId/submissions') list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.submissions.list(actor, taskId);
  }
  @Get('submissions/:id') get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.submissions.get(actor, id);
  }
}
