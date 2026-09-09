import { ForbiddenException } from '@nestjs/common';
import { Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { TaskAlreadyAssignedException } from '../src/common/exceptions/domain.exceptions';
import { TasksService } from '../src/modules/tasks/tasks.service';
import type { TaskAccessPolicy } from '../src/modules/tasks/task-access.policy';
import type { TaskWorkflowService } from '../src/modules/tasks/task-workflow.service';
import type { UsersService } from '../src/modules/users/users.service';

const admin = { id: 'admin', email: 'admin@test.local', role: Role.ADMIN };
const expert = { id: 'expert', email: 'expert@test.local', role: Role.EXPERT };
const task = { id: 'task', status: TaskStatus.UNASSIGNED, version: 0 };

function transactionClient(transaction: unknown): Prisma.TransactionClient {
  return transaction as Prisma.TransactionClient;
}

function transactionalPrisma(transaction: unknown): PrismaService {
  return {
    $transaction: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(transactionClient(transaction)),
    task: { findUnique: jest.fn().mockResolvedValue(task) },
  } as unknown as PrismaService;
}

function tasksService(
  transaction: unknown,
  workflow: Partial<TaskWorkflowService> = {},
  users: Partial<UsersService> = {},
) {
  return new TasksService(
    transactionalPrisma(transaction),
    workflow as TaskWorkflowService,
    users as UsersService,
    {} as TaskAccessPolicy,
  );
}

describe('TasksService assignment and submission lifecycle', () => {
  it('creates the first assignment, records it, and advances an unassigned task atomically', async () => {
    const assignment = { id: 'assignment', taskId: task.id, expertId: expert.id };
    const tx = {
      $executeRaw: jest.fn(),
      task: { findUniqueOrThrow: jest.fn().mockResolvedValue(task) },
      assignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(assignment),
      },
      auditLog: { create: jest.fn() },
    };
    const workflow = { transition: jest.fn().mockResolvedValue({}) };
    const users = { findByIdWithRole: jest.fn().mockResolvedValue(expert) };

    await expect(
      tasksService(tx, workflow, users).assign(admin, task.id, expert.id, 'request-1'),
    ).resolves.toEqual(assignment);

    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: { taskId: task.id, expertId: expert.id, assignedById: admin.id },
    });
    expect(workflow.transition).toHaveBeenCalledWith(
      tx,
      admin,
      task.id,
      TaskStatus.ASSIGNED,
      'request-1',
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Assignment',
        entityId: assignment.id,
        action: 'EXPERT_ASSIGNED',
        requestId: 'request-1',
      }),
    });
  });

  it('makes a repeated assignment to the same expert idempotent without a second audit event', async () => {
    const assignment = { id: 'assignment', taskId: task.id, expertId: expert.id };
    const tx = {
      $executeRaw: jest.fn(),
      task: { findUniqueOrThrow: jest.fn().mockResolvedValue(task) },
      assignment: { findUnique: jest.fn().mockResolvedValue(assignment), create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const workflow = { transition: jest.fn() };
    const users = { findByIdWithRole: jest.fn().mockResolvedValue(expert) };

    await expect(
      tasksService(tx, workflow, users).assign(admin, task.id, expert.id),
    ).resolves.toEqual(assignment);

    expect(tx.assignment.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('rejects assigning a different expert after an assignment exists', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      task: { findUniqueOrThrow: jest.fn().mockResolvedValue(task) },
      assignment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'assignment', expertId: 'other' }),
      },
    };
    const users = { findByIdWithRole: jest.fn().mockResolvedValue(expert) };

    await expect(
      tasksService(tx, {}, users).assign(admin, task.id, expert.id),
    ).rejects.toBeInstanceOf(TaskAlreadyAssignedException);
  });

  it('does not change task state when an expert submits without a draft', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      task: {
        findUnique: jest.fn().mockResolvedValue({ ...task, status: TaskStatus.IN_PROGRESS }),
      },
      submission: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() },
    };
    const workflow = { transition: jest.fn() };

    await expect(
      tasksService(tx, workflow).transition(expert, task.id, TaskStatus.SUBMITTED),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workflow.transition).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('finalizes the active draft and audits it before delegating the task submit transition', async () => {
    const draft = { id: 'submission', version: 2, status: SubmissionStatus.DRAFT };
    const submitted = { ...draft, status: SubmissionStatus.SUBMITTED, submittedAt: new Date() };
    const tx = {
      $executeRaw: jest.fn(),
      task: {
        findUnique: jest.fn().mockResolvedValue({ ...task, status: TaskStatus.IN_PROGRESS }),
      },
      submission: {
        findFirst: jest.fn().mockResolvedValue(draft),
        update: jest.fn().mockResolvedValue(submitted),
      },
      auditLog: { create: jest.fn() },
    };
    const transitionedTask = { ...task, status: TaskStatus.SUBMITTED, version: 1 };
    const workflow = { transition: jest.fn().mockResolvedValue(transitionedTask) };

    await expect(
      tasksService(tx, workflow).transition(expert, task.id, TaskStatus.SUBMITTED, 'request-2'),
    ).resolves.toEqual(transitionedTask);

    expect(tx.submission.update).toHaveBeenCalledWith({
      where: { id: draft.id },
      data: { status: SubmissionStatus.SUBMITTED, submittedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Submission',
        entityId: draft.id,
        action: 'SUBMISSION_SUBMITTED',
        before: { status: SubmissionStatus.DRAFT },
        after: { status: SubmissionStatus.SUBMITTED, version: 2 },
        requestId: 'request-2',
      }),
    });
    expect(workflow.transition).toHaveBeenCalledWith(
      tx,
      expert,
      task.id,
      TaskStatus.SUBMITTED,
      'request-2',
    );
  });
});
