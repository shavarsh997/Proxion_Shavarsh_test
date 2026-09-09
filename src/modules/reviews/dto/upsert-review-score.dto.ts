import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertReviewScoreDto {
  @IsNumber()
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  comment?: string;
}
