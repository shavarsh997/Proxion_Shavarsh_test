import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ResourceForbiddenException } from '../common/exceptions/domain.exceptions';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TaskAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanRead(actor: AuthenticatedUser, taskId: string, assignedExpertIds?: string[]) {
    if (actor.role === Role.ADMIN) return;
    if (actor.role === Role.EXPERT) {
      const experts = assignedExpertIds ?? (await this.assignedExpertIds(taskId));
      if (experts.includes(actor.id)) return;
    }
    if (actor.role === Role.REVIEWER && (await this.hasReview(this.prisma, actor.id, taskId)))
      return;
    throw new ResourceForbiddenException('Resource is not assigned to you');
  }

  async assertCanTransition(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    taskId: string,
    target: 'expert' | 'reviewer',
  ) {
    if (actor.role === Role.ADMIN) return;
    if (target === 'expert' && actor.role === Role.EXPERT) {
      const assignment = await transaction.assignment.findFirst({
        where: { taskId, expertId: actor.id },
      });
      if (assignment) return;
    }
    if (target === 'reviewer' && actor.role === Role.REVIEWER) {
      if (await this.hasReview(transaction, actor.id, taskId)) return;
    }
    throw new ResourceForbiddenException('You are not authorized for this task transition');
  }

  private async assignedExpertIds(taskId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { taskId },
      select: { expertId: true },
    });
    return assignments.map((assignment) => assignment.expertId);
  }

  private async hasReview(
    client: PrismaService | Prisma.TransactionClient,
    reviewerId: string,
    taskId: string,
  ) {
    return Boolean(
      await client.review.findFirst({ where: { reviewerId, submission: { taskId } } }),
    );
  }
}
