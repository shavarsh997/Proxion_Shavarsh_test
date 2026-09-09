import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CriterionDto } from '../src/modules/rubrics/dto/criterion.dto';
import { CreateRubricDto } from '../src/modules/rubrics/dto/create-rubric.dto';

describe('rubric DTO validation', () => {
  it('rejects an empty or whitespace-only rubric name', async () => {
    const dto = plainToInstance(CreateRubricDto, {
      name: '   ',
      criteria: [{ name: 'Accuracy', minScore: 0, maxScore: 5, weight: 1, position: 1 }],
    });

    const errors = await validate(dto);

    expect(dto.name).toBe('');
    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('rejects an empty or whitespace-only criterion name', async () => {
    const dto = plainToInstance(CriterionDto, {
      name: '   ',
      minScore: 0,
      maxScore: 5,
      weight: 1,
      position: 1,
    });

    const errors = await validate(dto);

    expect(dto.name).toBe('');
    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });
});
