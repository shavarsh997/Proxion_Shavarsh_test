import { Injectable, NotFoundException } from '@nestjs/common';
import { paginationMeta } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    actor: AuthenticatedUser,
    input: { name: string; description?: string },
    requestId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: { ...input, createdById: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'Project',
          entityId: project.id,
          action: 'PROJECT_CREATED',
          after: { name: project.name },
          requestId,
        },
      });
      return project;
    });
  }

  async list(page: number, limit: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { tasks: true, rubrics: true } } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.project.count(),
    ]);
    return { data, meta: paginationMeta(page, limit, total) };
  }

  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { tasks: true, rubrics: true },
    });
    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    return project;
  }
}
