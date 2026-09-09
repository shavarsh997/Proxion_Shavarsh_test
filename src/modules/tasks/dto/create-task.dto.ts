import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  instructions!: string;
}
