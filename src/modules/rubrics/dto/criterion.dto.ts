import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CriterionDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  minScore!: number;

  @IsNumber()
  maxScore!: number;

  @IsNumber()
  @Min(0)
  weight!: number;

  @IsInt()
  @Min(1)
  position!: number;
}
