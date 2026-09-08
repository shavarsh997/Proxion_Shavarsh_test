import { Injectable } from '@nestjs/common';
import { Role, type Review } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ResourceForbiddenException } from '../common/exceptions/domain.exceptions';

@Injectable()
export class ReviewAccessPolicy {
  assertCanRead(actor: AuthenticatedUser, review: Review) {
    if (actor.role === Role.ADMIN || review.reviewerId === actor.id) return;
    throw new ResourceForbiddenException('Review is not assigned to you');
  }

  assertCanScore(actor: AuthenticatedUser, review: Review) {
    if (actor.role === Role.REVIEWER && review.reviewerId === actor.id) return;
    throw new ResourceForbiddenException('Review is not assigned to you');
  }
}
