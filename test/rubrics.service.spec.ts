import { BadRequestException } from '@nestjs/common';
import { RubricsService } from '../src/modules/rubrics/rubrics.service';

const criterion = {
  name: 'Accuracy',
  minScore: 0,
  maxScore: 5,
  weight: 1,
  position: 1,
};

describe('rubric criteria invariants', () => {
  it('rejects a criterion whose minimum score exceeds its maximum score', async () => {
    const service = new RubricsService({} as any);

    await expect(
      service.create('project', 'Quality', [{ ...criterion, minScore: 6, maxScore: 5 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate criterion positions before writing a rubric version', async () => {
    const service = new RubricsService({} as any);

    await expect(
      service.version('rubric', [criterion, { ...criterion, name: 'Clarity' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
