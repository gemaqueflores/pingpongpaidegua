import { IsIn, IsInt, IsOptional } from "class-validator";

export class ScrapeNowDto {
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  stage?: 1 | 2 | 3;
}
