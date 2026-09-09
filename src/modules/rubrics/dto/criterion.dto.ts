import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CriterionDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
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
