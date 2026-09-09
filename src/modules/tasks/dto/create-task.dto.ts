import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  @Matches(/\S/)
  instructions!: string;
}
