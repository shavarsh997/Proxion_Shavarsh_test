import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CriterionDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
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
