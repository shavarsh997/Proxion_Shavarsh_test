import { IsUUID } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  reviewerId!: string;

  @IsUUID()
  rubricVersionId!: string;
}
