import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}
  create(actor: AuthenticatedUser, input: { name: string; description?: string }) {
    return this.prisma.project.create({ data: { ...input, createdById: actor.id } });
  }
  list() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { tasks: true, rubrics: true } } },
    });
  }
  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { tasks: true, rubrics: true },
    });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
    return project;
  }
}
