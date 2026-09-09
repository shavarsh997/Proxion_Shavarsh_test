import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';
import { TaskAccessPolicy } from '../tasks/task-access.policy';
import {
  ActiveDraftExistsException,
  SubmissionImmutableException,
} from '../../common/exceptions/domain.exceptions';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskAccess: TaskAccessPolicy,
  ) {}

  async create(
    actor: AuthenticatedUser,
    taskId: string,
    assignmentId: string,
    content: string,
    requestId?: string,
  ) {
    if (actor.role !== Role.EXPERT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only experts create submissions',
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      // Lock before lifecycle reads. A waiting create must not reuse a stale IN_PROGRESS state
      // after another transaction has already submitted the task.
      await this.lockTaskForSubmissionLifecycle(transaction, taskId);
      const assignment = await this.assertExpertCanCreateSubmission(
        transaction,
        actor,
        taskId,
        assignmentId,
      );
      const activeDraft = await transaction.submission.findFirst({
        where: { assignmentId: assignment.id, status: SubmissionStatus.DRAFT },
        select: { id: true },
      });
      if (activeDraft) throw new ActiveDraftExistsException();
      const nextVersion = await this.getNextVersion(transaction, assignment.id);

      const submission = await transaction.submission.create({
        data: { assignmentId: assignment.id, version: nextVersion, content },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Submission',
          entityId: submission.id,
          action: AuditAction.SUBMISSION_CREATED,
          after: {
            assignmentId: assignment.id,
            taskId,
            version: submission.version,
            status: submission.status,
          },
          requestId: requestId ?? null,
        },
      });
      return submission;
    });
  }

  async list(actor: AuthenticatedUser, taskId: string) {
    await this.taskAccess.assertCanRead(actor, taskId);
    return this.prisma.submission.findMany({
      where: { assignment: { taskId }, ...this.submissionVisibilityFor(actor) },
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
        include: { assignment: { include: { task: true } } },
      });
      if (!submission) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
      }

      // Uses the same lock as finalization, so a draft cannot be modified after it becomes submitted.
      await this.lockTaskForSubmissionLifecycle(transaction, submission.assignment.taskId);
      const lockedSubmission = await transaction.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { assignment: { include: { task: true } } },
      });
      if (lockedSubmission.assignment.expertId !== actor.id) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the submission author can update a draft',
        });
      }
      this.assertDraftIsMutable(lockedSubmission.status);
      if (lockedSubmission.assignment.task.status !== TaskStatus.IN_PROGRESS) {
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
          action: AuditAction.SUBMISSION_UPDATED,
          before: { contentLength: lockedSubmission.content.length },
          after: { contentLength: updated.content.length },
          requestId: requestId ?? null,
        },
      });
      return updated;
    });
  }

  async get(actor: AuthenticatedUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
    }

    await this.taskAccess.assertCanReadSubmission(actor, submission);
    return submission;
  }

  private submissionVisibilityFor(actor: AuthenticatedUser): Prisma.SubmissionWhereInput {
    if (actor.role === Role.ADMIN) return {};
    if (actor.role === Role.EXPERT) return { assignment: { expertId: actor.id } };
    return { reviews: { some: { reviewerId: actor.id } } };
  }

  private async assertExpertCanCreateSubmission(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
    assignmentId: string,
  ) {
    const assignment = await transaction.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Assignment not found' });
    }
    if (assignment.taskId !== taskId) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'Assignment does not belong to this task',
      });
    }
    if (assignment.expertId !== actor.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Assignment is not assigned to you',
      });
    }
    const task = await transaction.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    if (task.status !== TaskStatus.IN_PROGRESS) {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: 'Submissions can only be created while work is in progress',
      });
    }
    return assignment;
  }

  private async getNextVersion(transaction: Prisma.TransactionClient, assignmentId: string) {
    const latestSubmission = await transaction.submission.findFirst({
      where: { assignmentId },
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
