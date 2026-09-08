import { Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import { SubmissionsService } from '../src/modules/submissions/submissions.service';

describe('immutable submission versions', () => {
  it('retains v1 unchanged when a rework cycle creates v2', async () => {
    const records: any[] = [
      {
        id: 'v1',
        assignmentId: 'assignment',
        version: 1,
        status: SubmissionStatus.SUBMITTED,
        content: 'original',
      },
    ];
    const tx: any = {
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
        findFirst: jest.fn(async () => records[records.length - 1]),
        create: jest.fn(async ({ data }: any) => {
          const next = { id: 'v2', status: SubmissionStatus.DRAFT, ...data };
          records.push(next);
          return next;
        }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const service = new SubmissionsService(prisma, { assertCanRead: jest.fn() } as any);
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
    const tx: any = {
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'assignment', taskId: 'task', expertId: 'other-expert' }),
      },
    };
    const service = new SubmissionsService(
      { $transaction: (fn: any) => fn(tx) } as any,
      { assertCanRead: jest.fn() } as any,
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
});
