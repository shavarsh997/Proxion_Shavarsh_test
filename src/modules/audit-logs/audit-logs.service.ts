import { Injectable } from '@nestjs/common';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, limit: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count(),
    ]);
    return { data, meta: paginationMeta(page, limit, total) };
  }
}
