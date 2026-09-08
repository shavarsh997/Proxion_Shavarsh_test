import { IsString, MinLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsString()
  @MinLength(1)
  content!: string;
}
