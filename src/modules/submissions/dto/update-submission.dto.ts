import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateSubmissionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  @Matches(/\S/)
  content!: string;
}
