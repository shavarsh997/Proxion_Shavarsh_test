import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpsertReviewScoreDto {
  @IsNumber()
  score!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
