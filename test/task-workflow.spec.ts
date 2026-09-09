import { ConflictException } from '@nestjs/common';
import { Role, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { TaskAccessPolicy } from '../src/modules/tasks/task-access.policy';
import { TaskWorkflowService } from '../src/modules/tasks/task-workflow.service';

const workflow = () =>
  new TaskWorkflowService(new TaskAccessPolicy({} as unknown as PrismaService));

function transactionClient(transaction: unknown): Prisma.TransactionClient {
  return transaction as Prisma.TransactionClient;
}

describe('TaskWorkflowService', () => {
  const actor = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@test.local',
    role: Role.ADMIN,
  };
  it('rejects an invalid ASSIGNED -> APPROVED transition', async () => {
    const tx = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'task', status: TaskStatus.ASSIGNED, version: 0 }),
      },
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment' }) },
    };
    await expect(
      workflow().transition(transactionClient(tx), actor, 'task', TaskStatus.APPROVED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect('updateMany' in tx.task).toBe(false);
  });

  it('changes state and records an audit event in the supplied transaction', async () => {
    const transitioned = { id: 'task', status: TaskStatus.IN_PROGRESS, version: 1 };
    const tx = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'task', status: TaskStatus.ASSIGNED, version: 0 })
          .mockResolvedValueOnce(transitioned),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(transitioned),
      },
      auditLog: { create: jest.fn() },
    };

    await expect(
      workflow().transition(
        transactionClient(tx),
        actor,
        'task',
        TaskStatus.IN_PROGRESS,
        'request-1',
      ),
    ).resolves.toEqual(transitioned);
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'task', version: 0 },
      data: { status: TaskStatus.IN_PROGRESS, version: { increment: 1 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TASK_STATUS_CHANGED',
          before: { status: TaskStatus.ASSIGNED, version: 0 },
          after: { status: TaskStatus.IN_PROGRESS, version: 1 },
          requestId: 'request-1',
        }),
      }),
    );
  });

  it('rejects a stale optimistic-lock update', async () => {
    const tx = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'task', status: TaskStatus.ASSIGNED, version: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(
      workflow().transition(transactionClient(tx), actor, 'task', TaskStatus.IN_PROGRESS),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONCURRENT_MODIFICATION' }),
    });
  });
});
