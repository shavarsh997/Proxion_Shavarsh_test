import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';
import { TaskAccessPolicy } from '../tasks/task-access.policy';
import { SubmissionImmutableException } from '../../common/exceptions/domain.exceptions';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskAccess: TaskAccessPolicy,
  ) {}

  async create(actor: AuthenticatedUser, taskId: string, content: string, requestId?: string) {
    if (actor.role !== Role.EXPERT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only experts create submissions',
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      // Locking the parent Task serializes v(n + 1) allocation and submit finalization for one task.
      await this.lockTaskForSubmissionLifecycle(transaction, taskId);

      await this.assertExpertCanCreateSubmission(transaction, actor, taskId);
      const nextVersion = await this.getNextVersion(transaction, taskId);

      const submission = await transaction.submission.create({
        data: { taskId, expertId: actor.id, version: nextVersion, content },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Submission',
          entityId: submission.id,
          action: 'SUBMISSION_CREATED',
          after: { taskId, version: submission.version, status: submission.status },
          requestId,
        },
      });
      return submission;
    });
  }

  async list(actor: AuthenticatedUser, taskId: string) {
    await this.taskAccess.assertCanRead(actor, taskId);
    return this.prisma.submission.findMany({
      where: { taskId, ...this.submissionVisibilityFor(actor) },
      orderBy: { version: 'asc' },
    });
  }

  async updateDraft(
    actor: AuthenticatedUser,
    submissionId: string,
    content: string,
    requestId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const submission = await transaction.submission.findUnique({
        where: { id: submissionId },
        include: { task: true },
      });
      if (!submission) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
      }

      // Uses the same lock as finalization, so a draft cannot be modified after it becomes submitted.
      await this.lockTaskForSubmissionLifecycle(transaction, submission.taskId);
      const lockedSubmission = await transaction.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { task: true },
      });
      if (lockedSubmission.expertId !== actor.id) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the submission author can update a draft',
        });
      }
      this.assertDraftIsMutable(lockedSubmission.status);
      if (lockedSubmission.task.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: 'Draft submissions can only be updated while work is in progress',
        });
      }

      const updated = await transaction.submission.update({
        where: { id: lockedSubmission.id },
        data: { content },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Submission',
          entityId: updated.id,
          action: 'SUBMISSION_UPDATED',
          before: { contentLength: lockedSubmission.content.length },
          after: { contentLength: updated.content.length },
          requestId,
        },
      });
      return updated;
    });
  }

  async get(actor: AuthenticatedUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { task: { include: { assignments: true } } },
    });
    if (!submission) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
    }

    await this.taskAccess.assertCanReadSubmission(actor, submission);
    return submission;
  }

  private submissionVisibilityFor(actor: AuthenticatedUser): Prisma.SubmissionWhereInput {
    if (actor.role === Role.ADMIN) return {};
    if (actor.role === Role.EXPERT) return { expertId: actor.id };
    return { reviews: { some: { reviewerId: actor.id } } };
  }

  private async assertExpertCanCreateSubmission(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
  ) {
    const task = await transaction.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    const assignment = await transaction.assignment.findFirst({
      where: { taskId, expertId: actor.id },
    });
    if (!assignment) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Task is not assigned to you' });
    }
    if (task.status !== TaskStatus.IN_PROGRESS) {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: 'Submissions can only be created while work is in progress',
      });
    }
  }

  private async getNextVersion(transaction: Prisma.TransactionClient, taskId: string) {
    const latestSubmission = await transaction.submission.findFirst({
      where: { taskId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latestSubmission?.version ?? 0) + 1;
  }

  private lockTaskForSubmissionLifecycle(transaction: Prisma.TransactionClient, taskId: string) {
    return transaction.$executeRaw`SELECT 1 FROM "Task" WHERE id = ${taskId}::uuid FOR UPDATE`;
  }

  private assertDraftIsMutable(status: SubmissionStatus) {
    if (status === SubmissionStatus.DRAFT) return;
    throw new SubmissionImmutableException();
  }
}
