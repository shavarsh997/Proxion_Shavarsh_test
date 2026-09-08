import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReviewDecision, ReviewStatus, Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ReviewNotEditableException } from '../src/common/exceptions/domain.exceptions';
import type { PrismaService } from '../src/database/prisma.service';
import { ReviewAccessPolicy } from '../src/modules/reviews/review-access.policy';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import type { TaskWorkflowService } from '../src/modules/tasks/task-workflow.service';
import type { UsersService } from '../src/modules/users/users.service';

const reviewer = { id: 'reviewer', email: 'reviewer@test.local', role: Role.REVIEWER };
const review = {
  id: 'review',
  reviewerId: reviewer.id,
  rubricVersionId: 'rubric-v1',
  submissionId: 'submission',
  status: ReviewStatus.OPEN,
  decision: null,
  createdAt: new Date(),
  completedAt: null,
};

function transactionClient(transaction: unknown): Prisma.TransactionClient {
  return transaction as Prisma.TransactionClient;
}

function transactionalPrisma(transaction: unknown): PrismaService {
  return {
    $transaction: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(transactionClient(transaction)),
  } as unknown as PrismaService;
}

function scoreService(transaction: unknown) {
  return new ReviewsService(
    transactionalPrisma(transaction),
    {} as unknown as TaskWorkflowService,
    {} as unknown as UsersService,
    new ReviewAccessPolicy(),
  );
}

describe('review scoring invariants', () => {
  it('rejects scoring a review assigned to another reviewer', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      review: { findUnique: jest.fn().mockResolvedValue({ ...review, reviewerId: 'other' }) },
    };
    await expect(scoreService(tx).score(reviewer, 'review', 'criterion', 4)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a criterion pinned to another rubric version', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      review: { findUnique: jest.fn().mockResolvedValue(review) },
      rubricCriterion: {
        findUnique: jest.fn().mockResolvedValue({ rubricVersionId: 'rubric-v2' }),
      },
    };
    await expect(scoreService(tx).score(reviewer, 'review', 'criterion', 4)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects scores outside the criterion range', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      review: { findUnique: jest.fn().mockResolvedValue(review) },
      rubricCriterion: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ rubricVersionId: 'rubric-v1', minScore: 0, maxScore: 5 }),
      },
    };
    await expect(scoreService(tx).score(reviewer, 'review', 'criterion', 6)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pins a created review to the requested immutable rubric version', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      submission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission',
          status: SubmissionStatus.SUBMITTED,
          assignment: { taskId: 'task', task: { projectId: 'project' } },
        }),
      },
      rubricVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'rubric-v1', rubric: { projectId: 'project' } }),
      },
      review: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(review),
      },
      auditLog: { create: jest.fn() },
    };
    const workflow = { transition: jest.fn().mockResolvedValue({ status: TaskStatus.IN_REVIEW }) };
    const service = new ReviewsService(
      transactionalPrisma(tx),
      workflow as unknown as TaskWorkflowService,
      { findByIdWithRole: jest.fn().mockResolvedValue(reviewer) } as unknown as UsersService,
      new ReviewAccessPolicy(),
    );

    await service.create({ ...reviewer, role: Role.ADMIN }, 'submission', reviewer.id, 'rubric-v1');
    expect(tx.review.create).toHaveBeenCalledWith({
      data: { submissionId: 'submission', reviewerId: reviewer.id, rubricVersionId: 'rubric-v1' },
    });
  });

  it('audits the actual previous score when a score is updated', async () => {
    const previousScore = {
      id: 'score-1',
      score: 3,
      comment: 'Needs clarification',
    };
    const tx = {
      $executeRaw: jest.fn(),
      review: { findUnique: jest.fn().mockResolvedValue(review) },
      rubricCriterion: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ rubricVersionId: 'rubric-v1', minScore: 0, maxScore: 5 }),
      },
      reviewScore: {
        findUnique: jest.fn().mockResolvedValue(previousScore),
        update: jest.fn().mockResolvedValue({
          id: previousScore.id,
          score: 4,
          comment: 'Improved reasoning',
        }),
      },
      auditLog: { create: jest.fn() },
    };

    await scoreService(tx).score(reviewer, 'review', 'criterion', 4, 'Improved reasoning');

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REVIEW_SCORE_UPDATED',
        before: { score: 3, comment: 'Needs clarification' },
        after: { score: 4, comment: 'Improved reasoning' },
      }),
    });
  });

  it('rejects approval until every rubric criterion has a valid score', async () => {
    const decisionReview = {
      ...review,
      submission: { assignment: { taskId: 'task', task: { id: 'task' } } },
      rubricVersion: {
        criteria: [
          { id: 'criterion-1', minScore: 0, maxScore: 5 },
          { id: 'criterion-2', minScore: 0, maxScore: 5 },
        ],
      },
      scores: [
        {
          rubricCriterionId: 'criterion-1',
          score: 5,
          rubricCriterion: { rubricVersionId: 'rubric-v1' },
        },
      ],
    };
    const tx = {
      $executeRaw: jest.fn(),
      review: { findUnique: jest.fn().mockResolvedValue(decisionReview) },
    };
    const service = new ReviewsService(
      transactionalPrisma(tx),
      { transition: jest.fn() } as unknown as TaskWorkflowService,
      {} as unknown as UsersService,
      new ReviewAccessPolicy(),
    );

    await expect(service.decide(reviewer, 'review', ReviewDecision.APPROVED)).rejects.toMatchObject(
      {
        response: expect.objectContaining({ code: 'REVIEW_INCOMPLETE' }),
      },
    );
  });

  it('completes an approved review and delegates the task transition to the workflow', async () => {
    const decisionReview = {
      ...review,
      submission: { assignment: { taskId: 'task', task: { id: 'task' } } },
      rubricVersion: { criteria: [{ id: 'criterion-1', minScore: 0, maxScore: 5 }] },
      scores: [
        {
          rubricCriterionId: 'criterion-1',
          score: 5,
          rubricCriterion: { rubricVersionId: 'rubric-v1' },
        },
      ],
    };
    const completed = {
      ...review,
      status: ReviewStatus.COMPLETED,
      decision: ReviewDecision.APPROVED,
      completedAt: new Date(),
    };
    const tx = {
      $executeRaw: jest.fn(),
      review: {
        findUnique: jest.fn().mockResolvedValue(decisionReview),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(completed),
      },
      auditLog: { create: jest.fn() },
    };
    const workflow = { transition: jest.fn().mockResolvedValue({ status: TaskStatus.APPROVED }) };
    const service = new ReviewsService(
      transactionalPrisma(tx),
      workflow as unknown as TaskWorkflowService,
      {} as unknown as UsersService,
      new ReviewAccessPolicy(),
    );

    await expect(service.decide(reviewer, 'review', ReviewDecision.APPROVED)).resolves.toEqual(
      completed,
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      tx,
      reviewer,
      'task',
      TaskStatus.APPROVED,
      undefined,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'REVIEW_APPROVED' }),
    });
    expect(tx.review.updateMany).toHaveBeenCalledWith({
      where: { id: 'review', status: ReviewStatus.OPEN },
      data: expect.objectContaining({
        status: ReviewStatus.COMPLETED,
        decision: ReviewDecision.APPROVED,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('rejects score changes once a review is completed', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      review: {
        findUnique: jest.fn().mockResolvedValue({ ...review, status: ReviewStatus.COMPLETED }),
      },
    };
    await expect(scoreService(tx).score(reviewer, 'review', 'criterion', 5)).rejects.toBeInstanceOf(
      ReviewNotEditableException,
    );
  });
});
