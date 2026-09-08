import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
export interface CriterionInput {
  name: string;
  description?: string;
  minScore: number;
  maxScore: number;
  weight: number;
  position: number;
}
@Injectable()
export class RubricsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    name: string,
    criteria: CriterionInput[],
    requestId?: string,
  ) {
    this.assertCriteriaAreValid(criteria);
    await this.requireProject(projectId);
    return this.prisma.$transaction(async (tx) => {
      const rubric = await tx.rubric.create({ data: { projectId, name } });
      const version = await tx.rubricVersion.create({
        data: { rubricId: rubric.id, version: 1, criteria: { create: criteria } },
      });
      await tx.auditLog.createMany({
        data: [
          {
            actorId: actor.id,
            entityType: 'Rubric',
            entityId: rubric.id,
            action: 'RUBRIC_CREATED',
            after: { projectId, name },
            requestId,
          },
          {
            actorId: actor.id,
            entityType: 'RubricVersion',
            entityId: version.id,
            action: 'RUBRIC_VERSION_CREATED',
            after: {
              rubricId: rubric.id,
              version: version.version,
              criteriaCount: criteria.length,
            },
            requestId,
          },
        ],
      });
      return tx.rubric.findUniqueOrThrow({
        where: { id: rubric.id },
        include: { versions: { include: { criteria: true } } },
      });
    });
  }
  async version(
    actor: AuthenticatedUser,
    rubricId: string,
    criteria: CriterionInput[],
    requestId?: string,
  ) {
    this.assertCriteriaAreValid(criteria);
    return this.prisma.$transaction(async (tx) => {
      const rubric = await tx.rubric.findUnique({ where: { id: rubricId } });
      if (!rubric) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rubric not found' });
      // A parent-row lock serializes version allocation without introducing a global lock.
      await tx.$executeRaw`SELECT 1 FROM "Rubric" WHERE id = ${rubricId}::uuid FOR UPDATE`;
      const last = await tx.rubricVersion.findFirst({
        where: { rubricId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = await tx.rubricVersion.create({
        data: { rubricId, version: (last?.version ?? 0) + 1, criteria: { create: criteria } },
        include: { criteria: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'RubricVersion',
          entityId: version.id,
          action: 'RUBRIC_VERSION_CREATED',
          after: { rubricId, version: version.version, criteriaCount: criteria.length },
          requestId,
        },
      });
      return version;
    });
  }
  async getVersion(rubricId: string, version: number) {
    const value = await this.prisma.rubricVersion.findUnique({
      where: { rubricId_version: { rubricId, version } },
      include: { criteria: { orderBy: { position: 'asc' } } },
    });
    if (!value)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rubric version not found' });
    return value;
  }
  private async requireProject(id: string) {
    if (!(await this.prisma.project.findUnique({ where: { id } })))
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
  }

  private assertCriteriaAreValid(criteria: CriterionInput[]) {
    const positions = new Set<number>();
    for (const criterion of criteria) {
      if (criterion.minScore > criterion.maxScore) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Criterion minScore cannot exceed maxScore',
        });
      }
      if (positions.has(criterion.position)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Criterion positions must be unique within a rubric version',
        });
      }
      positions.add(criterion.position);
    }
  }
}
