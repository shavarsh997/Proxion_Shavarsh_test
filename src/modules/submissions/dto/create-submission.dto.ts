import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  assignmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  @Matches(/\S/)
  content!: string;
}
