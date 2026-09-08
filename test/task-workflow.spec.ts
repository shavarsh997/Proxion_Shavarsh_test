import { ConflictException } from '@nestjs/common';
import { Role, TaskStatus } from '@prisma/client';
import { TaskWorkflowService } from '../src/tasks/task-workflow.service';

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
      new TaskWorkflowService().transition(tx, actor, 'task', TaskStatus.APPROVED),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.task.updateMany).toBeUndefined();
  });
});
