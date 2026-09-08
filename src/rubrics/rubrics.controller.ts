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
import { Roles } from '../common/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
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
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRubricDto,
  ) {
    return this.rubrics.create(projectId, dto.name, dto.criteria);
  }

  @Post('rubrics/:rubricId/versions') version(
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Body() dto: CreateRubricVersionDto,
  ) {
    return this.rubrics.version(rubricId, dto.criteria);
  }

  @Get('rubrics/:rubricId/versions/:version') get(
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.rubrics.getVersion(rubricId, version);
  }
}
