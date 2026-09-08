import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReviewStatus, Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import { ReviewAccessPolicy } from '../src/modules/reviews/review-access.policy';
import { ReviewsService } from '../src/modules/reviews/reviews.service';

const reviewer = { id: 'reviewer', email: 'reviewer@test.local', role: Role.REVIEWER };
const review = {
  id: 'review',
  reviewerId: reviewer.id,
  rubricVersionId: 'rubric-v1',
  submissionId: 'submission',
  status: ReviewStatus.OPEN,
  createdAt: new Date(),
  completedAt: null,
};

function scoreService(tx: any) {
  return new ReviewsService(
    { $transaction: (callback: any) => callback(tx) } as any,
    {} as any,
    {} as any,
    new ReviewAccessPolicy(),
  );
}

describe('review scoring invariants', () => {
  it('rejects scoring a review assigned to another reviewer', async () => {
    const tx: any = {
      review: { findUnique: jest.fn().mockResolvedValue({ ...review, reviewerId: 'other' }) },
    };
    await expect(scoreService(tx).score(reviewer, 'review', 'criterion', 4)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a criterion pinned to another rubric version', async () => {
    const tx: any = {
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
    const tx: any = {
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
    const tx: any = {
      submission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission',
          taskId: 'task',
          status: SubmissionStatus.SUBMITTED,
          task: { projectId: 'project' },
        }),
      },
      rubricVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'rubric-v1', rubric: { projectId: 'project' } }),
      },
      review: { create: jest.fn().mockResolvedValue(review) },
    };
    const workflow = { transition: jest.fn().mockResolvedValue({ status: TaskStatus.IN_REVIEW }) };
    const service = new ReviewsService(
      { $transaction: (callback: any) => callback(tx) } as any,
      workflow as any,
      { findByIdWithRole: jest.fn().mockResolvedValue(reviewer) } as any,
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
    const tx: any = {
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
        action: 'UPDATED',
        before: { score: 3, comment: 'Needs clarification' },
        after: { score: 4, comment: 'Improved reasoning' },
      }),
    });
  });
});
