import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, Task, TaskStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  ConcurrentModificationException,
  InvalidStateTransitionException,
} from '../../common/exceptions/domain.exceptions';
import { TaskAccessPolicy } from './task-access.policy';

// This is the sole task-state transition map. Task.status is not mutated elsewhere.
const ALLOWED_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  UNASSIGNED: [TaskStatus.ASSIGNED],
  ASSIGNED: [TaskStatus.IN_PROGRESS],
  IN_PROGRESS: [TaskStatus.SUBMITTED],
  SUBMITTED: [TaskStatus.IN_REVIEW],
  IN_REVIEW: [TaskStatus.REWORK, TaskStatus.APPROVED],
  REWORK: [TaskStatus.IN_PROGRESS],
  APPROVED: [],
};

@Injectable()
/** The only application-level authority allowed to change Task.status. */
export class TaskWorkflowService {
  constructor(private readonly access: TaskAccessPolicy) {}

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
        action: targetStatus === TaskStatus.IN_PROGRESS ? 'TASK_STARTED' : 'TASK_STATUS_CHANGED',
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
    if (ALLOWED_TASK_TRANSITIONS[currentStatus].includes(targetStatus)) return;

    throw new InvalidStateTransitionException(currentStatus, targetStatus);
  }

  private async assertActorCanTransition(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    task: Task,
    targetStatus: TaskStatus,
  ) {
    if (actor.role === Role.ADMIN) return;
    if (this.isExpertTransition(targetStatus)) {
      await this.access.assertCanTransition(transaction, actor, task.id, 'expert');
      return;
    }
    if (this.isReviewerTransition(targetStatus)) {
      await this.access.assertCanTransition(transaction, actor, task.id, 'reviewer');
      return;
    }
    // Admin-triggered transitions still flow through the same state map above.
    await this.access.assertCanTransition(transaction, actor, task.id, 'expert');
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
      throw new ConcurrentModificationException();
    }

    return transaction.task.findUniqueOrThrow({ where: { id: task.id } });
  }
}
