import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/auth/decorators/current-user.decorator';
import { RequestId } from '../common/auth/decorators/request-id.decorator';
import { Roles } from '../common/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import { PaginationDto } from '../common/http/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ReviewsService } from './reviews.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpsertReviewScoreDto } from './dto/upsert-review-score.dto';

@Controller()
@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('submissions/:submissionId/reviews') @Roles(Role.ADMIN) create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
    @RequestId() requestId: string,
  ) {
    return this.reviews.create(actor, id, dto.reviewerId, dto.rubricVersionId, requestId);
  }

  @Get('reviews') list(@CurrentUser() actor: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.reviews.list(actor, query.page, query.limit);
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
    @Body() dto: UpsertReviewScoreDto,
    @RequestId() requestId: string,
  ) {
    return this.reviews.score(actor, reviewId, criterionId, dto.score, dto.comment, requestId);
  }
}
