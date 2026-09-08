import { IsString, MinLength } from 'class-validator';

export class UpdateSubmissionDto {
  @IsString()
  @MinLength(1)
  content!: string;
}
