import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  assignmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  content!: string;
}
