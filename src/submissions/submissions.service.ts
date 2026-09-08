import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: AuthenticatedUser, taskId: string, content: string) {
    if (actor.role !== Role.EXPERT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only experts create submissions',
      });
    }

    return this.prisma.$transaction(
      async (transaction) => {
        // This lock serializes version allocation for one task without blocking other tasks.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`;

        await this.assertExpertCanCreateSubmission(transaction, actor, taskId);
        const nextVersion = await this.getNextVersion(transaction, taskId);

        return transaction.submission.create({
          data: { taskId, expertId: actor.id, version: nextVersion, content },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async list(actor: AuthenticatedUser, taskId: string) {
    await this.assertTaskAccess(actor, taskId);
    return this.prisma.submission.findMany({ where: { taskId }, orderBy: { version: 'asc' } });
  }

  async get(actor: AuthenticatedUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { task: { include: { assignments: true } } },
    });
    if (!submission) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' });
    }

    await this.assertTaskAccess(
      actor,
      submission.taskId,
      submission.task.assignments.map((assignment) => assignment.expertId),
    );
    return submission;
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

  private async assertTaskAccess(
    actor: AuthenticatedUser,
    taskId: string,
    assignedExpertIds?: string[],
  ) {
    if (actor.role === Role.ADMIN) return;

    if (actor.role === Role.EXPERT) {
      const expertIds = assignedExpertIds ?? (await this.getAssignedExpertIds(taskId));
      if (expertIds.includes(actor.id)) return;
    }

    if (actor.role === Role.REVIEWER && (await this.isAssignedReviewer(actor.id, taskId))) return;

    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Resource is not assigned to you' });
  }

  private async getAssignedExpertIds(taskId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { taskId },
      select: { expertId: true },
    });
    return assignments.map((assignment) => assignment.expertId);
  }

  private async isAssignedReviewer(reviewerId: string, taskId: string) {
    return Boolean(
      await this.prisma.review.findFirst({
        where: { reviewerId, submission: { taskId } },
      }),
    );
  }
}
