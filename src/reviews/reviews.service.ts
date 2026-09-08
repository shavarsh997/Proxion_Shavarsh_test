import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { Prisma, ReviewStatus, Role, TaskStatus } from '@prisma/client';
import { TaskWorkflowService } from '../tasks/task-workflow.service';
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: TaskWorkflowService,
  ) {}
  async create(
    actor: AuthenticatedUser,
    submissionId: string,
    reviewerId: string,
    rubricVersionId: string,
    requestId?: string,
  ) {
    const reviewer = await this.prisma.user.findUnique({ where: { id: reviewerId } });
    if (!reviewer || reviewer.role !== Role.REVIEWER)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reviewer not found' });
    return this.prisma.$transaction(
      async (tx) => {
        const submission = await tx.submission.findUnique({
          where: { id: submissionId },
          include: { task: true },
        });
        if (!submission)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
        if (!submission.submittedAt)
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
        await this.workflow.transition(
          tx,
          actor,
          submission.taskId,
          TaskStatus.IN_REVIEW,
          requestId,
        );
        return review;
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async list(actor: AuthenticatedUser) {
    if (actor.role === Role.EXPERT)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Experts do not have review assignments',
      });
    return this.prisma.review.findMany({
      where: actor.role === Role.ADMIN ? {} : { reviewerId: actor.id },
      include: {
        submission: { include: { task: { include: { project: true } } } },
        rubricVersion: { include: { criteria: { orderBy: { position: 'asc' } } } },
        scores: true,
      },
      orderBy: { createdAt: 'desc' },
    });
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
    if (actor.role !== Role.ADMIN && review.reviewerId !== actor.id)
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Review is not assigned to you' });
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
    if (actor.role !== Role.REVIEWER)
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only reviewers score reviews' });
    return this.prisma.$transaction(
      async (tx) => {
        const review = await tx.review.findUnique({ where: { id: reviewId } });
        if (!review)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Review not found' });
        if (review.reviewerId !== actor.id)
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message: 'Review is not assigned to you',
          });
        if (review.status !== ReviewStatus.OPEN)
          throw new ConflictException({
            code: 'INVALID_STATE_TRANSITION',
            message: 'Completed reviews cannot be changed',
          });
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
        const previous = await tx.reviewScore.findUnique({
          where: { reviewId_rubricCriterionId: { reviewId, rubricCriterionId: criterionId } },
        });
        const saved = await tx.reviewScore.upsert({
          where: { reviewId_rubricCriterionId: { reviewId, rubricCriterionId: criterionId } },
          create: { reviewId, rubricCriterionId: criterionId, score: value, comment },
          update: { score: value, comment },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            entityType: 'ReviewScore',
            entityId: saved.id,
            action: previous ? 'UPDATED' : 'CREATED',
            before: previous
              ? { score: previous.score.toString(), comment: previous.comment }
              : Prisma.JsonNull,
            after: { score: saved.score.toString(), comment: saved.comment },
            requestId,
          },
        });
        return saved;
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
