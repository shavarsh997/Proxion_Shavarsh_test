import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Prisma, ReviewStatus, Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import { TaskWorkflowService } from '../tasks/task-workflow.service';
import { UsersService } from '../users/users.service';
import { ReviewAccessPolicy } from './review-access.policy';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { ReviewNotEditableException } from '../../common/exceptions/domain.exceptions';
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: TaskWorkflowService,
    private readonly users: UsersService,
    private readonly access: ReviewAccessPolicy,
  ) {}
  async create(
    actor: AuthenticatedUser,
    submissionId: string,
    reviewerId: string,
    rubricVersionId: string,
    requestId?: string,
  ) {
    const reviewer = await this.users.findByIdWithRole(reviewerId, Role.REVIEWER);
    if (!reviewer || reviewer.role !== Role.REVIEWER)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reviewer not found' });
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: submissionId },
        include: { task: true },
      });
      if (!submission)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
      if (submission.status !== SubmissionStatus.SUBMITTED)
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: 'Only submitted work can be reviewed',
        });
      const rubric = await tx.rubricVersion.findUnique({
        where: { id: rubricVersionId },
        include: { rubric: true },
      });
      if (!rubric || rubric.rubric.projectId !== submission.task.projectId)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Rubric version belongs to another project',
        });
      const review = await tx.review.create({
        data: { submissionId, reviewerId, rubricVersionId },
      });
      await this.workflow.transition(tx, actor, submission.taskId, TaskStatus.IN_REVIEW, requestId);
      return review;
    });
  }
  async list(actor: AuthenticatedUser, page: number, limit: number) {
    if (actor.role === Role.EXPERT)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Experts do not have review assignments',
      });
    const where = actor.role === Role.ADMIN ? {} : { reviewerId: actor.id };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: {
          submission: { include: { task: { include: { project: true } } } },
          rubricVersion: { include: { criteria: { orderBy: { position: 'asc' } } } },
          scores: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { data, meta: paginationMeta(page, limit, total) };
  }
  async get(actor: AuthenticatedUser, id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        rubricVersion: { include: { criteria: { orderBy: { position: 'asc' } } } },
        scores: true,
        submission: true,
      },
    });
    if (!review) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Review not found' });
    this.access.assertCanRead(actor, review);
    return review;
  }
  async score(
    actor: AuthenticatedUser,
    reviewId: string,
    criterionId: string,
    value: number,
    comment?: string,
    requestId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (!review) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Review not found' });
      this.access.assertCanScore(actor, review);
      if (review.status !== ReviewStatus.OPEN) throw new ReviewNotEditableException();
      const criterion = await tx.rubricCriterion.findUnique({ where: { id: criterionId } });
      if (!criterion || criterion.rubricVersionId !== review.rubricVersionId)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Criterion does not belong to this review rubric version',
        });
      if (value < Number(criterion.minScore) || value > Number(criterion.maxScore))
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Score must be between ${criterion.minScore.toString()} and ${criterion.maxScore.toString()}`,
        });
      const previousScore = await tx.reviewScore.findUnique({
        where: { reviewId_rubricCriterionId: { reviewId, rubricCriterionId: criterionId } },
      });
      const savedScore = previousScore
        ? await tx.reviewScore.update({
            where: { id: previousScore.id },
            data: { score: value, comment },
          })
        : await tx.reviewScore.create({
            data: { reviewId, rubricCriterionId: criterionId, score: value, comment },
          });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'ReviewScore',
          entityId: savedScore.id,
          action: previousScore ? 'UPDATED' : 'CREATED',
          before: previousScore
            ? { score: Number(previousScore.score), comment: previousScore.comment }
            : Prisma.JsonNull,
          after: { score: Number(savedScore.score), comment: savedScore.comment },
          requestId,
        },
      });
      return savedScore;
    });
  }
}
