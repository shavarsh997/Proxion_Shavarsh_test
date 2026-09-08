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
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RubricsService } from './rubrics.service';
class CriterionDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() minScore!: number;
  @IsNumber() maxScore!: number;
  @IsNumber() @Min(0) weight!: number;
  @IsNumber() @Min(0) position!: number;
}
class CreateRubricDto {
  @IsString() name!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}
class VersionRubricDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}
@Controller()
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
    @Body() dto: VersionRubricDto,
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
