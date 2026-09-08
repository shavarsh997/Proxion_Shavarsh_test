import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';
import { CriterionDto } from './criterion.dto';

export class CreateRubricDto {
  @IsString()
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}
