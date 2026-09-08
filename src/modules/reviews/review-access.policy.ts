import { Injectable } from '@nestjs/common';
import { Role, type Review } from '@prisma/client';
import { ResourceForbiddenException } from '../../common/exceptions/domain.exceptions';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

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
