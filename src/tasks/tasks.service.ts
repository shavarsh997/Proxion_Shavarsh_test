import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, TaskStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  async create(projectId: string, input: { title: string; instructions: string }) {
    await this.getProjectOrThrow(projectId);
    return this.prisma.task.create({ data: { projectId, ...input } });
  }

  list(actor: AuthenticatedUser) {
    return this.prisma.task.findMany({
      where: this.taskVisibilityFor(actor),
      include: taskDetails,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async assign(actor: AuthenticatedUser, taskId: string, expertId: string) {
    const task = await this.getTaskOrThrow(taskId);
    const expert = await this.prisma.user.findUnique({ where: { id: expertId } });

    if (!expert || expert.role !== Role.EXPERT) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Expert not found' });
    }

    return this.prisma.assignment.create({
      data: { taskId: task.id, expertId, assignedById: actor.id },
    });
  }

  async get(actor: AuthenticatedUser, taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: taskDetails });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    this.assertTaskReadAccess(
      actor,
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
    return this.prisma.$transaction(
      async (transaction) => {
        if (targetStatus === TaskStatus.SUBMITTED) {
          await this.finalizeLatestSubmission(transaction, actor, taskId);
        }

        return this.workflow.transition(transaction, actor, taskId, targetStatus, requestId);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private taskVisibilityFor(actor: AuthenticatedUser): Prisma.TaskWhereInput {
    if (actor.role === Role.ADMIN) return {};
    if (actor.role === Role.EXPERT) {
      return { assignments: { some: { expertId: actor.id } } };
    }
    return { submissions: { some: { reviews: { some: { reviewerId: actor.id } } } } };
  }

  private assertTaskReadAccess(actor: AuthenticatedUser, assignedExpertIds: string[]) {
    if (actor.role !== Role.EXPERT || assignedExpertIds.includes(actor.id)) return;

    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Task is not assigned to you' });
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
    if (latestSubmission.submittedAt) {
      throw new ForbiddenException({
        code: 'SUBMISSION_ALREADY_FINALIZED',
        message: 'Latest submission is already finalized',
      });
    }

    await transaction.submission.update({
      where: { id: latestSubmission.id },
      data: { submittedAt: new Date() },
    });
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
