import { IsUUID } from 'class-validator';

export class AssignTaskDto {
  @IsUUID()
  expertId!: string;
}
