import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CriterionDto } from './criterion.dto';

export class CreateRubricVersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}
