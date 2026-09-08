import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { paginationMeta } from '../common/http/dto/pagination.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(actor: AuthenticatedUser, input: { name: string; description?: string }) {
    return this.prisma.project.create({ data: { ...input, createdById: actor.id } });
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
