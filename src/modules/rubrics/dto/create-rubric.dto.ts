import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CriterionDto } from './criterion.dto';

export class CreateRubricDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}
