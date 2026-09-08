import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  assignmentId!: string;

  @IsString()
  @MinLength(1)
  content!: string;
}
