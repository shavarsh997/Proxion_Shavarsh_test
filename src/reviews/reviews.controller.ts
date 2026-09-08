import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/authenticated-user';
import { ReviewsService } from './reviews.service';
class CreateReviewDto {
  @IsUUID() reviewerId!: string;
  @IsUUID() rubricVersionId!: string;
}
class ScoreDto {
  @IsNumber() score!: number;
  @IsOptional() @IsString() comment?: string;
}
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Post('submissions/:submissionId/reviews') @Roles(Role.ADMIN) create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.reviews.create(actor, id, dto.reviewerId, dto.rubricVersionId, requestId);
  }
  @Get('reviews') list(@CurrentUser() actor: AuthenticatedUser) {
    return this.reviews.list(actor);
  }
  @Get('reviews/:id') get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.get(actor, id);
  }
  @Put('reviews/:reviewId/scores/:criterionId') @Roles(Role.REVIEWER) score(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('criterionId', ParseUUIDPipe) criterionId: string,
    @Body() dto: ScoreDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.reviews.score(actor, reviewId, criterionId, dto.score, dto.comment, requestId);
  }
}
