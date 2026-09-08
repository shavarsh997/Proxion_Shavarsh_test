import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  list(limit = 50) {
    return this.prisma.auditLog.findMany({
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
    });
  }
}
