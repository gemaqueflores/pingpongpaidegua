import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateEventMergeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  primaryEventId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  secondaryEventId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  categorySuffix?: string;
}
