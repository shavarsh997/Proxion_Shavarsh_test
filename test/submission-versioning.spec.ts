import { Role, TaskStatus } from '@prisma/client';
import { SubmissionsService } from '../src/submissions/submissions.service';

describe('immutable submission versions', () => {
  it('retains v1 unchanged when a rework cycle creates v2', async () => {
    const records: any[] = [
      { id: 'v1', taskId: 'task', expertId: 'expert', version: 1, content: 'original' },
    ];
    const tx: any = {
      $executeRaw: jest.fn(),
      task: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task', status: TaskStatus.IN_PROGRESS }),
      },
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: 'a' }) },
      submission: {
        findFirst: jest.fn(async () => records[records.length - 1]),
        create: jest.fn(async ({ data }: any) => {
          const next = { id: 'v2', ...data };
          records.push(next);
          return next;
        }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const service = new SubmissionsService(prisma);
    const created = await service.create(
      { id: 'expert', email: 'expert@test.local', role: Role.EXPERT },
      'task',
      'reworked',
    );
    expect(created.version).toBe(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 1, content: 'original' }),
        expect.objectContaining({ version: 2, content: 'reworked' }),
      ]),
    );
  });
});
