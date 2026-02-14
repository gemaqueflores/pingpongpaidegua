import { IsString, MaxLength, MinLength } from "class-validator";

export class ReportProblemDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;
}
