import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestId } from '../../common/decorators/request-id.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RubricsService } from './rubrics.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateRubricDto } from './dto/create-rubric.dto';
import { CreateRubricVersionDto } from './dto/create-rubric-version.dto';

@Controller()
@ApiTags('rubrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class RubricsController {
  constructor(private readonly rubrics: RubricsService) {}

  @Post('projects/:projectId/rubrics') create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRubricDto,
    @RequestId() requestId: string,
  ) {
    return this.rubrics.create(actor, projectId, dto.name, dto.criteria, requestId);
  }

  @Post('rubrics/:rubricId/versions') version(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Body() dto: CreateRubricVersionDto,
    @RequestId() requestId: string,
  ) {
    return this.rubrics.version(actor, rubricId, dto.criteria, requestId);
  }

  @Get('rubrics/:rubricId/versions/:version') get(
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.rubrics.getVersion(rubricId, version);
  }
}
