import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, Task, TaskStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  ASSIGNED: [TaskStatus.IN_PROGRESS],
  IN_PROGRESS: [TaskStatus.SUBMITTED],
  SUBMITTED: [TaskStatus.IN_REVIEW],
  IN_REVIEW: [TaskStatus.REWORK, TaskStatus.APPROVED],
  REWORK: [TaskStatus.IN_PROGRESS],
  APPROVED: [],
};

@Injectable()
export class TaskWorkflowService {
  async transition(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
    targetStatus: TaskStatus,
    requestId?: string,
  ): Promise<Task> {
    const task = await this.getTaskOrThrow(transaction, taskId);
    await this.assertActorCanTransition(transaction, actor, task, targetStatus);
    this.assertTransitionIsAllowed(task.status, targetStatus);

    const transitionedTask = await this.updateWithOptimisticLock(transaction, task, targetStatus);
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        entityType: 'Task',
        entityId: task.id,
        action: 'STATUS_CHANGED',
        before: { status: task.status, version: task.version },
        after: { status: transitionedTask.status, version: transitionedTask.version },
        requestId,
      },
    });
    return transitionedTask;
  }

  private async getTaskOrThrow(transaction: Prisma.TransactionClient, taskId: string) {
    const task = await transaction.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    return task;
  }

  private assertTransitionIsAllowed(currentStatus: TaskStatus, targetStatus: TaskStatus) {
    if (ALLOWED_TRANSITIONS[currentStatus].includes(targetStatus)) return;

    throw new ConflictException({
      code: 'INVALID_STATE_TRANSITION',
      message: `Cannot transition ${currentStatus} to ${targetStatus}`,
    });
  }

  private async assertActorCanTransition(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    task: Task,
    targetStatus: TaskStatus,
  ) {
    if (actor.role === Role.ADMIN) return;

    if (actor.role === Role.EXPERT && this.isExpertTransition(targetStatus)) {
      const assignment = await transaction.assignment.findFirst({
        where: { taskId: task.id, expertId: actor.id },
      });
      if (assignment) return;
    }

    if (actor.role === Role.REVIEWER && this.isReviewerTransition(targetStatus)) {
      const review = await transaction.review.findFirst({
        where: { reviewerId: actor.id, submission: { taskId: task.id } },
      });
      if (review) return;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You are not authorized for this task transition',
    });
  }

  private isExpertTransition(targetStatus: TaskStatus) {
    return targetStatus === TaskStatus.IN_PROGRESS || targetStatus === TaskStatus.SUBMITTED;
  }

  private isReviewerTransition(targetStatus: TaskStatus) {
    return targetStatus === TaskStatus.REWORK || targetStatus === TaskStatus.APPROVED;
  }

  private async updateWithOptimisticLock(
    transaction: Prisma.TransactionClient,
    task: Task,
    targetStatus: TaskStatus,
  ) {
    // The version predicate allows only one concurrent request to transition this task state.
    const updateResult = await transaction.task.updateMany({
      where: { id: task.id, version: task.version },
      data: { status: targetStatus, version: { increment: 1 } },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_MODIFICATION',
        message: 'Task was modified concurrently; retry',
      });
    }

    return transaction.task.findUniqueOrThrow({ where: { id: task.id } });
  }
}
