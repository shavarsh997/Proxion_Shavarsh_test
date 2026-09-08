import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  AuditAction,
  Prisma,
  ReviewDecision,
  ReviewStatus,
  Role,
  SubmissionStatus,
  TaskStatus,
} from '@prisma/client';
import { TaskWorkflowService } from '../tasks/task-workflow.service';
import { UsersService } from '../users/users.service';
import { ReviewAccessPolicy } from './review-access.policy';
import { paginationMeta } from '../../common/dto/pagination.dto';
import {
  ConcurrentModificationException,
  ReviewIncompleteException,
  ReviewNotEditableException,
} from '../../common/exceptions/domain.exceptions';
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
        include: { assignment: { include: { task: true } } },
      });
      if (!submission)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
      await this.lockTask(tx, submission.assignment.taskId);
      if (submission.status !== SubmissionStatus.SUBMITTED)
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: 'Only submitted work can be reviewed',
        });
      const existing = await tx.review.findUnique({
        where: { submissionId_reviewerId: { submissionId, reviewerId } },
      });
      if (existing) {
        if (existing.rubricVersionId === rubricVersionId) return existing;
        throw new ConflictException({
          code: 'REVIEW_ALREADY_EXISTS',
          message: 'This reviewer already has a review for the submission',
        });
      }
      const rubric = await tx.rubricVersion.findUnique({
        where: { id: rubricVersionId },
        include: { rubric: true },
      });
      if (!rubric || rubric.rubric.projectId !== submission.assignment.task.projectId)
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
        submission.assignment.taskId,
        TaskStatus.IN_REVIEW,
        requestId,
      );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Review',
          entityId: review.id,
          action: AuditAction.REVIEW_CREATED,
          after: { submissionId, reviewerId, rubricVersionId, status: review.status },
          requestId: requestId ?? null,
        },
      });
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
          submission: {
            include: { assignment: { include: { task: { include: { project: true } } } } },
          },
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
        submission: { include: { assignment: true } },
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
      await this.lockReview(tx, reviewId);
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
            data: { score: value, comment: comment ?? null },
          })
        : await tx.reviewScore.create({
            data: {
              reviewId,
              rubricCriterionId: criterionId,
              score: value,
              comment: comment ?? null,
            },
          });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'ReviewScore',
          entityId: savedScore.id,
          action: previousScore
            ? AuditAction.REVIEW_SCORE_UPDATED
            : AuditAction.REVIEW_SCORE_CREATED,
          before: previousScore
            ? { score: Number(previousScore.score), comment: previousScore.comment }
            : Prisma.JsonNull,
          after: { score: Number(savedScore.score), comment: savedScore.comment },
          requestId: requestId ?? null,
        },
      });
      return savedScore;
    });
  }

  async decide(
    actor: AuthenticatedUser,
    reviewId: string,
    decision: ReviewDecision,
    requestId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Scoring uses the same lock, so no score can be committed after this review closes.
      await this.lockReview(tx, reviewId);
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        include: {
          submission: { include: { assignment: { include: { task: true } } } },
          rubricVersion: { include: { criteria: true } },
          scores: { include: { rubricCriterion: true } },
        },
      });
      if (!review) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Review not found' });
      this.access.assertCanDecide(actor, review);
      if (review.status !== ReviewStatus.OPEN) throw new ReviewNotEditableException();
      if (decision === ReviewDecision.APPROVED) this.assertReviewIsComplete(review);

      const targetStatus =
        decision === ReviewDecision.APPROVED ? TaskStatus.APPROVED : TaskStatus.REWORK;
      // TaskWorkflowService remains the single authority for Task.status and task-state audit.
      await this.workflow.transition(
        tx,
        actor,
        review.submission.assignment.taskId,
        targetStatus,
        requestId,
      );
      const completedAt = new Date();
      const result = await tx.review.updateMany({
        where: { id: review.id, status: ReviewStatus.OPEN },
        data: {
          status: ReviewStatus.COMPLETED,
          decision,
          completedAt,
        },
      });
      if (result.count !== 1) throw new ConcurrentModificationException();
      const completedReview = await tx.review.findUniqueOrThrow({ where: { id: review.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Review',
          entityId: review.id,
          action:
            decision === ReviewDecision.APPROVED
              ? AuditAction.REVIEW_APPROVED
              : AuditAction.REVIEW_REWORK_REQUESTED,
          before: {
            status: review.status,
            decision: review.decision,
            completedAt: review.completedAt,
          },
          after: {
            status: completedReview.status,
            decision: completedReview.decision,
            completedAt: completedReview.completedAt,
          },
          requestId: requestId ?? null,
        },
      });
      return completedReview;
    });
  }

  private assertReviewIsComplete(review: {
    rubricVersion: {
      criteria: { id: string; minScore: Prisma.Decimal; maxScore: Prisma.Decimal }[];
    };
    scores: {
      rubricCriterionId: string;
      score: Prisma.Decimal;
      rubricCriterion: { rubricVersionId: string };
    }[];
  }) {
    const criteria = review.rubricVersion.criteria;
    const criterionIds = new Set(criteria.map((criterion) => criterion.id));
    if (
      criteria.length === 0 ||
      review.scores.length !== criteria.length ||
      review.scores.some((score) => !criterionIds.has(score.rubricCriterionId))
    ) {
      throw new ReviewIncompleteException();
    }
    const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
    for (const score of review.scores) {
      const criterion = criteriaById.get(score.rubricCriterionId);
      if (
        !criterion ||
        Number(score.score) < Number(criterion.minScore) ||
        Number(score.score) > Number(criterion.maxScore)
      ) {
        throw new ReviewIncompleteException();
      }
    }
  }

  private lockReview(transaction: Prisma.TransactionClient, reviewId: string) {
    return transaction.$executeRaw`SELECT 1 FROM "Review" WHERE id = ${reviewId}::uuid FOR UPDATE`;
  }

  private lockTask(transaction: Prisma.TransactionClient, taskId: string) {
    return transaction.$executeRaw`SELECT 1 FROM "Task" WHERE id = ${taskId}::uuid FOR UPDATE`;
  }
}
