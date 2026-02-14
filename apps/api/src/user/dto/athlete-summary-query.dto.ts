import { IsIn, IsOptional } from "class-validator";

export class AthleteSummaryQueryDto {
  @IsOptional()
  @IsIn(["phase_hierarchy_datetime", "category_phase_datetime"])
  orderBy?: "phase_hierarchy_datetime" | "category_phase_datetime";
}
