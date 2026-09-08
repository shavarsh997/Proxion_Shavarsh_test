import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SubmissionStatus, TaskStatus } from '@prisma/client';
import { paginationMeta } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { TaskAccessPolicy } from './task-access.policy';
import { TaskWorkflowService } from './task-workflow.service';

const taskDetails = {
  project: true,
  assignments: true,
  submissions: { orderBy: { version: 'desc' as const } },
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: TaskWorkflowService,
    private readonly users: UsersService,
    private readonly access: TaskAccessPolicy,
  ) {}

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    input: { title: string; instructions: string },
    requestId?: string,
  ) {
    await this.getProjectOrThrow(projectId);
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.task.create({ data: { projectId, ...input } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Task',
          entityId: task.id,
          action: 'TASK_CREATED',
          after: { projectId, title: task.title, status: task.status },
          requestId,
        },
      });
      return task;
    });
  }

  async list(actor: AuthenticatedUser, page: number, limit: number) {
    const where = this.taskVisibilityFor(actor);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: taskDetails,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { data, meta: paginationMeta(page, limit, total) };
  }

  async assign(actor: AuthenticatedUser, taskId: string, expertId: string, requestId?: string) {
    const task = await this.getTaskOrThrow(taskId);
    const expert = await this.users.findByIdWithRole(expertId, Role.EXPERT);

    if (!expert || expert.role !== Role.EXPERT) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Expert not found' });
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT 1 FROM "Task" WHERE id = ${task.id}::uuid FOR UPDATE`;
      const existing = await transaction.assignment.findUnique({
        where: { taskId_expertId: { taskId: task.id, expertId } },
      });
      if (existing) return existing;
      const assignment = await transaction.assignment.create({
        data: { taskId: task.id, expertId, assignedById: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Assignment',
          entityId: assignment.id,
          action: 'EXPERT_ASSIGNED',
          after: { taskId: task.id, expertId },
          requestId,
        },
      });
      return assignment;
    });
  }

  async get(actor: AuthenticatedUser, taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: taskDetails });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    await this.access.assertCanRead(
      actor,
      taskId,
      task.assignments.map((assignment) => assignment.expertId),
    );
    const reviews = await this.findVisibleReviews(actor, taskId);

    if (actor.role === Role.REVIEWER && reviews.length === 0) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No assigned review for task' });
    }

    return { ...task, reviews };
  }

  transition(
    actor: AuthenticatedUser,
    taskId: string,
    targetStatus: TaskStatus,
    requestId?: string,
  ) {
    // Workflow state, submission finalization, reviewer decision, and task audit are atomic.
    return this.prisma.$transaction(async (transaction) => {
      if (targetStatus === TaskStatus.SUBMITTED) {
        await this.lockTaskForSubmissionLifecycle(transaction, taskId);
        const submission = await this.finalizeLatestSubmission(transaction, actor, taskId);
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            entityType: 'Submission',
            entityId: submission.id,
            action: 'SUBMISSION_SUBMITTED',
            before: { status: SubmissionStatus.DRAFT },
            after: { status: SubmissionStatus.SUBMITTED, version: submission.version },
            requestId,
          },
        });
      }
      const task = await this.workflow.transition(
        transaction,
        actor,
        taskId,
        targetStatus,
        requestId,
      );
      return task;
    });
  }

  private taskVisibilityFor(actor: AuthenticatedUser): Prisma.TaskWhereInput {
    if (actor.role === Role.ADMIN) return {};
    if (actor.role === Role.EXPERT) {
      return { assignments: { some: { expertId: actor.id } } };
    }
    return { submissions: { some: { reviews: { some: { reviewerId: actor.id } } } } };
  }

  private findVisibleReviews(actor: AuthenticatedUser, taskId: string) {
    if (actor.role === Role.EXPERT) return Promise.resolve([]);

    return this.prisma.review.findMany({
      where: {
        submission: { taskId },
        ...(actor.role === Role.REVIEWER ? { reviewerId: actor.id } : {}),
      },
      include: {
        submission: true,
        rubricVersion: { include: { criteria: true } },
        scores: true,
      },
    });
  }

  private async finalizeLatestSubmission(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
  ) {
    const latestSubmission = await transaction.submission.findFirst({
      where: { taskId, expertId: actor.id },
      orderBy: { version: 'desc' },
    });

    if (!latestSubmission) {
      throw new ForbiddenException({
        code: 'SUBMISSION_REQUIRED',
        message: 'Create a submission before submitting the task',
      });
    }
    if (latestSubmission.status === SubmissionStatus.SUBMITTED) {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: 'Latest submission is already finalized',
      });
    }

    return transaction.submission.update({
      where: { id: latestSubmission.id },
      data: { status: SubmissionStatus.SUBMITTED, submittedAt: new Date() },
    });
  }

  private lockTaskForSubmissionLifecycle(transaction: Prisma.TransactionClient, taskId: string) {
    // Submission creation locks the same parent row, preventing a draft version from racing a submit.
    return transaction.$executeRaw`SELECT 1 FROM "Task" WHERE id = ${taskId}::uuid FOR UPDATE`;
  }

  private async getTaskOrThrow(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    return task;
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    return project;
  }
}
