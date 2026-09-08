import { ConflictException } from '@nestjs/common';
import { Role, TaskStatus } from '@prisma/client';
import { TaskWorkflowService } from '../src/modules/tasks/task-workflow.service';

const workflow = () => new TaskWorkflowService({ assertCanTransition: jest.fn() } as any);

describe('TaskWorkflowService', () => {
  const actor = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@test.local',
    role: Role.ADMIN,
  };
  it('rejects an invalid ASSIGNED -> APPROVED transition', async () => {
    const tx: any = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'task', status: TaskStatus.ASSIGNED, version: 0 }),
      },
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment' }) },
    };
    await expect(
      workflow().transition(tx, actor, 'task', TaskStatus.APPROVED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.task.updateMany).toBeUndefined();
  });

  it('changes state and records an audit event in the supplied transaction', async () => {
    const transitioned = { id: 'task', status: TaskStatus.IN_PROGRESS, version: 1 };
    const tx: any = {
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
      workflow().transition(tx, actor, 'task', TaskStatus.IN_PROGRESS, 'request-1'),
    ).resolves.toEqual(transitioned);
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'task', version: 0 },
      data: { status: TaskStatus.IN_PROGRESS, version: { increment: 1 } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestId: 'request-1' }) }),
    );
  });

  it('rejects a stale optimistic-lock update', async () => {
    const tx: any = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'task', status: TaskStatus.ASSIGNED, version: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await expect(
      workflow().transition(tx, actor, 'task', TaskStatus.IN_PROGRESS),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONCURRENT_MODIFICATION' }),
    });
  });
});
