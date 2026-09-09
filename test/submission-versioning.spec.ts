import { ConflictException } from '@nestjs/common';
import { Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { SubmissionsService } from '../src/modules/submissions/submissions.service';
import { TaskAccessPolicy } from '../src/modules/tasks/task-access.policy';

interface SubmissionRecord {
  id: string;
  assignmentId: string;
  version: number;
  status: SubmissionStatus;
  content: string;
}

type SubmissionCreateInput = Pick<SubmissionRecord, 'assignmentId' | 'version' | 'content'>;

function transactionClient(transaction: unknown): Prisma.TransactionClient {
  return transaction as Prisma.TransactionClient;
}

function transactionalPrisma(transaction: unknown): PrismaService {
  return {
    $transaction: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(transactionClient(transaction)),
  } as unknown as PrismaService;
}

describe('immutable submission versions', () => {
  it('retains v1 unchanged when a rework cycle creates v2', async () => {
    const records: SubmissionRecord[] = [
      {
        id: 'v1',
        assignmentId: 'assignment',
        version: 1,
        status: SubmissionStatus.SUBMITTED,
        content: 'original',
      },
    ];
    const tx = {
      $executeRaw: jest.fn(),
      task: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task', status: TaskStatus.IN_PROGRESS }),
      },
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'assignment', taskId: 'task', expertId: 'expert' }),
      },
      auditLog: { create: jest.fn() },
      submission: {
        findFirst: jest.fn(async ({ where }: { where: { status?: SubmissionStatus } }) => {
          if (where.status === SubmissionStatus.DRAFT) {
            return records.find((record) => record.status === SubmissionStatus.DRAFT) ?? null;
          }
          return records[records.length - 1];
        }),
        create: jest.fn(async ({ data }: { data: SubmissionCreateInput }) => {
          const next = { id: 'v2', status: SubmissionStatus.DRAFT, ...data };
          records.push(next);
          return next;
        }),
      },
    };
    const service = new SubmissionsService(
      transactionalPrisma(tx),
      new TaskAccessPolicy({} as unknown as PrismaService),
    );
    const created = await service.create(
      { id: 'expert', email: 'expert@test.local', role: Role.EXPERT },
      'task',
      'assignment',
      'reworked',
    );
    expect(created.version).toBe(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: 1,
          status: SubmissionStatus.SUBMITTED,
          content: 'original',
        }),
        expect.objectContaining({
          version: 2,
          status: SubmissionStatus.DRAFT,
          content: 'reworked',
        }),
      ]),
    );
  });

  it('rejects an assignment owned by another expert', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'assignment', taskId: 'task', expertId: 'other-expert' }),
      },
    };
    const service = new SubmissionsService(
      transactionalPrisma(tx),
      new TaskAccessPolicy({} as unknown as PrismaService),
    );

    await expect(
      service.create(
        { id: 'expert', email: 'expert@test.local', role: Role.EXPERT },
        'task',
        'assignment',
        'content',
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });

  it('rejects a second active draft for the same assignment', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'assignment', taskId: 'task', expertId: 'expert' }),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task', status: TaskStatus.IN_PROGRESS }),
      },
      submission: {
        findFirst: jest.fn().mockResolvedValue({ id: 'draft-1' }),
        create: jest.fn(),
      },
    };
    const service = new SubmissionsService(
      transactionalPrisma(tx),
      new TaskAccessPolicy({} as unknown as PrismaService),
    );

    await expect(
      service.create(
        { id: 'expert', email: 'expert@test.local', role: Role.EXPERT },
        'task',
        'assignment',
        'another draft',
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ACTIVE_DRAFT_EXISTS' }) });
    expect(tx.submission.create).not.toHaveBeenCalled();
  });

  it('rechecks task state after acquiring the lifecycle lock', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'assignment', taskId: 'task', expertId: 'expert' }),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task', status: TaskStatus.SUBMITTED }),
      },
      submission: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new SubmissionsService(
      transactionalPrisma(tx),
      new TaskAccessPolicy({} as unknown as PrismaService),
    );

    await expect(
      service.create(
        { id: 'expert', email: 'expert@test.local', role: Role.EXPERT },
        'task',
        'assignment',
        'late draft',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.submission.create).not.toHaveBeenCalled();
  });
});
