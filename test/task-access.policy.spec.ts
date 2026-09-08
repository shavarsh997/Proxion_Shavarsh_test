import { Role } from '@prisma/client';
import { ResourceForbiddenException } from '../src/common/exceptions/domain.exceptions';
import { TaskAccessPolicy } from '../src/modules/tasks/task-access.policy';

describe('TaskAccessPolicy', () => {
  it('prevents an expert from reading a task assigned to another expert', async () => {
    const policy = new TaskAccessPolicy({} as never);
    const actor = { id: 'expert-b', email: 'expert-b@test.local', role: Role.EXPERT };

    await expect(policy.assertCanRead(actor, 'task', ['expert-a'])).rejects.toBeInstanceOf(
      ResourceForbiddenException,
    );
  });
});
