import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { RubricsService } from '../src/modules/rubrics/rubrics.service';

const admin = { id: 'admin', email: 'admin@test.local', role: Role.ADMIN };

const criterion = {
  name: 'Accuracy',
  minScore: 0,
  maxScore: 5,
  weight: 1,
  position: 1,
};

describe('rubric criteria invariants', () => {
  it('rejects a criterion whose minimum score exceeds its maximum score', async () => {
    const service = new RubricsService({} as unknown as PrismaService);

    await expect(
      service.create(admin, 'project', 'Quality', [{ ...criterion, minScore: 6, maxScore: 5 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate criterion positions before writing a rubric version', async () => {
    const service = new RubricsService({} as unknown as PrismaService);

    await expect(
      service.version(admin, 'rubric', [criterion, { ...criterion, name: 'Clarity' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
