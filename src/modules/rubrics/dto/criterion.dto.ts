import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @IsNumber()
  @Min(0)
  position!: number;
}
